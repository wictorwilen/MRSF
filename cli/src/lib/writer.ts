/**
 * MRSF Writer — serialize MrsfDocument back to YAML or JSON.
 *
 * Uses CST-level (Concrete Syntax Tree) round-trip editing via the `yaml`
 * library so that unchanged content is byte-identical to the original file.
 *   - Preserves YAML comments (#)
 *   - Preserves scalar styles (>, |, quotes)
 *   - Preserves key ordering and whitespace
 *   - Only modifies values that actually changed
 *
 * Auto-computes selected_text_hash when selected_text changes.
 */

import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { Document, Parser, CST, parse as yamlParse } from "yaml";
import type { MrsfDocument, Comment } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Per-file write serialization                                       */
/* ------------------------------------------------------------------ */

/**
 * Map of absolute file paths to pending write promises.
 * Ensures that concurrent writes to the same sidecar file are serialized
 * (queued), preventing race conditions during the read-modify-write cycle.
 */
const writeQueue = new Map<string, Promise<void>>();

/**
 * Enqueue a write operation for the given file path, ensuring only one
 * write executes at a time per file.
 */
function enqueueWrite(abs: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueue.get(abs) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if previous write failed
  writeQueue.set(abs, next);
  // Clean up map entry when the queue drains
  next.then(() => {
    if (writeQueue.get(abs) === next) writeQueue.delete(abs);
  }, () => {
    if (writeQueue.get(abs) === next) writeQueue.delete(abs);
  });
  return next;
}

/* ------------------------------------------------------------------ */
/*  Atomic file write                                                  */
/* ------------------------------------------------------------------ */

/**
 * Atomically write content to a file by writing to a temporary file in
 * the same directory, then renaming.  On POSIX this is atomic; on
 * Windows it replaces the target.
 */
async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const tmp = filePath + "." + randomBytes(6).toString("hex") + ".tmp";
  try {
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Hash helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Compute SHA-256 hex hash of a string (UTF-8).
 */
export function computeHash(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Ensure selected_text_hash is consistent for a comment.
 * If selected_text is present, computes/updates the hash.
 * If selected_text is absent, removes the hash.
 */
export function syncHash(comment: Comment): Comment {
  if (comment.selected_text != null && comment.selected_text.length > 0) {
    comment.selected_text_hash = computeHash(comment.selected_text);
  } else {
    delete comment.selected_text_hash;
  }
  return comment;
}

/* ------------------------------------------------------------------ */
/*  CST round-trip helpers                                             */
/* ------------------------------------------------------------------ */

/** Any CST token — the `yaml` library doesn't export fine-grained types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CstNode = any;

/**
 * Known comment field keys in preferred output order (for new comments).
 */
const COMMENT_KEY_ORDER = [
  "id", "author", "timestamp", "text", "type", "severity",
  "resolved", "reply_to", "line", "end_line", "start_column", "end_column",
  "selected_text", "selected_text_hash", "anchored_text", "commit",
];

/* ·· value serialisation ·············································· */

/**
 * Convert a JS value to its YAML source text representation.
 * Strings that require quoting get double-quoted; numbers and booleans
 * are plain scalars.
 *
 * Uses an allowlist approach: only strings that consist entirely of
 * "safe" characters are emitted as bare scalars.  Everything else is
 * double-quoted via JSON.stringify, which is always valid YAML.
 */
function valueToSource(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    // Empty string must be quoted
    if (v === "") return JSON.stringify(v);

    // YAML reserved words / null aliases must be quoted
    if (
      v === "true" || v === "false" || v === "null" ||
      v === "True" || v === "False" || v === "Null" ||
      v === "TRUE" || v === "FALSE" || v === "NULL" ||
      v === "yes" || v === "no" || v === "on" || v === "off" ||
      v === "Yes" || v === "No" || v === "On" || v === "Off" ||
      v === "YES" || v === "NO" || v === "ON" || v === "OFF" ||
      v === "~" || v === ".inf" || v === "-.inf" || v === ".nan"
    ) {
      return JSON.stringify(v);
    }

    // Strings starting with digits (could be parsed as number) must be quoted
    if (/^\d/.test(v)) return JSON.stringify(v);

    // Allowlist: safe plain scalars consist of word chars, hyphens (not
    // leading), dots, slashes, spaces (not leading/trailing), parentheses,
    // and @ — but NO YAML indicators or ambiguous sequences.
    // A safe string:
    //   • starts with a letter, underscore
    //   • contains only [A-Za-z0-9 _./()@+-] (note: hyphen mid-string is OK)
    //   • does NOT contain " #" (inline comment)
    //   • does NOT start with "- " or end with ":"
    //   • has no leading/trailing whitespace
    //   • contains no newlines or tabs
    if (/^[A-Za-z_][A-Za-z0-9 _./()\-@+]*$/.test(v) && !v.includes(" #") && !/\s$/.test(v)) {
      return v;
    }

    // Everything else: double-quote (JSON.stringify handles escaping)
    return JSON.stringify(v);
  }
  return String(v);
}

/** Return the CST scalar type for a value. */
function valueType(v: unknown): string {
  return valueToSource(v).startsWith('"') ? "double-quoted-scalar" : "scalar";
}

/* ·· CST node construction ············································ */

const NL = "\n";

/**
 * Build a CST map-item (key: value\n) suitable for insertion into a
 * block-map's `items` array.
 *
 * @param isFirst  If true, omit leading indent (first item in a block-map
 *                 inherits indent from the parent seq-item-ind).
 */
function makeCstMapItem(
  key: string,
  value: unknown,
  indent: number,
  isFirst: boolean,
): CstNode {
  const start = isFirst
    ? []
    : [{ type: "space", offset: 0, indent: 0, source: " ".repeat(indent) }];
  return {
    start,
    key: { type: "scalar", offset: 0, indent, source: key },
    sep: [
      { type: "map-value-ind", offset: 0, indent, source: ":" },
      { type: "space", offset: 0, indent, source: " " },
    ],
    value: {
      type: valueType(value),
      offset: 0,
      indent,
      source: valueToSource(value),
      end: [{ type: "newline", offset: 0, indent, source: NL }],
    },
  };
}

/**
 * Build a complete CST seq-item for a brand-new Comment (block-map inside
 * a block-seq).
 */
function makeCstSeqItem(comment: Comment, seqIndent: number): CstNode {
  const mapIndent = seqIndent + 2;
  const items: CstNode[] = [];

  // Preferred key order first
  for (const key of COMMENT_KEY_ORDER) {
    const val = (comment as Record<string, unknown>)[key];
    if (val !== undefined) {
      items.push(makeCstMapItem(key, val, mapIndent, items.length === 0));
    }
  }
  // Extension / extra fields
  for (const key of Object.keys(comment)) {
    if (
      !COMMENT_KEY_ORDER.includes(key) &&
      (comment as Record<string, unknown>)[key] !== undefined
    ) {
      items.push(
        makeCstMapItem(
          key,
          (comment as Record<string, unknown>)[key],
          mapIndent,
          items.length === 0,
        ),
      );
    }
  }

  return {
    start: [
      { type: "newline", offset: 0, indent: 0, source: NL },
      { type: "space", offset: 0, indent: 0, source: " ".repeat(seqIndent) },
      { type: "seq-item-ind", offset: 0, indent: seqIndent, source: "-" },
      { type: "space", offset: 0, indent: seqIndent, source: " " },
    ],
    value: { type: "block-map", offset: 0, indent: mapIndent, items },
  };
}

/* ·· CST navigation ··················································· */

/** Find the document token in a CST token stream. */
function findCstDocument(tokens: CstNode[]): CstNode | null {
  return tokens.find((t: CstNode) => t.type === "document") ?? null;
}

/** Find an item in a block-map by key source text. */
function findCstMapEntry(
  blockMap: CstNode,
  keyName: string,
): CstNode | null {
  return (
    blockMap.items?.find(
      (item: CstNode) => item.key?.source === keyName,
    ) ?? null
  );
}

/** Get the index of a map entry by key source text (−1 if missing). */
function findCstMapIndex(blockMap: CstNode, keyName: string): number {
  return (
    blockMap.items?.findIndex(
      (item: CstNode) => item.key?.source === keyName,
    ) ?? -1
  );
}

/** Read the plain-text id from a CST block-map (comment). */
function cstCommentId(blockMap: CstNode): string | null {
  const entry = findCstMapEntry(blockMap, "id");
  if (!entry?.value?.source) return null;
  const src: string = entry.value.source;
  // Strip quotes if present
  if (src.startsWith('"') && src.endsWith('"')) {
    return src.slice(1, -1);
  }
  return src;
}

/* ·· CST mutation ····················································· */

/**
 * Update an existing scalar CST value's source text.
 * Returns true if the source was actually changed.
 */
function updateCstScalar(entry: CstNode, newValue: unknown): boolean {
  const newSrc = valueToSource(newValue);
  if (entry.value?.source === newSrc) return false;
  entry.value.source = newSrc;
  // If type changed (e.g. plain → quoted), update it too
  entry.value.type = valueType(newValue);
  return true;
}

/**
 * Synchronize a plain Comment object into a CST block-map, preserving
 * untouched scalars byte-for-byte.
 *
 * @param blockMap   CST block-map node for the comment
 * @param comment    New model values to write
 * @param currentValues  Already-parsed values from the existing YAML
 *                       (used to detect real changes vs source-format
 *                       differences like quoted vs folded scalars)
 */
function syncCommentToCst(
  blockMap: CstNode,
  comment: Comment,
  currentValues: Record<string, unknown>,
): void {
  const commentRec = comment as Record<string, unknown>;

  // Collect existing key names
  const existingKeys = new Set<string>();
  for (const item of blockMap.items ?? []) {
    if (item.key?.source) existingKeys.add(item.key.source as string);
  }

  const allKeys = new Set([...existingKeys, ...Object.keys(comment)]);
  const indent = blockMap.indent ?? 4;

  for (const key of allKeys) {
    const newVal = commentRec[key];

    if (newVal === undefined) {
      // Removed from model → delete from CST
      if (existingKeys.has(key)) {
        const idx = findCstMapIndex(blockMap, key);
        if (idx >= 0) blockMap.items.splice(idx, 1);
      }
      continue;
    }

    const entry = findCstMapEntry(blockMap, key);
    if (entry) {
      // Existing key — compare PARSED values (not source text) to detect
      // real semantic changes.  This avoids touching block scalars, quoted
      // strings, etc. whose source representation differs but whose parsed
      // value is identical.
      const currentVal = currentValues[key];
      if (deepEqual(currentVal, newVal)) {
        // Value unchanged — leave the CST node byte-for-byte
        continue;
      }
      // Value really changed — update source
      updateCstScalar(entry, newVal);
    } else {
      // New key — insert at end
      blockMap.items.push(makeCstMapItem(key, newVal, indent, false));
    }
  }
}

/**
 * Simple deep-equal for scalars and basic types (sufficient for MRSF
 * Comment field values which are strings, numbers, and booleans).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  // Handle number comparison with potential string/number mismatch from YAML
  if (typeof a === "number" && typeof b === "number") return a === b;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Serialize an MrsfDocument to YAML (for new files / non-round-trip use).
 */
export function toYaml(doc: MrsfDocument): string {
  const yamlDoc = new Document(doc);
  return yamlDoc.toString({ lineWidth: 0 });
}

/**
 * Serialize an MrsfDocument to JSON.
 */
export function toJson(doc: MrsfDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Write an MrsfDocument to disk.
 *
 * When a YAML file already exists on disk, performs a **CST-level** round-trip
 * merge that preserves YAML comments, scalar styles, key ordering, and
 * whitespace byte-for-byte for unchanged content.
 *
 * For new files or JSON, writes from scratch.
 *
 * Writes to the same file path are serialized (queued) to prevent race
 * conditions from concurrent calls.  All writes are atomic (temp + rename).
 */
export async function writeSidecar(
  filePath: string,
  doc: MrsfDocument,
): Promise<void> {
  const abs = path.resolve(filePath);
  return enqueueWrite(abs, () => writeSidecarInternal(abs, doc));
}

/**
 * Internal implementation of writeSidecar (runs inside the per-file queue).
 */
async function writeSidecarInternal(
  abs: string,
  doc: MrsfDocument,
): Promise<void> {
  const isJson = abs.endsWith(".review.json");

  if (isJson) {
    // For JSON, always sync hashes and write fresh
    for (const comment of doc.comments) syncHash(comment);
    await atomicWriteFile(abs, toJson(doc));
    return;
  }

  // ── YAML round-trip path ──────────────────────────────────────────

  if (!existsSync(abs)) {
    for (const comment of doc.comments) syncHash(comment);
    await atomicWriteFile(abs, toYaml(doc));
    return;
  }

  let raw: string;
  try {
    raw = await readFile(abs, "utf-8");
  } catch {
    await atomicWriteFile(abs, toYaml(doc));
    return;
  }

  // Parse to CST tokens
  let tokens: CstNode[];
  try {
    tokens = [...new Parser().parse(raw)];
  } catch {
    // Unparseable — write fresh
    await atomicWriteFile(abs, toYaml(doc));
    return;
  }

  // Also parse to plain JS object for value comparison (so we compare
  // parsed values, not source-text representations)
  let currentDoc: MrsfDocument | null = null;
  try {
    currentDoc = yamlParse(raw) as MrsfDocument;
  } catch {
    // ignore — we'll fall through to source-level comparison
  }

  // ── Structural validation of parsed YAML ──────────────────────────
  // If CST parsed OK but the content isn't a valid MrsfDocument shape
  // (e.g. comments is not an array due to injection), discard and write fresh.
  if (currentDoc && (!Array.isArray(currentDoc.comments))) {
    await atomicWriteFile(abs, toYaml(doc));
    return;
  }

  // Build lookup of current parsed values by comment id
  const currentById = new Map<string, Record<string, unknown>>();
  if (currentDoc?.comments) {
    for (const c of currentDoc.comments) {
      if (c.id) currentById.set(c.id, c as Record<string, unknown>);
    }
  }

  // Sync hashes: for existing comments, only add selected_text_hash
  // if selected_text actually changed or hash was already present.
  // For new comments, always sync.
  for (const comment of doc.comments) {
    const cur = currentById.get(comment.id);
    if (!cur) {
      // New comment — always sync hash
      syncHash(comment);
    } else {
      // Existing comment — only sync hash if text changed or hash
      // was already tracked in the original
      const textChanged = !deepEqual(cur.selected_text, comment.selected_text);
      const hadHash = cur.selected_text_hash !== undefined;
      if (textChanged || hadHash) {
        syncHash(comment);
      } else {
        // Don't inject a hash that wasn't there before
        delete comment.selected_text_hash;
      }
    }
  }

  const docToken = findCstDocument(tokens);
  if (!docToken?.value || docToken.value.type !== "block-map") {
    await atomicWriteFile(abs, toYaml(doc));
    return;
  }

  const body: CstNode = docToken.value;

  // ── Update top-level scalars ──────────────────────────────────────

  const versionEntry = findCstMapEntry(body, "mrsf_version");
  if (versionEntry && !deepEqual(currentDoc?.mrsf_version, doc.mrsf_version)) {
    updateCstScalar(versionEntry, doc.mrsf_version);
  }

  const documentEntry = findCstMapEntry(body, "document");
  if (documentEntry && !deepEqual(currentDoc?.document, doc.document)) {
    updateCstScalar(documentEntry, doc.document);
  }

  // ── Merge comments ────────────────────────────────────────────────

  const commentsEntry = findCstMapEntry(body, "comments");
  if (!commentsEntry?.value || commentsEntry.value.type !== "block-seq") {
    // No existing comments seq — write fresh
    await atomicWriteFile(abs, toYaml(doc));
    return;
  }

  const seq: CstNode = commentsEntry.value;
  const seqIndent: number = seq.indent ?? 2;

  // Index existing CST comments by id
  const existingById = new Map<string, { index: number; map: CstNode }>();
  for (let i = 0; i < seq.items.length; i++) {
    const item = seq.items[i];
    const map = item.value;
    if (map?.type === "block-map") {
      const id = cstCommentId(map);
      if (id) existingById.set(id, { index: i, map });
    }
  }

  // Build new seq items list, preserving existing CST nodes (and their
  // YAML comments / formatting) for comments that still exist.
  const idsInDoc = new Set(doc.comments.map((c) => c.id));
  const newSeqItems: CstNode[] = [];

  for (const comment of doc.comments) {
    const existing = existingById.get(comment.id);
    if (existing) {
      // Round-trip: sync changes into the existing CST block-map
      const currentValues = currentById.get(comment.id) ?? {};
      syncCommentToCst(existing.map, comment, currentValues);
      // Re-use the original seq item (preserves preceding YAML comments
      // in the item's `start` tokens)
      newSeqItems.push(seq.items[existing.index]);
    } else {
      // Brand new comment — construct CST from scratch
      newSeqItems.push(makeCstSeqItem(comment, seqIndent));
    }
  }

  seq.items = newSeqItems;

  // ── Fix first-item indentation after reorder / removal ────────────
  //
  // In the YAML CST, the `comments:` map-entry's `sep` array often
  // contains trailing whitespace (space tokens) that provide the indent
  // *before* the first seq-item indicator (`-`).  Non-first seq items
  // carry their own leading space tokens in `start`.
  //
  // When the original first item is removed and a formerly non-first
  // item becomes the new first, those extra space tokens stack with
  // the sep whitespace, doubling the indent.  We fix this by stripping
  // any leading space tokens (before the `seq-item-ind`) from the new
  // first item's start — the sep already provides that whitespace.
  //
  // We also ensure the previous item's value ends with a newline so
  // subsequent items render on their own line.
  // ──────────────────────────────────────────────────────────────────

  if (newSeqItems.length > 0) {
    const originalFirstIdx = seq.items === newSeqItems ? 0 : -1; // always true after assignment
    const origFirstItem = existingById.size > 0
      ? [...existingById.values()].find((e) => e.index === 0)
      : undefined;

    const newFirst = newSeqItems[0];

    // Check if the new first item is NOT the original first item
    const isOriginalFirst =
      origFirstItem &&
      seq.items[0]?.value === origFirstItem.map;

    if (!isOriginalFirst && newFirst.start) {
      // Strip leading space tokens before the seq-item-ind
      const dashIdx = newFirst.start.findIndex(
        (t: CstNode) => t.type === "seq-item-ind",
      );
      if (dashIdx > 0) {
        // Remove all tokens before the dash that are space/newline
        const toRemove = newFirst.start
          .slice(0, dashIdx)
          .every((t: CstNode) => t.type === "space" || t.type === "newline");
        if (toRemove) {
          newFirst.start.splice(0, dashIdx);
        }
      }
    }
  }
  // ── Stringify via CST (byte-identical for untouched content) ───────

  const result = tokens.map((t: CstNode) => CST.stringify(t)).join("");
  await atomicWriteFile(abs, result);
}

/**
 * MRSF Parser — load and parse MRSF sidecar files (YAML or JSON).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { MrsfDocument, Comment } from "./types.js";

// ---------------------------------------------------------------------------
// Lenient parse result
// ---------------------------------------------------------------------------

/** Result from a lenient (non-throwing) parse attempt. */
export interface LenientParseResult {
  /** Fully parsed document, or null if parsing failed entirely. */
  doc: MrsfDocument | null;
  /** If parsing failed or produced warnings, the error message. */
  error?: string;
  /** Comments that could be salvaged from a partially-corrupted sidecar. */
  partialComments?: Comment[];
}

/**
 * Parse an MRSF sidecar file from disk.
 */
export async function parseSidecar(filePath: string): Promise<MrsfDocument> {
  const abs = path.resolve(filePath);
  const content = await readFile(abs, "utf-8");
  return parseSidecarContent(content, abs);
}

/**
 * Parse MRSF sidecar content from a string.
 * Detects JSON vs YAML based on content or optional filename hint.
 */
export function parseSidecarContent(
  content: string,
  filenameHint?: string,
): MrsfDocument {
  const trimmed = content.trim();

  let parsed: unknown;

  // Detect JSON by content or filename
  const isJson =
    trimmed.startsWith("{") ||
    (filenameHint && filenameHint.endsWith(".review.json"));

  if (isJson) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Failed to parse JSON: ${(e as Error).message}`);
    }
  } else {
    try {
      parsed = yaml.load(trimmed, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      throw new Error(`Failed to parse YAML: ${(e as Error).message}`);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MRSF sidecar must be a YAML/JSON object");
  }

  return parsed as MrsfDocument;
}

/**
 * Lenient parse: attempts to parse a sidecar file from disk without
 * throwing.  On complete failure, returns `{ doc: null, error }`.
 * On success, returns `{ doc }`.  For partially-corrupted YAML (where
 * the top-level parses but some comments are malformed), attempts to
 * salvage individual well-formed comments.
 */
export async function parseSidecarLenient(
  filePath: string,
): Promise<LenientParseResult> {
  const abs = path.resolve(filePath);
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch (e) {
    return { doc: null, error: `Cannot read file: ${(e as Error).message}` };
  }

  return parseSidecarContentLenient(content, abs);
}

/**
 * Lenient parse from string content.
 */
export function parseSidecarContentLenient(
  content: string,
  filenameHint?: string,
): LenientParseResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { doc: null, error: "File is empty" };
  }

  const isJson =
    trimmed.startsWith("{") ||
    (filenameHint && filenameHint.endsWith(".review.json"));

  // First, try a normal parse
  let parsed: unknown;
  try {
    parsed = isJson ? JSON.parse(trimmed) : yaml.load(trimmed, { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    // Total parse failure — try to salvage what we can from YAML
    if (!isJson) {
      return salvageYaml(trimmed);
    }
    return { doc: null, error: `Failed to parse JSON: ${(e as Error).message}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { doc: null, error: "MRSF sidecar must be a YAML/JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  const doc: MrsfDocument = {
    mrsf_version: typeof obj.mrsf_version === "string" ? obj.mrsf_version : "1.0",
    document: typeof obj.document === "string" ? obj.document : "unknown",
    comments: [],
  };

  if (!Array.isArray(obj.comments)) {
    return {
      doc,
      error: "comments field is not an array — file may be corrupted",
    };
  }

  // Validate each comment individually
  const good: Comment[] = [];
  const bad: number[] = [];

  for (let i = 0; i < obj.comments.length; i++) {
    const c = obj.comments[i];
    if (c && typeof c === "object" && !Array.isArray(c) && typeof (c as Record<string, unknown>).id === "string") {
      good.push(c as Comment);
    } else {
      bad.push(i);
    }
  }

  doc.comments = good;

  if (bad.length > 0) {
    return {
      doc,
      error: `${bad.length} comment(s) at indices [${bad.join(", ")}] were malformed and skipped`,
      partialComments: good,
    };
  }

  return { doc };
}

/**
 * Attempt to extract individual comment blocks from corrupted YAML by
 * splitting on `- id:` patterns and parsing each block independently.
 */
function salvageYaml(content: string): LenientParseResult {
  const salvaged: Comment[] = [];
  let mrsf_version = "1.0";
  let document = "unknown";

  // Try to extract top-level fields from the beginning
  const versionMatch = content.match(/^mrsf_version:\s*["']?([^"'\n]+)/m);
  if (versionMatch) mrsf_version = versionMatch[1].trim();

  const docMatch = content.match(/^document:\s*["']?([^"'\n]+)/m);
  if (docMatch) document = docMatch[1].trim();

  // Split on comment block boundaries (- id: ...)
  const blocks = content.split(/(?=^  - id:\s)/m);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("- id:")) continue;

    // Wrap in a minimal YAML array context and try to parse
    try {
      const parsed = yaml.load(trimmed, { schema: yaml.JSON_SCHEMA });
      if (Array.isArray(parsed) && parsed.length > 0) {
        const c = parsed[0];
        if (c && typeof c === "object" && typeof (c as Record<string, unknown>).id === "string") {
          salvaged.push(c as Comment);
        }
      } else if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).id === "string") {
        salvaged.push(parsed as Comment);
      }
    } catch {
      // This block is unparseable — skip
    }
  }

  const doc: MrsfDocument = {
    mrsf_version,
    document,
    comments: salvaged,
  };

  return {
    doc: salvaged.length > 0 ? doc : null,
    error: `YAML parse failed. Salvaged ${salvaged.length} comment(s) from raw content.`,
    partialComments: salvaged.length > 0 ? salvaged : undefined,
  };
}

/**
 * Read a Markdown document from disk and return its lines.
 * Lines are 1-indexed in the returned array (index 0 is unused).
 */
export async function readDocumentLines(
  filePath: string,
): Promise<string[]> {
  const content = await readFile(path.resolve(filePath), "utf-8");
  const lines = content.split("\n");
  // Prepend empty element so lines[1] = first line (1-based)
  return ["", ...lines];
}

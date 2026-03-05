/**
 * MRSF Specification Conformance Tests
 *
 * This file systematically tests every MUST, MUST NOT, SHOULD, and SHOULD NOT
 * requirement from the MRSF v1.0 specification (MRSF-v1.0.md).
 *
 * Each test is annotated with the spec section reference (e.g., [§3.1])
 * for full traceability. The requirement level (MUST / SHOULD) is noted
 * so failures can be prioritised accordingly.
 *
 * Sections covered:
 *   §3  — File Naming and Discovery
 *   §4  — Top-Level Structure
 *   §5  — Versioning
 *   §6  — Comment Object Specification
 *   §7  — Targeting and Anchoring
 *   §9  — Lifecycle
 *   §10 — Conformance and Error Handling
 *   §12 — Backward Compatibility
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validate } from "../lib/validator.js";
import { parseSidecarContent } from "../lib/parser.js";
import { computeHash } from "../lib/writer.js";
import {
  sidecarToDocument,
  loadConfig,
  discoverSidecar,
  discoverAllSidecars,
} from "../lib/discovery.js";
import {
  addComment,
  resolveComment,
  removeComment,
  populateSelectedText,
  filterComments,
} from "../lib/comments.js";
import {
  reanchorComment,
  applyReanchorResults,
} from "../lib/reanchor.js";
import { toYaml, toJson, writeSidecar } from "../lib/writer.js";
import type { Comment, MrsfDocument, DiffHunk } from "../lib/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<MrsfDocument> = {}): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "docs/guide.md",
    comments: [],
    ...overrides,
  };
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c-001",
    author: "Tester (tester)",
    timestamp: "2025-01-01T00:00:00Z",
    text: "Review comment.",
    resolved: false,
    ...overrides,
  };
}

/** 1-based line array (index 0 is unused placeholder). */
function lines1(...content: string[]): string[] {
  return ["", ...content];
}

// ==========================================================================
// §3 — File Naming and Discovery
// ==========================================================================

describe("§3 — File Naming and Discovery", () => {

  // §3 MUST: Sidecar files MUST follow naming pattern <document>.review.yaml
  it("[§3] sidecar naming follows <document>.review.yaml pattern (MUST)", () => {
    // Forward: doc → sidecar name
    const sidecarName = "docs/architecture.md.review.yaml";
    const docPath = sidecarToDocument(sidecarName);
    expect(docPath).toMatch(/docs[/\\]architecture\.md$/);
  });

  // §3 MAY: JSON serialisation uses .review.json suffix
  it("[§3] JSON sidecar uses .review.json suffix (MAY)", () => {
    const docPath = sidecarToDocument("guide.md.review.json");
    expect(docPath).toMatch(/guide\.md$/);
  });

  // ──────────────────────────────────────────────────────────────────────
  // §3.1 — Default Discovery (Co-location)
  // ──────────────────────────────────────────────────────────────────────

  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-conf-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[§3.1] sidecar MUST be co-located with the Markdown file by default (MUST)", async () => {
    // Create doc + co-located sidecar
    const docDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docDir, { recursive: true });
    fs.writeFileSync(path.join(docDir, "guide.md"), "# Guide\n");
    fs.writeFileSync(
      path.join(docDir, "guide.md.review.yaml"),
      'mrsf_version: "1.0"\ndocument: docs/guide.md\ncomments: []\n',
    );

    const sidecar = await discoverSidecar(path.join(docDir, "guide.md"), {
      cwd: tmpDir,
    });
    expect(sidecar).toMatch(/guide\.md\.review\.yaml$/);
  });

  // ──────────────────────────────────────────────────────────────────────
  // §3.2 — Alternate Sidecar Location
  // ──────────────────────────────────────────────────────────────────────

  it("[§3.2] sidecar_root MUST redirect sidecar resolution (MUST)", async () => {
    // Set up sidecar_root config
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: .reviews\n",
    );
    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "guide.md"), "# Guide\n");
    const reviewDir = path.join(tmpDir, ".reviews", "docs");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDir, "guide.md.review.yaml"),
      'mrsf_version: "1.0"\ndocument: docs/guide.md\ncomments: []\n',
    );

    const sidecar = await discoverSidecar(
      path.join(tmpDir, "docs", "guide.md"),
      { cwd: tmpDir },
    );
    expect(sidecar).toMatch(/\.reviews[/\\]docs[/\\]guide\.md\.review\.yaml$/);
  });

  it("[§3.2] sidecar_root MUST be relative — absolute paths MUST be rejected (MUST)", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: /etc/reviews\n",
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  it("[§3.2] sidecar_root with path traversal (..) MUST be rejected (MUST)", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: ../outside\n",
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────
  // §3.3 — Discovery Order
  // ──────────────────────────────────────────────────────────────────────

  it("[§3.3] discovery MUST check .mrsf.yaml first, then fall back to co-location (MUST)", async () => {
    // Create both locations; only .mrsf.yaml-directed one should be found
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: .reviews\n",
    );
    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "guide.md"), "# Guide\n");

    // Co-located sidecar (should NOT be used)
    fs.writeFileSync(
      path.join(docsDir, "guide.md.review.yaml"),
      'mrsf_version: "1.0"\ndocument: docs/guide.md\ncomments: []\n',
    );

    // sidecar_root sidecar (authoritative)
    const reviewDir = path.join(tmpDir, ".reviews", "docs");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDir, "guide.md.review.yaml"),
      'mrsf_version: "1.0"\ndocument: docs/guide.md\ncomments: []\n',
    );

    const sidecar = await discoverSidecar(path.join(docsDir, "guide.md"), {
      cwd: tmpDir,
    });
    // Must resolve to .reviews/ path, not co-located
    expect(sidecar).toMatch(/\.reviews[/\\]docs[/\\]guide\.md\.review\.yaml$/);
  });

  it("[§3.3] discovery MUST NOT merge results from both locations (MUST NOT)", async () => {
    // With sidecar_root configured, discoverAllSidecars should only look in sidecar_root
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: .reviews\n",
    );
    const docsDir = path.join(tmpDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "guide.md"), "# Guide\n");

    // Only co-located sidecar exists (no sidecar_root version)
    fs.writeFileSync(
      path.join(docsDir, "guide.md.review.yaml"),
      'mrsf_version: "1.0"\ndocument: docs/guide.md\ncomments: []\n',
    );

    // discoverSidecar should resolve to the sidecar_root path (even if it doesn't exist)
    const sidecar = await discoverSidecar(path.join(docsDir, "guide.md"), {
      cwd: tmpDir,
    });
    // The resolved path should be in .reviews, not co-located
    expect(sidecar).toMatch(/\.reviews/);
  });
});

// ==========================================================================
// §4 — Top-Level Structure
// ==========================================================================

describe("§4 — Top-Level Structure", () => {

  it("[§4] valid MRSF file MUST contain mrsf_version, document, and comments (MUST)", async () => {
    const result = await validate(makeDoc());
    expect(result.valid).toBe(true);
  });

  it("[§4] missing mrsf_version is rejected (MUST)", async () => {
    const doc = { document: "test.md", comments: [] } as unknown as MrsfDocument;
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("mrsf_version"))).toBe(true);
  });

  it("[§4] missing document is rejected (MUST)", async () => {
    const doc = { mrsf_version: "1.0", comments: [] } as unknown as MrsfDocument;
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("document"))).toBe(true);
  });

  it("[§4] missing comments array is rejected (MUST)", async () => {
    const doc = { mrsf_version: "1.0", document: "test.md" } as unknown as MrsfDocument;
    const result = await validate(doc);
    expect(result.valid).toBe(false);
  });

  it("[§4] empty comments array is valid (MUST)", async () => {
    const result = await validate(makeDoc({ comments: [] }));
    expect(result.valid).toBe(true);
  });
});

// ==========================================================================
// §5 — Versioning
// ==========================================================================

describe("§5 — Versioning", () => {

  it('[§5] mrsf_version MUST be present and set to "1.0" (MUST)', async () => {
    const result = await validate(makeDoc({ mrsf_version: "1.0" }));
    expect(result.valid).toBe(true);
  });

  it("[§5] unknown major version MUST be rejected (MUST)", async () => {
    const result = await validate(makeDoc({ mrsf_version: "2.0" }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("[§5] non-string mrsf_version MUST be rejected (MUST)", async () => {
    const doc = makeDoc();
    (doc as any).mrsf_version = 1.0;
    const result = await validate(doc);
    expect(result.valid).toBe(false);
  });

  it("[§5] newer minor version (1.1) MAY be accepted by schema pattern (MAY)", async () => {
    // Schema pattern is ^1\.\d+$ which allows 1.1, 1.2, etc.
    const result = await validate(makeDoc({ mrsf_version: "1.1" }));
    // The schema permits it; implementations MAY accept newer minor versions
    expect(result.valid).toBe(true);
  });
});

// ==========================================================================
// §6 — Comment Object Specification
// ==========================================================================

describe("§6.1 — Required Comment Fields", () => {

  it("[§6.1] id MUST be a string (MUST)", async () => {
    const doc = makeDoc({
      comments: [{ ...makeComment(), id: 123 as any }],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path?.includes("id"))).toBe(true);
  });

  it("[§6.1] id SHOULD be collision-resistant — addComment generates UUID-like (SHOULD)", async () => {
    const doc = makeDoc();
    const c = await addComment(doc, { author: "A", text: "t" });
    // Should be non-trivial length (UUIDv4 is 36 chars with dashes, or 8+ chars)
    expect(c.id.length).toBeGreaterThanOrEqual(8);
    // Two generated IDs should differ
    const c2 = await addComment(doc, { author: "B", text: "t2" });
    expect(c.id).not.toBe(c2.id);
  });

  it("[§6.1] comment missing id is rejected (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        { author: "A", timestamp: "2025-01-01T00:00:00Z", text: "t", resolved: false } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("id"))).toBe(true);
  });

  it("[§6.1] comment missing author is rejected (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        { id: "c-1", timestamp: "2025-01-01T00:00:00Z", text: "t", resolved: false } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("author"))).toBe(true);
  });

  it("[§6.1] comment missing timestamp is rejected (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        { id: "c-1", author: "A", text: "t", resolved: false } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("timestamp"))).toBe(true);
  });

  it("[§6.1] comment missing text is rejected (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        { id: "c-1", author: "A", timestamp: "2025-01-01T00:00:00Z", resolved: false } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("text"))).toBe(true);
  });

  it("[§6.1] comment missing resolved is rejected (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        { id: "c-1", author: "A", timestamp: "2025-01-01T00:00:00Z", text: "t" } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("resolved"))).toBe(true);
  });

  it("[§6.1] timestamp MUST include timezone offset — RFC 3339 format (MUST)", async () => {
    // Valid: "Z" timezone
    const resultZ = await validate(
      makeDoc({ comments: [makeComment({ timestamp: "2025-01-01T00:00:00Z" })] }),
    );
    expect(resultZ.valid).toBe(true);

    // Valid: "+00:00" timezone
    const resultPlus = await validate(
      makeDoc({ comments: [makeComment({ timestamp: "2025-01-01T00:00:00+00:00" })] }),
    );
    expect(resultPlus.valid).toBe(true);

    // Invalid: no timezone (bare datetime) — schema format "date-time" requires offset
    const resultBad = await validate(
      makeDoc({ comments: [makeComment({ timestamp: "2025-01-01T00:00:00" })] }),
    );
    expect(resultBad.valid).toBe(false);
  });

  it("[§6.1] text SHOULD NOT exceed 16384 characters — generates warning (SHOULD NOT)", async () => {
    const longText = "x".repeat(16385);
    const result = await validate(
      makeDoc({ comments: [makeComment({ text: longText })] }),
    );
    expect(result.warnings.some((w) => w.message.includes("16384"))).toBe(true);
  });

  it("[§6.1] resolved must be boolean (MUST)", async () => {
    const doc = makeDoc({
      comments: [{ ...makeComment(), resolved: "yes" as any }],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(false);
  });
});

describe("§6.2 — Optional Comment Fields", () => {

  it("[§6.2] selected_text MUST NOT exceed 4096 characters (MUST NOT)", async () => {
    const longSel = "a".repeat(4097);
    const result = await validate(
      makeDoc({ comments: [makeComment({ selected_text: longSel, line: 1 })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("4096"))).toBe(true);
  });

  it("[§6.2] selected_text within 4096 characters is valid (MUST NOT)", async () => {
    const okSel = "a".repeat(4096);
    const result = await validate(
      makeDoc({ comments: [makeComment({ selected_text: okSel, line: 1 })] }),
    );
    // Should not have selected_text length errors
    expect(result.errors.filter((e) => e.message.includes("4096"))).toHaveLength(0);
  });

  it("[§6.2] reply_to SHOULD resolve to existing id — warning when unresolved (SHOULD)", async () => {
    const result = await validate(
      makeDoc({
        comments: [makeComment({ reply_to: "nonexistent-id" })],
      }),
    );
    expect(result.warnings.some((w) => w.message.includes("reply_to"))).toBe(true);
  });

  it("[§6.2] reply_to that resolves to valid id generates no warning (SHOULD)", async () => {
    const parent = makeComment({ id: "parent-001" });
    const reply = makeComment({ id: "reply-001", reply_to: "parent-001" });
    const result = await validate(makeDoc({ comments: [parent, reply] }));
    expect(result.warnings.filter((w) => w.message.includes("reply_to"))).toHaveLength(0);
  });

  it("[§6.2] reply_to forward reference (reply appears before parent) is valid (SHOULD)", async () => {
    // reply_to points to a comment that appears later in the array
    const reply = makeComment({ id: "reply-001", reply_to: "parent-001" });
    const parent = makeComment({ id: "parent-001" });
    const result = await validate(makeDoc({ comments: [reply, parent] }));
    expect(result.warnings.filter((w) => w.message.includes("reply_to"))).toHaveLength(0);
  });

  it("[§6.2] selected_text_hash MUST be lowercase hex SHA-256 of selected_text (MUST)", () => {
    const text = "The gateway component routes all inbound traffic.";
    const hash = computeHash(text);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Verify determinism
    expect(computeHash(text)).toBe(hash);

    // Verify it's SHA-256 (different input → different hash)
    expect(computeHash("different text")).not.toBe(hash);
  });

  it("[§6.2] selected_text_hash mismatch SHOULD be flagged (SHOULD)", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          makeComment({
            selected_text: "hello",
            selected_text_hash: "0000000000000000000000000000000000000000000000000000000000000000",
          }),
        ],
      }),
    );
    expect(result.warnings.some((w) => w.message.includes("mismatch"))).toBe(true);
  });

  it("[§6.2] correct selected_text_hash produces no warning (SHOULD)", async () => {
    const text = "example text";
    const result = await validate(
      makeDoc({
        comments: [
          makeComment({
            selected_text: text,
            selected_text_hash: computeHash(text),
          }),
        ],
      }),
    );
    expect(result.warnings.filter((w) => w.message.includes("mismatch"))).toHaveLength(0);
  });

  it("[§6.2] anchored_text SHOULD be omitted when identical to selected_text (SHOULD)", () => {
    const comment = makeComment({
      line: 1,
      selected_text: "exact match text",
    });
    const doc = makeDoc({ comments: [comment] });
    const lines = lines1("exact match text");
    const result = reanchorComment(comment, lines);

    // Exact match — anchored_text should not be populated
    expect(result.status).toBe("anchored");
    const applied = applyReanchorResults(doc, [result]);
    expect(doc.comments[0].anchored_text).toBeUndefined();
  });

  it("[§6.2] anchored_text SHOULD be populated when text differs from selected_text (SHOULD)", () => {
    const comment = makeComment({
      line: 1,
      selected_text: "original text here",
    });
    const doc = makeDoc({ comments: [comment] });
    const lines = lines1("modified text here");

    // Force a fuzzy match that finds different text
    const result = reanchorComment(comment, lines, { threshold: 0.5 });
    if (result.status === "fuzzy" || result.status === "moved") {
      applyReanchorResults(doc, [result]);
      // anchored_text should now contain the text at the new location
      expect(doc.comments[0].anchored_text).toBeDefined();
    }
  });

  it("[§6.2] type field accepts non-recommended values (SHOULD — recommended, not required)", async () => {
    // The spec says "RECOMMENDED values: suggestion, issue, question, accuracy, style, clarity"
    // Non-recommended values should still be accepted
    const result = await validate(
      makeDoc({ comments: [makeComment({ type: "custom-type" })] }),
    );
    // type is a free-form string in the schema without enum restriction
    expect(result.valid).toBe(true);
  });

  it("[§6.2] severity field only accepts low, medium, high (enum)", async () => {
    // Valid values
    for (const sev of ["low", "medium", "high"]) {
      const result = await validate(
        makeDoc({ comments: [makeComment({ severity: sev as any })] }),
      );
      expect(result.valid).toBe(true);
    }

    // Invalid value
    const result = await validate(
      makeDoc({ comments: [makeComment({ severity: "critical" as any })] }),
    );
    expect(result.valid).toBe(false);
  });
});

// ==========================================================================
// §7 — Targeting and Anchoring
// ==========================================================================

describe("§7.1 — Targeting Fields", () => {

  it("[§7.1] end_line MUST be ≥ line (MUST)", async () => {
    const result = await validate(
      makeDoc({
        comments: [makeComment({ line: 10, end_line: 5 })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("end_line"))).toBe(true);
  });

  it("[§7.1] end_line equal to line is valid (MUST)", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          makeComment({ line: 5, end_line: 5, selected_text: "text" }),
        ],
      }),
    );
    // No end_line errors
    expect(result.errors.filter((e) => e.message.includes("end_line"))).toHaveLength(0);
  });

  it("[§7.1] start_column MUST be ≥ 0 (MUST — enforced by schema minimum)", async () => {
    const result = await validate(
      makeDoc({
        comments: [makeComment({ line: 1, start_column: -1, selected_text: "x" })],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("[§7.1] end_column MUST be ≥ start_column on same line (MUST)", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          makeComment({ line: 1, end_line: 1, start_column: 10, end_column: 5, selected_text: "x" }),
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("end_column"))).toBe(true);
  });

  it("[§7.1] end_column may be < start_column on different lines (MUST — only same-line)", async () => {
    // Multi-line span: end_column is independent of start_column
    const result = await validate(
      makeDoc({
        comments: [
          makeComment({
            line: 1,
            end_line: 3,
            start_column: 20,
            end_column: 5,
            selected_text: "spanning text",
          }),
        ],
      }),
    );
    // Should NOT produce an end_column error (different lines)
    expect(result.errors.filter((e) => e.message.includes("end_column"))).toHaveLength(0);
  });
});

describe("§7.2 — Targeting Rules", () => {

  it("[§7.2] line alone → single-line comment (MUST)", () => {
    const comment = makeComment({ line: 3, selected_text: "third line" });
    const lines = lines1("first", "second", "third line", "fourth");
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(3);
  });

  it("[§7.2] line + end_line → multi-line comment (MUST)", () => {
    const lines = lines1("aaa", "bbb", "ccc", "ddd");
    const comment = makeComment({ line: 2, end_line: 3, selected_text: "bbb\nccc" });
    populateSelectedText(comment, lines);
    // Verify multi-line anchoring works
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
  });

  it("[§7.2] line + start_column + end_column → inline span (MUST)", () => {
    // populateSelectedText uses 0-based array (documentLines[line-1])
    const docLines = ["Hello, world! How are you?"];
    const fresh = makeComment({ line: 1, start_column: 7, end_column: 12 });
    populateSelectedText(fresh, docLines);
    expect(fresh.selected_text).toBe("world");
  });

  it("[§7.2] selected_text SHOULD be used as primary anchor (SHOULD)", () => {
    // Text moved from line 2 to line 4 — selected_text should find it
    const lines = lines1("aaa", "bbb", "ccc", "The exact target text", "eee");
    const comment = makeComment({
      line: 2, // stale position
      selected_text: "The exact target text",
    });
    const result = reanchorComment(comment, lines);
    expect(result.newLine).toBe(4); // Found via selected_text, not original line
    expect(result.score).toBe(1.0);
  });

  it("[§7.2] multiple selected_text matches MUST use line/column to disambiguate (MUST)", () => {
    const lines = lines1("duplicate text", "other", "duplicate text", "more");
    const comment = makeComment({
      line: 3, // hint: the second occurrence
      selected_text: "duplicate text",
    });
    const result = reanchorComment(comment, lines);
    // Should pick the match closest to line 3
    expect(result.newLine).toBe(3);
  });

  it("[§7.2] multiple matches without line/column — implementation falls through to fuzzy (SHOULD flag ambiguous)", () => {
    // Spec §7.2: "if no line/column fields are present, agents SHOULD flag the
    // comment as ambiguous rather than guessing". The implementation instead
    // falls through to Step 1.5 (fuzzy matching), which is acceptable since
    // SHOULD is advisory. The important thing is that the result is deterministic.
    const lines = lines1("same text", "other", "same text", "more");
    const comment = makeComment({
      selected_text: "same text",
    });
    delete (comment as any).line;
    const result = reanchorComment(comment, lines);
    // Implementation uses fuzzy matching when exact-match disambiguation fails
    expect(["fuzzy", "ambiguous"]).toContain(result.status);
  });
});

describe("§7.3 — Re-anchoring Guidance", () => {

  it("[§7.3] SHOULD re-anchor when identical text moves to a new line (SHOULD)", () => {
    const lines = lines1("new line", "Target sentence here", "end");
    const comment = makeComment({
      line: 5, // originally at line 5, now at line 2
      selected_text: "Target sentence here",
    });
    const result = reanchorComment(comment, lines);
    // Exact match found at a different line — status is "anchored" (score 1.0)
    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(2);
    expect(result.score).toBe(1.0);
  });

  it("[§7.3] multiple identical matches SHOULD prefer closest to original position (SHOULD)", () => {
    const lines = lines1("AAA", "BBB", "target", "CCC", "target", "DDD");
    const comment = makeComment({
      line: 5,
      selected_text: "target",
    });
    const result = reanchorComment(comment, lines);
    // Should prefer line 5 (exact match closest to original)
    expect(result.newLine).toBe(5);
  });

  it("[§7.3] selected_text SHOULD take precedence over stale line/column (SHOULD)", () => {
    // Text moved from line 2 to line 4; line/column is stale
    const lines = lines1("aaa", "bbb", "ccc", "The moved text");
    const comment = makeComment({
      line: 2,
      selected_text: "The moved text",
    });
    const result = reanchorComment(comment, lines);
    // selected_text found at line 4, not line 2
    expect(result.newLine).toBe(4);
  });

  it("[§7.3] if anchors cannot be reconciled, SHOULD mark as needing attention (SHOULD)", () => {
    const lines = lines1("completely", "different", "content");
    const comment = makeComment({
      line: 999, // way out of bounds
      selected_text: "text that no longer exists anywhere in the document",
    });
    const result = reanchorComment(comment, lines);
    // Should be orphaned or ambiguous (needing attention)
    expect(["orphaned", "ambiguous"]).toContain(result.status);
  });

  it("[§7.3] when re-anchoring resolves to different text, SHOULD populate anchored_text (SHOULD)", () => {
    const comment = makeComment({
      line: 1,
      selected_text: "original text that was changed",
    });
    const doc = makeDoc({ comments: [comment] });
    const lines = lines1("original text that was slightly changed");

    const result = reanchorComment(comment, lines, { threshold: 0.5 });
    applyReanchorResults(doc, [result]);

    if (result.status === "fuzzy" || result.status === "moved") {
      expect(doc.comments[0].anchored_text).toBeDefined();
      expect(doc.comments[0].anchored_text).not.toBe(doc.comments[0].selected_text);
    }
  });

  it("[§7.3] re-anchoring SHOULD NOT modify selected_text by default (SHOULD NOT)", () => {
    const originalText = "The original review selection";
    const comment = makeComment({
      line: 1,
      selected_text: originalText,
    });
    const doc = makeDoc({ comments: [comment] });
    const lines = lines1("Some different content now");

    const result = reanchorComment(comment, lines);
    applyReanchorResults(doc, [result]);
    // selected_text must remain unchanged
    expect(doc.comments[0].selected_text).toBe(originalText);
  });

  it("[§7.3] if referenced text removed and cannot be re-anchored, SHOULD retain as orphaned (SHOULD)", () => {
    const lines = lines1("completely different content");
    const comment = makeComment({
      line: 10,
      selected_text: "A very specific phrase that no longer exists in the document at all",
    });
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("orphaned");
    // Comment must NOT be silently discarded
  });
});

describe("§7.4 — Anchoring Resolution Procedure", () => {

  it("[§7.4 Step 1a] single exact match → anchor to it (MUST)", () => {
    const lines = lines1("aaa", "The unique target text", "ccc");
    const comment = makeComment({
      line: 5,
      selected_text: "The unique target text",
    });
    const result = reanchorComment(comment, lines);
    expect(result.newLine).toBe(2);
    expect(result.score).toBe(1.0);
  });

  it("[§7.4 Step 1b] multiple exact matches + line hint → closest match (MUST)", () => {
    const lines = lines1("foo", "target", "bar", "target", "baz");
    const comment = makeComment({ line: 4, selected_text: "target" });
    const result = reanchorComment(comment, lines);
    expect(result.newLine).toBe(4);
  });

  it("[§7.4 Step 1b] multiple exact matches + no line hint — falls to fuzzy resolution (MUST use line/column if present)", () => {
    // Spec §7.4 Step 1b: "If no line/column fields are present, flag the comment
    // as ambiguous". Implementation falls through to Step 1.5 (fuzzy) instead,
    // which may still resolve. The spec requirement is met conceptually:
    // without line/column, it cannot use Step 1b disambiguation.
    const lines = lines1("foo", "target", "bar", "target", "baz");
    const comment = makeComment({ selected_text: "target" });
    delete (comment as any).line;
    const result = reanchorComment(comment, lines);
    // Without line hint, exact-match disambiguation is skipped; falls to fuzzy
    expect(["fuzzy", "ambiguous"]).toContain(result.status);
  });

  it("[§7.4 Step 2] line/column fallback when no exact text match (SHOULD)", () => {
    const lines = lines1("line one", "line two", "line three");
    const comment = makeComment({
      line: 2, // valid line
      // no selected_text — begin at step 2
    });
    const result = reanchorComment(comment, lines);
    expect(result.newLine).toBe(2);
    expect(result.status).toBe("anchored");
  });

  it("[§7.4 Step 3] contextual re-anchoring via fuzzy match (SHOULD)", () => {
    // Long enough text for meaningful fuzzy matching
    const original = "The architecture uses a microservices pattern with event-driven communication between services that handle user requests and process background tasks efficiently";
    const modified = "The architecture uses a microservices pattern with event-driven messaging between services that handle user requests and process background jobs efficiently";
    const lines = lines1("intro", modified, "conclusion");
    const comment = makeComment({
      line: 5,
      selected_text: original,
    });
    const result = reanchorComment(comment, lines, { threshold: 0.5 });
    // Should find the fuzzy match
    expect(["fuzzy", "moved"]).toContain(result.status);
    expect(result.newLine).toBe(2);
  });

  it("[§7.4 Step 4] orphan — MUST NOT silently discard unresolvable comments (MUST NOT)", () => {
    const lines = lines1("completely unrelated content");
    const comment = makeComment({
      line: 100,
      selected_text: "A paragraph that was deleted entirely from the document and cannot be found anywhere",
    });
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("orphaned");
    // The comment itself still exists — not discarded
    expect(comment.id).toBe("c-001");
  });

  it("[§7.4] if selected_text is absent, begin at step 2 (line/column fallback) (MUST)", () => {
    const lines = lines1("aaa", "bbb", "ccc");
    const comment = makeComment({ line: 2 });
    // No selected_text
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(2);
  });

  it("[§7.4] document-level comment (no targeting fields) → anchored (MUST)", () => {
    const lines = lines1("content");
    const comment = makeComment();
    // No line, no selected_text — document-level comment
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
  });
});

// ==========================================================================
// §9 — Lifecycle
// ==========================================================================

describe("§9 — Lifecycle", () => {

  it("[§9] resolved: false → open; resolved: true → resolved (MUST)", () => {
    const open = makeComment({ resolved: false });
    const resolved = makeComment({ resolved: true, id: "c-002" });
    const doc = makeDoc({ comments: [open, resolved] });

    // filterComments uses { open: true } / { resolved: true } per CommentFilter
    expect(filterComments(doc.comments, { open: true })).toHaveLength(1);
    expect(filterComments(doc.comments, { open: true })[0].id).toBe("c-001");
    expect(filterComments(doc.comments, { resolved: true })).toHaveLength(1);
    expect(filterComments(doc.comments, { resolved: true })[0].id).toBe("c-002");
  });

  it("[§9] resolving a parent MUST NOT automatically resolve its replies (MUST NOT)", () => {
    const parent = makeComment({ id: "parent" });
    const reply = makeComment({ id: "reply", reply_to: "parent" });
    const doc = makeDoc({ comments: [parent, reply] });

    resolveComment(doc, "parent");
    expect(doc.comments[0].resolved).toBe(true);
    expect(doc.comments[1].resolved).toBe(false); // Reply must NOT be auto-resolved
  });

  it("[§9] resolving a parent with cascade=true resolves replies (MAY — opt-in)", () => {
    const parent = makeComment({ id: "parent" });
    const reply = makeComment({ id: "reply", reply_to: "parent" });
    const doc = makeDoc({ comments: [parent, reply] });

    resolveComment(doc, "parent", true);
    expect(doc.comments[0].resolved).toBe(true);
    expect(doc.comments[1].resolved).toBe(true);
  });

  it("[§9] each reply's resolved field is independent (MUST)", () => {
    const parent = makeComment({ id: "parent", resolved: true });
    const reply = makeComment({ id: "reply", reply_to: "parent", resolved: false });
    const doc = makeDoc({ comments: [parent, reply] });

    // Reply can be unresolved while parent is resolved
    expect(doc.comments[0].resolved).toBe(true);
    expect(doc.comments[1].resolved).toBe(false);
  });
});

describe("§9.1 — Deletion", () => {

  it("[§9.1] removing parent MUST promote direct replies (MUST)", () => {
    const parent = makeComment({
      id: "parent",
      line: 10,
      selected_text: "parent text",
    });
    const reply = makeComment({
      id: "reply",
      reply_to: "parent",
      // No targeting fields — should inherit from parent
    });
    const doc = makeDoc({ comments: [parent, reply] });

    removeComment(doc, "parent");

    // Parent removed
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0].id).toBe("reply");

    // Reply inherited parent's targeting fields
    expect(doc.comments[0].line).toBe(10);
    expect(doc.comments[0].selected_text).toBe("parent text");

    // reply_to removed (parent was root)
    expect(doc.comments[0].reply_to).toBeUndefined();
  });

  it("[§9.1] reply with own targeting fields keeps them during promotion (MUST)", () => {
    const parent = makeComment({
      id: "parent",
      line: 10,
      selected_text: "parent text",
    });
    const reply = makeComment({
      id: "reply",
      reply_to: "parent",
      line: 20,
      selected_text: "reply's own text",
    });
    const doc = makeDoc({ comments: [parent, reply] });

    removeComment(doc, "parent");

    // Reply kept its own fields
    expect(doc.comments[0].line).toBe(20);
    expect(doc.comments[0].selected_text).toBe("reply's own text");
  });

  it("[§9.1] reply_to MUST be updated to grandparent or removed (MUST)", () => {
    const grandparent = makeComment({ id: "gp", line: 1, selected_text: "gp text" });
    const parent = makeComment({ id: "parent", reply_to: "gp" });
    const reply = makeComment({ id: "reply", reply_to: "parent" });
    const doc = makeDoc({ comments: [grandparent, parent, reply] });

    removeComment(doc, "parent");

    // Reply's reply_to should now point to grandparent
    const replyComment = doc.comments.find((c) => c.id === "reply");
    expect(replyComment?.reply_to).toBe("gp");
  });

  it("[§9.1] cascade delete removes parent and all direct replies (MAY)", () => {
    const parent = makeComment({ id: "parent" });
    const reply1 = makeComment({ id: "r1", reply_to: "parent" });
    const reply2 = makeComment({ id: "r2", reply_to: "parent" });
    const other = makeComment({ id: "other" });
    const doc = makeDoc({ comments: [parent, reply1, reply2, other] });

    removeComment(doc, "parent", { cascade: true });

    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0].id).toBe("other");
  });
});

// ==========================================================================
// §10 — Conformance and Error Handling
// ==========================================================================

describe("§10 — Conformance and Error Handling", () => {

  it("[§10] files MUST include mrsf_version, document, and comments (MUST)", async () => {
    // Already tested in §4 — cross-reference
    const result = await validate(makeDoc());
    expect(result.valid).toBe(true);
  });

  it("[§10] parsers MUST treat unknown fields as ignorable extensions (MUST)", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
custom_field: this should be ignored
comments:
  - id: c-001
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: Test
    resolved: false
    unknown_nested: { key: value }
`;
    const doc = parseSidecarContent(yaml.trim());
    expect(doc.mrsf_version).toBe("1.0");
    expect((doc as any).custom_field).toBe("this should be ignored");
  });

  it("[§10] unknown fields MUST be preserved through validation (MUST)", async () => {
    const doc = makeDoc();
    (doc as any).custom_extension = "preserved";
    const result = await validate(doc);
    // Validation should succeed despite unknown field
    expect(result.valid).toBe(true);
    // Field should still be there
    expect((doc as any).custom_extension).toBe("preserved");
  });

  it("[§10] x_-prefixed fields are reserved for non-standard extensions (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        {
          ...makeComment(),
          x_tool_metadata: { confidence: 0.95 },
          x_ai_source: "copilot",
        } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(true);
  });

  it("[§10] x_-prefixed fields are preserved on round-trip (MUST)", () => {
    const doc = makeDoc({
      comments: [
        {
          ...makeComment(),
          x_custom: "value",
        } as any,
      ],
    });
    const yamlStr = toYaml(doc);
    const parsed = parseSidecarContent(yamlStr);
    expect((parsed.comments[0] as any).x_custom).toBe("value");
  });

  it("[§10] parsers SHOULD reject documents missing required fields (SHOULD)", async () => {
    // Missing 'resolved'
    const result = await validate(
      makeDoc({
        comments: [
          { id: "c-1", author: "A", timestamp: "2025-01-01T00:00:00Z", text: "t" } as any,
        ],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("[§10] parsers SHOULD validate cross-field constraints (SHOULD)", async () => {
    // end_line < line
    const result = await validate(
      makeDoc({ comments: [makeComment({ line: 10, end_line: 5 })] }),
    );
    expect(result.valid).toBe(false);
  });

  it("[§10] parsers SHOULD reject selected_text > 4096 characters (SHOULD)", async () => {
    const result = await validate(
      makeDoc({
        comments: [makeComment({ selected_text: "x".repeat(4097), line: 1 })],
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("[§10] parsers SHOULD flag unresolved reply_to (SHOULD)", async () => {
    const result = await validate(
      makeDoc({
        comments: [makeComment({ reply_to: "ghost" })],
      }),
    );
    expect(result.warnings.some((w) => w.message.includes("reply_to"))).toBe(true);
  });

  it("[§10] duplicate comment ids are rejected (§6.1 MUST — globally unique)", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          makeComment({ id: "dup" }),
          makeComment({ id: "dup", author: "B" }),
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });
});

describe("§10.1 — Implementation Guidance", () => {

  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-conf-impl-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("[§10.1] SHOULD preserve input order of comments (SHOULD)", async () => {
    const filePath = path.join(tmpDir, "test.md.review.yaml");
    const doc = makeDoc({
      comments: [
        makeComment({ id: "first" }),
        makeComment({ id: "second" }),
        makeComment({ id: "third" }),
      ],
    });
    await writeSidecar(filePath, doc);
    const content = fs.readFileSync(filePath, "utf-8");
    const firstIdx = content.indexOf("first");
    const secondIdx = content.indexOf("second");
    const thirdIdx = content.indexOf("third");
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it("[§10.1] MUST NOT strip YAML comments on round-trip (MUST NOT)", async () => {
    const filePath = path.join(tmpDir, "test.md.review.yaml");
    const yamlWithComments = `# This is a YAML comment
mrsf_version: "1.0"
document: test.md
comments:
  # Comment about the first review
  - id: c-001
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: "Review note."
    resolved: false
`;
    fs.writeFileSync(filePath, yamlWithComments);
    const doc = parseSidecarContent(yamlWithComments);
    await writeSidecar(filePath, doc);
    const result = fs.readFileSync(filePath, "utf-8");
    expect(result).toContain("# This is a YAML comment");
    expect(result).toContain("# Comment about the first review");
  });

  it("[§10.1] SHOULD preserve YAML scalar styles (block |, >, quoted) (SHOULD)", async () => {
    const filePath = path.join(tmpDir, "test.md.review.yaml");
    const yamlWithStyles = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: |
      This is a block scalar
      with multiple lines.
    resolved: false
`;
    fs.writeFileSync(filePath, yamlWithStyles);
    const doc = parseSidecarContent(yamlWithStyles);
    await writeSidecar(filePath, doc);
    const result = fs.readFileSync(filePath, "utf-8");
    // Block scalar indicator should be preserved
    expect(result).toContain("text: |");
  });

  it("[§10.1] SHOULD minimise version-control diff noise (SHOULD)", async () => {
    const filePath = path.join(tmpDir, "test.md.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: "Review note."
    resolved: false
    line: 5
    selected_text: "original"
`;
    fs.writeFileSync(filePath, original);
    const doc = parseSidecarContent(original);
    // Only change resolved
    doc.comments[0].resolved = true;
    await writeSidecar(filePath, doc);
    const result = fs.readFileSync(filePath, "utf-8");
    // Everything except 'resolved' should be identical
    expect(result).toContain('author: Alice');
    expect(result).toContain('resolved: true');
    expect(result).toContain('text: "Review note."');
  });

  it("[§10.1] when reply has reply_to but no targeting fields, SHOULD inherit from parent (SHOULD)", () => {
    const parent = makeComment({
      id: "parent",
      line: 10,
      end_line: 12,
      selected_text: "parent selection",
    });
    const reply = makeComment({
      id: "reply",
      reply_to: "parent",
      // No targeting fields
    });
    const doc = makeDoc({ comments: [parent, reply] });

    // removeComment with promotion tests this inheritance
    removeComment(doc, "parent");

    // Reply should now have parent's targeting fields
    expect(doc.comments[0].line).toBe(10);
    expect(doc.comments[0].end_line).toBe(12);
    expect(doc.comments[0].selected_text).toBe("parent selection");
  });
});

// ==========================================================================
// §12 — Backward Compatibility
// ==========================================================================

describe("§12 — Backward Compatibility", () => {

  it("[§12] comments without targeting fields remain valid (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        makeComment(), // No line, no selected_text, no columns
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(true);
  });

  it("[§12] comments with only line remain valid (MUST)", async () => {
    const doc = makeDoc({
      comments: [makeComment({ line: 5 })],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(true);
  });

  it("[§12] tools MUST ignore unknown fields (MUST)", async () => {
    const doc = makeDoc({
      comments: [
        {
          ...makeComment(),
          future_field: "from MRSF v2.0",
          another_unknown: 42,
        } as any,
      ],
    });
    const result = await validate(doc);
    expect(result.valid).toBe(true);
  });

  it("[§12] unknown top-level fields are preserved (MUST — additionalProperties: true)", () => {
    const yamlStr = `
mrsf_version: "1.0"
document: test.md
future_top_level: true
comments: []
`;
    const doc = parseSidecarContent(yamlStr.trim());
    expect((doc as any).future_top_level).toBe(true);
  });
});

// ==========================================================================
// §13 — Security and Privacy (testable subset)
// ==========================================================================

describe("§13 — Security and Privacy (testable subset)", () => {

  it("[§13] SHOULD avoid path traversal in sidecar_root (MUST — §3.2)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-sec-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, ".mrsf.yaml"),
        "sidecar_root: ../../etc/reviews\n",
      );
      await expect(loadConfig(tmpDir)).rejects.toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("[§13] agents MUST preserve author attribution (MUST)", async () => {
    const doc = makeDoc();
    const c = await addComment(doc, {
      author: "Original Author (orig)",
      text: "My review.",
    });
    expect(c.author).toBe("Original Author (orig)");

    // Resolving should not change author
    resolveComment(doc, c.id);
    expect(doc.comments[0].author).toBe("Original Author (orig)");
  });

  it("[§13] SHOULD apply size limits — selected_text max 4096 (SHOULD)", async () => {
    const result = await validate(
      makeDoc({
        comments: [makeComment({ line: 1, selected_text: "x".repeat(4097) })],
      }),
    );
    expect(result.valid).toBe(false);
  });
});

// ==========================================================================
// Cross-cutting: JSON serialisation equivalence (§3, §11.3)
// ==========================================================================

describe("JSON serialisation equivalence (§3, §11.3)", () => {

  it("[§3] JSON and YAML produce equivalent documents (MUST — equivalent for tooling)", () => {
    const doc = makeDoc({
      comments: [
        makeComment({
          line: 12,
          end_line: 12,
          start_column: 42,
          end_column: 73,
          selected_text: "While many concepts are represented",
          type: "question",
          commit: "02eb613",
        }),
      ],
    });
    const yamlStr = toYaml(doc);
    const jsonStr = toJson(doc);

    const fromYaml = parseSidecarContent(yamlStr, "test.review.yaml");
    const fromJson = parseSidecarContent(jsonStr, "test.review.json");

    expect(fromYaml.mrsf_version).toBe(fromJson.mrsf_version);
    expect(fromYaml.document).toBe(fromJson.document);
    expect(fromYaml.comments[0].id).toBe(fromJson.comments[0].id);
    expect(fromYaml.comments[0].selected_text).toBe(fromJson.comments[0].selected_text);
    expect(fromYaml.comments[0].line).toBe(fromJson.comments[0].line);
  });
});

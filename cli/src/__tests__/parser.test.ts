/**
 * Tests for the parser module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSidecarContent, parseSidecarContentLenient, parseSidecar, parseSidecarLenient, readDocumentLines } from "../lib/parser.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// parseSidecarContent — strict parsing
// ---------------------------------------------------------------------------

describe("parseSidecarContent", () => {
  it("parses valid YAML sidecar", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
comments:
  - id: c-1
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    const doc = parseSidecarContent(yaml);
    expect(doc.mrsf_version).toBe("1.0");
    expect(doc.document).toBe("test.md");
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0].id).toBe("c-1");
  });

  it("parses valid JSON sidecar", () => {
    const json = JSON.stringify({
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-1",
          author: "Bob",
          timestamp: "2025-01-01T00:00:00Z",
          text: "Fix",
          resolved: false,
        },
      ],
    });
    const doc = parseSidecarContent(json);
    expect(doc.mrsf_version).toBe("1.0");
    expect(doc.comments).toHaveLength(1);
  });

  it("preserves unquoted ISO timestamps as strings (not Date objects)", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
comments:
  - id: c-1
    author: Alice
    timestamp: 2025-06-15T14:30:00Z
    text: Fix this
    resolved: false
`;
    const doc = parseSidecarContent(yaml);
    expect(typeof doc.comments[0].timestamp).toBe("string");
    expect(doc.comments[0].timestamp).toBe("2025-06-15T14:30:00Z");
  });

  it("preserves unquoted timestamps with milliseconds as strings", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
comments:
  - id: c-1
    author: Alice
    timestamp: 2026-03-05T21:33:56.197Z
    text: Fix this
    resolved: false
`;
    const doc = parseSidecarContent(yaml);
    expect(typeof doc.comments[0].timestamp).toBe("string");
    expect(doc.comments[0].timestamp).toBe("2026-03-05T21:33:56.197Z");
  });

  it("detects JSON by filename hint (.review.json)", () => {
    const json = JSON.stringify({
      mrsf_version: "1.0",
      document: "test.md",
      comments: [],
    });
    const doc = parseSidecarContent(json, "test.md.review.json");
    expect(doc.mrsf_version).toBe("1.0");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSidecarContent("{invalid}", "test.review.json")).toThrow(
      "Failed to parse JSON",
    );
  });

  it("throws on invalid YAML", () => {
    expect(() => parseSidecarContent(":\n  :\n    :\n  :\ninvalid: [")).toThrow(
      "Failed to parse YAML",
    );
  });

  it("throws on non-object result (array)", () => {
    expect(() => parseSidecarContent("[1, 2, 3]")).toThrow(
      "MRSF sidecar must be a YAML/JSON object",
    );
  });

  it("throws on non-object result (scalar)", () => {
    expect(() => parseSidecarContent("42")).toThrow(
      "MRSF sidecar must be a YAML/JSON object",
    );
  });
});

// ---------------------------------------------------------------------------
// parseSidecarContentLenient — lenient parsing
// ---------------------------------------------------------------------------

describe("parseSidecarContentLenient", () => {
  it("returns parsed doc on valid YAML", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
comments:
  - id: c-1
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    const result = parseSidecarContentLenient(yaml);
    expect(result.doc).not.toBeNull();
    expect(result.doc!.comments).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it("returns error for empty content", () => {
    const result = parseSidecarContentLenient("");
    expect(result.doc).toBeNull();
    expect(result.error).toBe("File is empty");
  });

  it("returns error for whitespace-only content", () => {
    const result = parseSidecarContentLenient("   \n  \n  ");
    expect(result.doc).toBeNull();
    expect(result.error).toBe("File is empty");
  });

  it("returns error for non-object YAML", () => {
    const result = parseSidecarContentLenient("[1, 2, 3]");
    expect(result.doc).toBeNull();
    expect(result.error).toContain("MRSF sidecar must be a YAML/JSON object");
  });

  it("returns error for JSON parse failure", () => {
    const result = parseSidecarContentLenient("{broken", "x.review.json");
    expect(result.doc).toBeNull();
    expect(result.error).toContain("Failed to parse JSON");
  });

  it("handles missing comments field", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
`;
    const result = parseSidecarContentLenient(yaml);
    expect(result.doc).not.toBeNull();
    expect(result.error).toContain("comments field is not an array");
  });

  it("skips malformed comments and reports indices", () => {
    const yaml = `
mrsf_version: "1.0"
document: test.md
comments:
  - id: c-1
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: Good comment
    resolved: false
  - not_a_comment: true
  - id: c-2
    author: Bob
    timestamp: "2025-01-01T00:00:00Z"
    text: Another good one
    resolved: false
`;
    const result = parseSidecarContentLenient(yaml);
    expect(result.doc).not.toBeNull();
    expect(result.doc!.comments).toHaveLength(2);
    expect(result.error).toContain("1 comment(s)");
    expect(result.error).toContain("indices [1]");
    expect(result.partialComments).toHaveLength(2);
  });

  it("returns parsed doc with defaults when top-level fields missing", () => {
    const yaml = `
comments:
  - id: c-1
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: test
    resolved: false
`;
    const result = parseSidecarContentLenient(yaml);
    expect(result.doc).not.toBeNull();
    expect(result.doc!.mrsf_version).toBe("1.0");
    expect(result.doc!.document).toBe("unknown");
  });

  it("salvages comments from corrupted YAML", () => {
    // Corrupted YAML that can't be parsed as a whole
    const corrupted = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-1
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: Fix this
    resolved: false
  - id: c-2
    author: Bob
    timestamp: bad yaml [[[
    text: Broken
  - id: c-3
    author: Carol
    timestamp: "2025-01-01T00:00:00Z"
    text: Also good
    resolved: true
this is : [totally broken yaml
`;
    const result = parseSidecarContentLenient(corrupted);
    // May salvage at least some comments
    expect(result.error).toBeTruthy();
  });

  it("salvages comments with version and document from raw yaml", () => {
    const corrupted = `mrsf_version: "1.0"
document: my-doc.md
comments:
  - id: c-1
    author: Alice
    timestamp: "2025-01-01T00:00:00Z"
    text: Fix this
    resolved: false
this is totally broken [[[`;
    const result = parseSidecarContentLenient(corrupted);
    expect(result.error).toBeTruthy();
    if (result.doc) {
      expect(result.doc.mrsf_version).toBe("1.0");
      expect(result.doc.document).toBe("my-doc.md");
    }
  });
});

// ---------------------------------------------------------------------------
// parseSidecar — from disk
// ---------------------------------------------------------------------------

describe("parseSidecar", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "parser-disk-"));
  });

  it("reads and parses a YAML sidecar from disk", async () => {
    const fp = path.join(tmpDir, "test.md.review.yaml");
    await writeFile(
      fp,
      `mrsf_version: "1.0"\ndocument: test.md\ncomments:\n  - id: c-1\n    author: A\n    timestamp: "2025-01-01"\n    text: hello\n    resolved: false\n`,
    );
    const doc = await parseSidecar(fp);
    expect(doc.mrsf_version).toBe("1.0");
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0].id).toBe("c-1");
  });

  it("reads and parses a JSON sidecar from disk", async () => {
    const fp = path.join(tmpDir, "test.md.review.json");
    await writeFile(
      fp,
      JSON.stringify({
        mrsf_version: "1.0",
        document: "test.md",
        comments: [
          { id: "c-1", author: "B", timestamp: "2025-01-01", text: "x", resolved: false },
        ],
      }),
    );
    const doc = await parseSidecar(fp);
    expect(doc.comments).toHaveLength(1);
  });

  it("throws on nonexistent file", async () => {
    await expect(parseSidecar(path.join(tmpDir, "nope.review.yaml"))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseSidecarLenient — from disk
// ---------------------------------------------------------------------------

describe("parseSidecarLenient", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "parser-lenient-"));
  });

  it("reads and parses valid sidecar from disk", async () => {
    const fp = path.join(tmpDir, "test.md.review.yaml");
    await writeFile(
      fp,
      `mrsf_version: "1.0"\ndocument: test.md\ncomments:\n  - id: c-1\n    author: A\n    timestamp: "2025-01-01"\n    text: ok\n    resolved: false\n`,
    );
    const result = await parseSidecarLenient(fp);
    expect(result.doc).not.toBeNull();
    expect(result.doc!.comments).toHaveLength(1);
  });

  it("returns error for nonexistent file", async () => {
    const result = await parseSidecarLenient(path.join(tmpDir, "nope.review.yaml"));
    expect(result.doc).toBeNull();
    expect(result.error).toContain("Cannot read file");
  });
});

// ---------------------------------------------------------------------------
// readDocumentLines
// ---------------------------------------------------------------------------

describe("readDocumentLines", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "parser-lines-"));
  });

  it("returns 1-based line array", async () => {
    const fp = path.join(tmpDir, "doc.md");
    await writeFile(fp, "first\nsecond\nthird");
    const lines = await readDocumentLines(fp);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("first");
    expect(lines[2]).toBe("second");
    expect(lines[3]).toBe("third");
    expect(lines).toHaveLength(4);
  });

  it("handles single-line file", async () => {
    const fp = path.join(tmpDir, "one.md");
    await writeFile(fp, "only line");
    const lines = await readDocumentLines(fp);
    expect(lines[1]).toBe("only line");
    expect(lines).toHaveLength(2);
  });

  it("handles empty file", async () => {
    const fp = path.join(tmpDir, "empty.md");
    await writeFile(fp, "");
    const lines = await readDocumentLines(fp);
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("");
    expect(lines).toHaveLength(2);
  });
});


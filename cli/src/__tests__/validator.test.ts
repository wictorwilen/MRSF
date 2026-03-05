/**
 * Tests for the validator module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validate, validateFile } from "../lib/validator.js";
import { computeHash } from "../lib/writer.js";
import type { MrsfDocument } from "../lib/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeDoc(overrides: Partial<MrsfDocument> = {}): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "test.md",
    comments: [],
    ...overrides,
  };
}

describe("validate", () => {
  it("passes valid empty document", async () => {
    const result = await validate(makeDoc());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes valid document with comments", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-001",
            author: "Alice",
            timestamp: "2025-01-01T00:00:00Z",
            text: "Looks good.",
            resolved: false,
          },
        ],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("detects duplicate IDs", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "dup",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
          },
          {
            id: "dup",
            author: "B",
            timestamp: "2025-01-01T00:00:00Z",
            text: "b",
            resolved: false,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  it("detects end_line < line", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            line: 10,
            end_line: 5,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("end_line"))).toBe(true);
  });

  it("warns on missing selected_text", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            line: 5,
          },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.message.includes("selected_text"))).toBe(true);
  });

  it("detects unresolved reply_to", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "reply",
            resolved: false,
            reply_to: "nonexistent",
          },
        ],
      }),
    );
    // reply_to is a warning in cross-field validation
    expect(result.warnings.some((w) => w.message.includes("reply_to"))).toBe(true);
  });

  it("detects selected_text exceeding 4096 characters", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            selected_text: "x".repeat(4097),
          },
        ],
      }),
    );
    expect(result.errors.some((e) => e.message.includes("4096"))).toBe(true);
  });

  it("detects end_column < start_column on same line", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            line: 5,
            end_line: 5,
            start_column: 10,
            end_column: 3,
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("end_column"))).toBe(true);
  });

  it("warns on text exceeding 16384 characters", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "x".repeat(16385),
            resolved: false,
          },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.message.includes("16384"))).toBe(true);
  });

  it("warns on selected_text_hash mismatch", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            selected_text: "hello world",
            selected_text_hash: "wrong_hash_value_xxxx",
          },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.message.includes("mismatch"))).toBe(true);
  });

  it("passes when selected_text_hash is correct", async () => {
    const selectedText = "hello world";
    const hash = computeHash(selectedText);
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            selected_text: selectedText,
            selected_text_hash: hash,
          },
        ],
      }),
    );
    expect(result.warnings.filter((w) => w.message.includes("mismatch"))).toHaveLength(0);
  });

  it("strict mode treats warnings as invalidity", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            line: 5,
            // No selected_text → warning
          },
        ],
      }),
      { strict: true },
    );
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("non-strict mode allows warnings as valid", async () => {
    const result = await validate(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "a",
            resolved: false,
            line: 5,
          },
        ],
      }),
      { strict: false },
    );
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validateFile
// ---------------------------------------------------------------------------

describe("validateFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-validate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates a valid sidecar file", async () => {
    const filePath = path.join(tmpDir, "test.md.review.yaml");
    fs.writeFileSync(
      filePath,
      `mrsf_version: "1.0"\ndocument: test.md\ncomments:\n  - id: c-1\n    author: A\n    timestamp: "2025-01-01T00:00:00Z"\n    text: Good\n    resolved: false\n`,
    );
    const result = await validateFile(filePath);
    expect(result.valid).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await validateFile(path.join(tmpDir, "nonexistent.review.yaml"));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Failed to parse");
  });

  it("returns error for invalid YAML", async () => {
    const filePath = path.join(tmpDir, "bad.review.yaml");
    fs.writeFileSync(filePath, "{{{{invalid yaml");
    const result = await validateFile(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Failed to parse");
  });
});

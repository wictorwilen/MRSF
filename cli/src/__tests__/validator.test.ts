/**
 * Tests for the validator module.
 */

import { describe, it, expect } from "vitest";
import { validate } from "../lib/validator.js";
import type { MrsfDocument } from "../lib/types.js";

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
});

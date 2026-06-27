import { describe, expect, it } from "vitest";
import { validateDocument } from "../lib/validate-core.js";
import type { MrsfDocument } from "../lib/types.js";

function makeDoc(overrides: Partial<MrsfDocument> = {}): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "test.md",
    comments: [],
    ...overrides,
  };
}

describe("validateDocument", () => {
  it("validates a valid document", () => {
    const result = validateDocument(makeDoc());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports schema violations with a stable code", () => {
    const result = validateDocument({ document: "test.md", comments: [] } as unknown as MrsfDocument);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "schema-violation")).toBe(true);
  });

  it("reports cross-field errors with a stable code", () => {
    const result = validateDocument(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "t",
            resolved: false,
            line: 10,
            end_line: 5,
          },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("end-line-before-line");
  });

  it("skips hash mismatch checks when no browser-safe hash function is injected", () => {
    const result = validateDocument(
      makeDoc({
        comments: [
          {
            id: "c-1",
            author: "A",
            timestamp: "2025-01-01T00:00:00Z",
            text: "t",
            resolved: false,
            selected_text: "hello",
            selected_text_hash: "wrong",
          },
        ],
      }),
    );

    expect(result.warnings.map((w) => w.code)).not.toContain("hash-mismatch");
  });
});

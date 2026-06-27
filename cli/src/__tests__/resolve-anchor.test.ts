import { describe, expect, it } from "vitest";
import { resolveAnchor } from "../lib/reanchor-core.js";
import type { Comment } from "../lib/types.js";

function makeComment(overrides: Partial<Comment>): Comment {
  return {
    id: "c-1",
    author: "A",
    timestamp: "2025-01-01T00:00:00Z",
    text: "Review",
    resolved: false,
    ...overrides,
  };
}

describe("resolveAnchor", () => {
  it("resolves an exact single-line match to offsets", () => {
    const documentText = "Alpha\nBeta target\nGamma";
    const result = resolveAnchor(makeComment({ line: 2, selected_text: "target" }), documentText);

    expect(result.status).toBe("anchored");
    expect(result.line).toBe(2);
    expect(result.from).toBe(11);
    expect(result.to).toBe(17);
    expect(documentText.slice(result.from, result.to)).toBe("target");
  });

  it("resolves a multi-line selection", () => {
    const documentText = "One\nstart here\nend here\nDone";
    const selected = "start here\nend here";
    const result = resolveAnchor(makeComment({ line: 2, end_line: 3, selected_text: selected }), documentText);

    expect(result.status).toBe("anchored");
    expect(result.line).toBe(2);
    expect(result.endLine).toBe(3);
    expect(documentText.slice(result.from, result.to)).toBe(selected);
  });

  it("resolves a shifted selected_text line", () => {
    const documentText = "Inserted\nOriginal\nTail";
    const result = resolveAnchor(makeComment({ line: 1, selected_text: "Original" }), documentText);

    expect(result.status).toBe("anchored");
    expect(result.line).toBe(2);
    expect(documentText.slice(result.from, result.to)).toBe("Original");
  });

  it("omits offsets for orphaned comments", () => {
    const result = resolveAnchor(makeComment({ line: 99, selected_text: "Missing" }), "Only text", { threshold: 0.99 });

    expect(result.status).toBe("orphaned");
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
  });

  it("omits offsets for document-level comments", () => {
    const result = resolveAnchor(makeComment({}), "Anything");

    expect(result.status).toBe("anchored");
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
  });

  it("resolves comments with explicit start and end columns", () => {
    const documentText = "0123456789\nabcdefghi";
    const result = resolveAnchor(
      makeComment({ line: 2, end_line: 2, start_column: 2, end_column: 5, selected_text: "cde" }),
      documentText,
    );

    expect(result.startColumn).toBe(2);
    expect(result.endColumn).toBe(5);
    expect(documentText.slice(result.from, result.to)).toBe("cde");
  });
});

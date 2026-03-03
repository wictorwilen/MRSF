/**
 * Tests for the re-anchor engine.
 */

import { describe, it, expect } from "vitest";
import { reanchorComment } from "../lib/reanchor.js";
import type { Comment, DiffHunk } from "../lib/types.js";

// Helper: make a 1-based line array (index 0 is unused).
function lines1(...content: string[]): string[] {
  return ["", ...content];
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "test-001",
    author: "tester",
    timestamp: "2025-01-01T00:00:00Z",
    text: "Fix this",
    resolved: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Step 0: Diff-based shift
// ---------------------------------------------------------------------------

describe("reanchorComment — diff-based", () => {
  const lines = lines1(
    "line 1",
    "inserted",
    "line 2",
    "The selected text here",
    "line 4",
  );

  it("shifts line correctly with diff hunks", () => {
    const comment = makeComment({
      line: 3,
      selected_text: "The selected text here",
    });

    // One line inserted before line 3 (at old line 2)
    const hunks: DiffHunk[] = [
      { oldStart: 2, oldCount: 0, newStart: 2, newCount: 1, lines: ["+inserted"] },
    ];

    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    expect(result.status).toBe("shifted");
    expect(result.newLine).toBe(4);
    expect(result.score).toBe(1.0);
  });

  it("marks as anchored when no shift needed", () => {
    const comment = makeComment({
      line: 4,
      selected_text: "The selected text here",
    });

    const result = reanchorComment(comment, lines, { diffHunks: [] });
    // No hunks, so falls through to exact match
    expect(result.status).toBe("anchored");
  });
});

// ---------------------------------------------------------------------------
// Step 1: Exact match
// ---------------------------------------------------------------------------

describe("reanchorComment — exact match", () => {
  const lines = lines1(
    "# Title",
    "",
    "Unique text to find.",
    "Other content.",
  );

  it("finds unique exact match", () => {
    const comment = makeComment({
      selected_text: "Unique text to find.",
      line: 10, // stale line
    });

    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(3);
    expect(result.score).toBe(1.0);
  });

  it("disambiguates multiple exact matches by proximity", () => {
    const dupeLines = lines1("the", "some stuff", "the", "other stuff", "the");
    // "the" appears at lines 1, 3, 5
    const comment = makeComment({
      selected_text: "the",
      line: 5, // closest to line 5
    });

    const result = reanchorComment(comment, dupeLines);
    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(5); // nearest to hint line 5
  });
});

// ---------------------------------------------------------------------------
// Step 4: Orphan
// ---------------------------------------------------------------------------

describe("reanchorComment — orphan", () => {
  const lines = lines1("# Title", "Some text.", "More text.");

  it("marks as orphaned when nothing matches", () => {
    const comment = makeComment({
      selected_text: "This text does not exist anywhere in the document at all.",
      line: 999,
    });

    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("orphaned");
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Document-level
// ---------------------------------------------------------------------------

describe("reanchorComment — document-level", () => {
  it("returns anchored for comments without anchor", () => {
    const comment = makeComment({}); // no line, no selected_text
    const result = reanchorComment(comment, lines1("anything"));
    expect(result.status).toBe("anchored");
    expect(result.reason).toContain("Document-level");
  });
});

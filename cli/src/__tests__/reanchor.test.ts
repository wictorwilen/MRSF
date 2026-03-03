/**
 * Tests for the re-anchor engine.
 */

import { describe, it, expect } from "vitest";
import { reanchorComment, applyReanchorResults } from "../lib/reanchor.js";
import type { Comment, DiffHunk, MrsfDocument, ReanchorResult } from "../lib/types.js";

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

// ---------------------------------------------------------------------------
// applyReanchorResults — --force flag
// ---------------------------------------------------------------------------

function makeDoc(comments: Comment[]): MrsfDocument {
  return {
    file: "test.md",
    comments,
  };
}

describe("applyReanchorResults — force", () => {
  it("updates commit to HEAD and clears audit fields for high-confidence results", () => {
    const comment = makeComment({
      id: "c1",
      line: 5,
      commit: "old-commit-abc",
      selected_text: "Some text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c1",
        status: "shifted",
        score: 1.0,
        newLine: 7,
        reason: "Shifted via diff",
      },
    ];

    const changed = applyReanchorResults(doc, results, {
      force: true,
      headCommit: "new-head-def",
    });

    expect(changed).toBe(1);
    expect(comment.line).toBe(7);
    expect(comment.commit).toBe("new-head-def");
    expect(comment.x_reanchor_status).toBeUndefined();
    expect(comment.x_reanchor_score).toBeUndefined();
  });

  it("does not force-anchor low-confidence results (fuzzy/ambiguous)", () => {
    const comment = makeComment({
      id: "c2",
      line: 3,
      commit: "old-commit",
      selected_text: "Some text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c2",
        status: "fuzzy",
        score: 0.7,
        newLine: 4,
        reason: "Fuzzy match",
      },
    ];

    const changed = applyReanchorResults(doc, results, {
      force: true,
      headCommit: "new-head",
    });

    expect(changed).toBe(1);
    expect(comment.line).toBe(4);
    // commit should NOT be updated for fuzzy
    expect(comment.commit).toBe("old-commit");
    // audit fields should be set (not cleared)
    expect(comment.x_reanchor_status).toBe("fuzzy");
    expect(comment.x_reanchor_score).toBe(0.7);
  });

  it("does not force-anchor orphaned results", () => {
    const comment = makeComment({
      id: "c3",
      line: 10,
      commit: "old-commit",
      selected_text: "Gone text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c3",
        status: "orphaned",
        score: 0,
        reason: "No match found",
      },
    ];

    const changed = applyReanchorResults(doc, results, {
      force: true,
      headCommit: "new-head",
    });

    expect(changed).toBe(0);
    expect(comment.commit).toBe("old-commit");
    expect(comment.x_reanchor_status).toBe("orphaned");
  });

  it("requires headCommit — does nothing without it even when force=true", () => {
    const comment = makeComment({
      id: "c4",
      line: 5,
      commit: "old-commit",
      selected_text: "Text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c4",
        status: "anchored",
        score: 1.0,
        reason: "Exact match",
      },
    ];

    const changed = applyReanchorResults(doc, results, {
      force: true,
      // headCommit intentionally omitted
    });

    // No position change, status is anchored → isChanged=false, so not counted
    expect(changed).toBe(0);
    expect(comment.commit).toBe("old-commit");
  });

  it("clears anchored_text when it matches selected_text during force", () => {
    const comment = makeComment({
      id: "c5",
      line: 3,
      commit: "old-commit",
      selected_text: "Hello world",
      anchored_text: "Hello world",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c5",
        status: "anchored",
        score: 1.0,
        reason: "Exact match",
      },
    ];

    const changed = applyReanchorResults(doc, results, {
      force: true,
      headCommit: "head-abc",
    });

    expect(changed).toBe(1);
    expect(comment.commit).toBe("head-abc");
    expect(comment.anchored_text).toBeUndefined();
    expect(comment.x_reanchor_status).toBeUndefined();
  });

  it("does not modify when force=false (default behavior)", () => {
    const comment = makeComment({
      id: "c6",
      line: 5,
      commit: "old-commit",
      selected_text: "Text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c6",
        status: "shifted",
        score: 1.0,
        newLine: 7,
        reason: "Shifted",
      },
    ];

    const changed = applyReanchorResults(doc, results, { force: false });

    expect(changed).toBe(1);
    expect(comment.line).toBe(7);
    // commit should NOT be updated without force
    expect(comment.commit).toBe("old-commit");
    // audit fields should be set
    expect(comment.x_reanchor_status).toBe("shifted");
  });
});

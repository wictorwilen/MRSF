/**
 * Tests for the re-anchor engine.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  reanchorComment,
  applyReanchorResults,
  reanchorDocument,
  reanchorDocumentText,
  reanchorFile,
} from "../lib/reanchor.js";
import { parseSidecar } from "../lib/parser.js";
import { writeSidecar } from "../lib/writer.js";
import type { Comment, DiffHunk, MrsfDocument, ReanchorResult } from "../lib/types.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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

  it("anchors a multiline selection that starts and ends on blank lines", () => {
    const lines = lines1(
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "",
      "text text",
      "",
      "line 10",
    );
    const comment = makeComment({
      line: 7,
      end_line: 9,
      selected_text: "\ntext text\n",
    });

    const result = reanchorComment(comment, lines);

    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(7);
    expect(result.newEndLine).toBe(9);
    expect(result.score).toBe(1);
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
// Step 0: Diff-based shift — additional tests
// ---------------------------------------------------------------------------

describe("reanchorComment — diff shift (line-only, no selected_text)", () => {
  it("shifts line-only comment with diff hunks", () => {
    const lines = lines1("line 1", "inserted", "line 2", "line 3");
    const comment = makeComment({ line: 2 }); // no selected_text
    const hunks: DiffHunk[] = [
      { oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] },
    ];
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    expect(result.status).toBe("shifted");
    expect(result.newLine).toBe(3);
    expect(result.score).toBe(1.0);
    expect(result.reason).toContain("Line-only");
  });

  it("marks line-only comment as anchored when diff shift is 0", () => {
    const lines = lines1("line 1", "line 2");
    const comment = makeComment({ line: 2 }); // no selected_text
    const hunks: DiffHunk[] = [
      { oldStart: 5, oldCount: 0, newStart: 5, newCount: 1, lines: ["+inserted after line 2"] },
    ];
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    expect(result.status).toBe("anchored");
    expect(result.score).toBe(1.0);
    expect(result.reason).toContain("Line-only comment unchanged");
  });

  it("preserves end_line span when shifting line-only comment", () => {
    const lines = lines1("a", "inserted", "b", "c", "d");
    const comment = makeComment({ line: 2, end_line: 4 }); // no selected_text
    const hunks: DiffHunk[] = [
      { oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] },
    ];
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    expect(result.status).toBe("shifted");
    expect(result.newLine).toBe(3);
    expect(result.newEndLine).toBe(5);
  });

  it("falls through when diff marks line as modified and text doesn't match", () => {
    const lines = lines1("line 1", "modified text", "line 3");
    const comment = makeComment({
      line: 2,
      selected_text: "original text that was here before",
    });
    const hunks: DiffHunk[] = [
      { oldStart: 2, oldCount: 1, newStart: 2, newCount: 1, lines: ["-old", "+modified text"] },
    ];
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    // Should fall through to other steps since line was modified
    expect(result.status).not.toBe("shifted");
  });

  it("falls through when diff shifts but text at shifted position does not match selected_text", () => {
    // Shift line 3 down by 1 (insert at line 1), but text at shifted line 4 differs
    const lines = lines1("inserted", "line 1", "line 2", "different text now", "line 4");
    const comment = makeComment({
      line: 3,
      selected_text: "original matching text",
    });
    const hunks: DiffHunk[] = [
      { oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] },
    ];
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    // Diff shifts to line 4 ("different text now") which doesn't match "original matching text"
    // Falls through to exact/fuzzy search
    expect(["fuzzy", "anchored", "orphaned", "ambiguous"]).toContain(result.status);
  });

  it("handles multi-line comment with columns in diff-shift (extractText multi-line)", () => {
    // Lines 1-based: ["", "Hello World", "middle line", "end text here", "after"]
    const lines = lines1("Hello World", "middle line", "end text here", "after");
    const comment = makeComment({
      line: 1,
      end_line: 3,
      start_column: 6,
      end_column: 8,
      selected_text: "World\nmiddle line\nend text",
    });
    const hunks: DiffHunk[] = []; // no diff
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    // With empty hunks, no shift happens; falls to exact/fuzzy
    expect(result).toBeDefined();
  });

  it("shifts text with diff and matches at new position (single-line with columns)", () => {
    // Insert line at top → shift original line 1 to line 2
    const lines = lines1("inserted", "Hello World");
    const comment = makeComment({
      line: 1,
      selected_text: "Hello World",
    });
    const hunks: DiffHunk[] = [
      { oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] },
    ];
    const result = reanchorComment(comment, lines, { diffHunks: hunks });
    expect(result.status).toBe("shifted");
    expect(result.newLine).toBe(2);
  });

  it("matches a shifted single-line column slice via diff", () => {
    const lines = lines1("inserted", "Hello World");
    const comment = makeComment({
      line: 1,
      start_column: 6,
      end_column: 11,
      selected_text: "World",
    });
    const hunks: DiffHunk[] = [
      { oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] },
    ];

    const result = reanchorComment(comment, lines, { diffHunks: hunks });

    expect(result.status).toBe("shifted");
    expect(result.newLine).toBe(2);
    expect(result.reason).toContain("Diff shifted by +1 line");
  });

  it("matches a shifted multi-line selection with start/end columns via diff", () => {
    const lines = lines1(
      "inserted",
      "Hello World",
      "middle line",
      "end text here",
    );
    const comment = makeComment({
      line: 1,
      end_line: 3,
      start_column: 6,
      end_column: 3,
      selected_text: "World\nmiddle line\nend",
    });
    const hunks: DiffHunk[] = [
      { oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: ["+inserted"] },
    ];

    const result = reanchorComment(comment, lines, { diffHunks: hunks });

    expect(result.status).toBe("shifted");
    expect(result.newLine).toBe(2);
    expect(result.newEndLine).toBe(4);
    expect(result.reason).toContain("Diff shifted by +1 line");
  });
});

// ---------------------------------------------------------------------------
// Step 1.5: Normalized / high-threshold fuzzy
// ---------------------------------------------------------------------------

describe("reanchorComment — normalized + high-threshold fuzzy", () => {
  it("finds single normalized whitespace match (Step 1.5 norm branch)", () => {
    // Use a single-line document so normalizedMatch finds exactly 1 candidate
    const lines = lines1("The  text   with  spaces");
    const comment = makeComment({
      selected_text: "The text with spaces",
      line: 10,
    });
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("fuzzy");
    expect(result.newLine).toBe(1);
    expect(result.anchoredText).toBeTruthy();
    expect(result.reason).toContain("Normalized whitespace");
  });

  it("finds high-threshold fuzzy match with multiple candidates (picks closest to line)", () => {
    // normalizedMatch returns multiple candidates (multiline doc with whitespace match)
    // then high-threshold fuzzy picks the best one
    const lines = lines1("# Title", "The  text   with  spaces", "End");
    const comment = makeComment({
      selected_text: "The text with spaces",
      line: 2,
    });
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("fuzzy");
    expect(result.newLine).toBe(2);
    expect(result.anchoredText).toBeTruthy();
    // Goes through high-threshold fuzzy since normalized returns multiple
    expect(result.reason).toContain("fuzzy match");
  });

  it("picks closest high-threshold fuzzy match when multiple exist", () => {
    const lines = lines1(
      "The quick brown fox jumped over the lazy dog here",
      "other stuff",
      "other stuff more",
      "The quick brown fox jumped over the lazy dog here",
    );
    const comment = makeComment({
      selected_text: "The quick brown fox jumped over the lazy dog",
      line: 4,
    });
    const result = reanchorComment(comment, lines);
    expect(["fuzzy", "anchored"]).toContain(result.status);
    expect(result.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Step 2: Line/column fallback
// ---------------------------------------------------------------------------

describe("reanchorComment — line/column fallback", () => {
  it("falls back to original line when text is similar (fuzzy)", () => {
    const lines = lines1("# Title", "Almost matching textt here", "End");
    const comment = makeComment({
      selected_text: "Almost matching text here",
      line: 2,
    });
    const result = reanchorComment(comment, lines);
    // Should find fuzzy match at line 2
    expect(result.status).toBe("fuzzy");
    expect(result.newLine).toBe(2);
  });

  it("uses single-line fuzzy matching before plain line fallback", () => {
    const lines = lines1(
      "header",
      "The rough revised sentence that should still resemble the candidate after edits.",
      "footer",
    );
    const comment = makeComment({
      selected_text: "The precise original sentence that should only weakly resemble the candidate after edits.",
      line: 2,
    });

    const result = reanchorComment(comment, lines, { commitIsStale: true });

    expect(result.status).toBe("fuzzy");
    expect(result.newLine).toBe(2);
    expect(result.reason).toContain("Line-fallback with fuzzy text match");
  });

  it("returns ambiguous for stale commit with text mismatch at line", () => {
    // selected_text so different from everything that no fuzzy matches anywhere
    // line valid but commitIsStale → ambiguous line fallback
    const lines = lines1("AAAA", "BBBB", "CCCC");
    const comment = makeComment({
      selected_text: "ZZZZZZZZZZZ totally unrelated very long text",
      line: 2,
    });
    const result = reanchorComment(comment, lines, { commitIsStale: true });
    expect(result.status).toBe("ambiguous");
    expect(result.score).toBe(0.5);
    expect(result.reason).toContain("stale");
  });

  it("returns anchored line fallback for non-stale commit with text mismatch", () => {
    // selected_text so different from everything that no fuzzy matches
    const lines = lines1("AAAA", "BBBB", "CCCC");
    const comment = makeComment({
      selected_text: "ZZZZZZZZZZZ totally unrelated very long text",
      line: 2,
    });
    const result = reanchorComment(comment, lines, { commitIsStale: false });
    expect(result.status).toBe("anchored");
    expect(result.score).toBe(0.8);
    expect(result.reason).toContain("Line/column fallback");
  });

  it("returns anchored for line-only (no selected_text) at valid line", () => {
    const lines = lines1("line 1", "line 2", "line 3");
    const comment = makeComment({ line: 2 }); // no selected_text
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
    expect(result.score).toBe(1.0);
    expect(result.reason).toContain("Line-only");
  });

  it("returns line/column fallback for non-stale commit (no fuzzy at line)", () => {
    const lines = lines1("AAA", "BBB", "CCC");
    const comment = makeComment({
      selected_text: "ZZZZZZZZZZZZZZZZZ completely unrelated very long text",
      line: 2,
    });
    // Not stale → "anchored" line fallback
    const result = reanchorComment(comment, lines, { commitIsStale: false });
    expect(result.status).toBe("anchored");
    expect(result.score).toBe(0.8);
    expect(result.reason).toContain("Line/column fallback");
  });

  it("returns ambiguous line fallback when commit is stale and text at line does not match", () => {
    const lines = lines1("AAA", "BBB", "CCC");
    const comment = makeComment({
      selected_text: "ZZZZZZZZZZZZZZ some completely different very long text",
      line: 2,
    });
    // Stale → "ambiguous" line fallback
    const result = reanchorComment(comment, lines, { commitIsStale: true });
    expect(result.status).toBe("ambiguous");
    expect(result.score).toBe(0.5);
    expect(result.reason).toContain("stale");
  });

  it("falls to pure line fallback when text at line differs (Step 2)", () => {
    const lines = lines1(
      "unrelated header line",
      "completely different content",
      "another unrelated line",
    );
    const comment = makeComment({
      selected_text: "a very different string with no meaningful overlap at all",
      line: 2,
    });
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("anchored");
    expect(result.score).toBe(0.8);
    expect(result.newLine).toBe(2);
    expect(result.reason).toContain("Line/column fallback");
  });

  it("does not orphan a range when the anchored selection begins on a blank line", () => {
    const lines = lines1(
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "",
      "text text",
      "",
    );
    const comment = makeComment({
      line: 7,
      end_line: 9,
      selected_text: "\ntext text\n",
    });

    const result = reanchorComment(comment, lines, { commitIsStale: true });

    expect(result.status).not.toBe("orphaned");
  });
});

// ---------------------------------------------------------------------------
// Step 3: Lower-threshold fuzzy
// ---------------------------------------------------------------------------

describe("reanchorComment — low-threshold fuzzy", () => {
  it("finds single low-threshold fuzzy match (Step 3)", () => {
    const needle =
      "The precise original sentence that should only weakly resemble the candidate after edits. " +
      "The precise original sentence that should only weakly resemble the candidate after edits. " +
      "The precise original sentence that should only weakly resemble the candidate after edits.";
    const matchLine =
      "The rough revised sentence that should still resemble the candidate after edits. " +
      "The rough revised sentence that should still resemble the candidate after edits. " +
      "The rough revised sentence that should still resemble the candidate after edits.";
    const lines = lines1(matchLine);
    const comment = makeComment({
      selected_text: needle,
      line: 999, // out of bounds → skip Step 2
    });
    const result = reanchorComment(comment, lines);
    expect(result.status).toBe("fuzzy");
    expect(result.newLine).toBe(1);
    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.score).toBeLessThan(0.8);
    expect(result.reason).toContain("Low-threshold fuzzy match");
  });

  it("reports ambiguous when multiple low-confidence matches exist (Step 3)", () => {
    const needle =
      "The precise original sentence that should only weakly resemble the candidate after edits. " +
      "The precise original sentence that should only weakly resemble the candidate after edits. " +
      "The precise original sentence that should only weakly resemble the candidate after edits.";
    const matchLine =
      "The rough revised sentence that should still resemble the candidate after edits. " +
      "The rough revised sentence that should still resemble the candidate after edits. " +
      "The rough revised sentence that should still resemble the candidate after edits.";
    const lines = lines1(
      matchLine,
      "something completely different goes here to separate",
      matchLine,
    );
    const comment = makeComment({
      selected_text: needle,
      line: 999, // out of bounds
    });
    const result = reanchorComment(comment, lines, { threshold: 0.5 });
    expect(result.status).toBe("ambiguous");
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.score).toBeLessThan(0.8);
    expect(result.reason).toContain("Ambiguous");
  });
});

// ---------------------------------------------------------------------------
// applyReanchorResults — updateText option
// ---------------------------------------------------------------------------

describe("applyReanchorResults — updateText", () => {
  it("replaces selected_text when updateText is true", () => {
    const comment = makeComment({
      id: "c-ut",
      line: 3,
      selected_text: "old text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c-ut",
        status: "fuzzy",
        score: 0.85,
        newLine: 3,
        anchoredText: "new text",
        reason: "Fuzzy match",
      },
    ];

    const changed = applyReanchorResults(doc, results, { updateText: true });
    expect(changed).toBe(1);
    expect(comment.selected_text).toBe("new text");
    expect(comment.anchored_text).toBeUndefined();
  });

  it("sets anchored_text when updateText is false (default)", () => {
    const comment = makeComment({
      id: "c-at",
      line: 3,
      selected_text: "old text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c-at",
        status: "fuzzy",
        score: 0.85,
        newLine: 3,
        anchoredText: "new text",
        reason: "Fuzzy match",
      },
    ];

    const changed = applyReanchorResults(doc, results);
    expect(changed).toBe(1);
    expect(comment.selected_text).toBe("old text");
    expect(comment.anchored_text).toBe("new text");
  });

  it("clears stale anchored_text when text matches", () => {
    const comment = makeComment({
      id: "c-clear",
      line: 3,
      selected_text: "same text",
      anchored_text: "stale anchored text",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c-clear",
        status: "anchored",
        score: 1.0,
        newLine: 3,
        anchoredText: "same text",
        reason: "Exact match",
      },
    ];

    const changed = applyReanchorResults(doc, results);
    expect(changed).toBe(1);
    expect(comment.anchored_text).toBeUndefined();
  });

  it("updates start/end columns", () => {
    const comment = makeComment({
      id: "c-col",
      line: 3,
      start_column: 0,
      end_column: 10,
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c-col",
        status: "anchored",
        score: 1.0,
        newLine: 3,
        newStartColumn: 5,
        newEndColumn: 15,
        reason: "Exact match",
      },
    ];

    const changed = applyReanchorResults(doc, results);
    expect(changed).toBe(1);
    expect(comment.start_column).toBe(5);
    expect(comment.end_column).toBe(15);
  });

  it("updates end_line for multi-line anchors", () => {
    const comment = makeComment({
      id: "c-range",
      line: 3,
      end_line: 4,
      selected_text: "line three\nline four",
    });
    const doc = makeDoc([comment]);

    const results: ReanchorResult[] = [
      {
        commentId: "c-range",
        status: "shifted",
        score: 1,
        newLine: 5,
        newEndLine: 6,
        reason: "Shifted via diff",
      },
    ];

    const changed = applyReanchorResults(doc, results);
    expect(changed).toBe(1);
    expect(comment.line).toBe(5);
    expect(comment.end_line).toBe(6);
  });

  it("skips comments not in results", () => {
    const comment = makeComment({ id: "c-skip", line: 3 });
    const doc = makeDoc([comment]);

    const changed = applyReanchorResults(doc, []);
    expect(changed).toBe(0);
  });
});

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

// ---------------------------------------------------------------------------
// reanchorDocument — batch re-anchoring
// ---------------------------------------------------------------------------

describe("reanchorDocument", () => {
  it("re-anchors all comments (noGit)", async () => {
    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        makeComment({
          id: "c1",
          line: 1,
          selected_text: "Hello World",
        }),
        makeComment({
          id: "c2",
          line: 2,
          selected_text: "second line",
        }),
      ],
    };
    const documentLines = lines1("Hello World", "second line", "third line");
    const results = await reanchorDocument(doc, documentLines, { noGit: true });
    expect(results).toHaveLength(2);
    expect(results[0].commentId).toBe("c1");
    expect(results[0].status).toBe("anchored");
    expect(results[1].commentId).toBe("c2");
    expect(results[1].status).toBe("anchored");
  });

  it("applies custom threshold (noGit)", async () => {
    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        makeComment({
          id: "c1",
          selected_text: "does not exist anywhere",
        }),
      ],
    };
    const documentLines = lines1("totally different text here");
    const results = await reanchorDocument(doc, documentLines, {
      noGit: true,
      threshold: 0.99,
    });
    expect(results).toHaveLength(1);
    // No line set and text doesn't match → orphaned
    expect(results[0].status).toBe("orphaned");
  });

  it("returns empty results when no comments", async () => {
    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [],
    };
    const results = await reanchorDocument(doc, lines1("line1"), { noGit: true });
    expect(results).toHaveLength(0);
  });

  it("re-anchors document text directly and normalizes CRLF line endings", () => {
    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        makeComment({
          id: "c1",
          line: 99,
          selected_text: "second line",
        }),
      ],
    };

    const results = reanchorDocumentText(doc, "first line\r\nsecond line\r\nthird line\r\n");

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("anchored");
    expect(results[0].newLine).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// reanchorFile — end-to-end with files on disk
// ---------------------------------------------------------------------------

describe("reanchorFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "reanchor-file-"));
  });

  it("re-anchors a sidecar file on disk (dryRun)", async () => {
    const docPath = path.join(tmpDir, "doc.md");
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");

    await writeFile(docPath, "Hello World\nsecond line\nthird line\n");
    await writeFile(
      sidecarPath,
      `mrsf_version: "1.0"\ndocument: doc.md\ncomments:\n  - id: c-1\n    author: A\n    timestamp: "2025-01-01"\n    text: Fix this\n    resolved: false\n    line: 1\n    selected_text: Hello World\n`,
    );

    const { results, changed, written } = await reanchorFile(sidecarPath, {
      dryRun: true,
      noGit: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("anchored");
    expect(changed).toBe(0);
    expect(written).toBe(false);
  });

  it("writes changes when not dryRun", async () => {
    const docPath = path.join(tmpDir, "doc2.md");
    const sidecarPath = path.join(tmpDir, "doc2.md.review.yaml");

    // Document has shifted lines
    await writeFile(docPath, "new first\nHello World\nthird line\n");
    await writeFile(
      sidecarPath,
      `mrsf_version: "1.0"\ndocument: doc2.md\ncomments:\n  - id: c-1\n    author: A\n    timestamp: "2025-01-01"\n    text: Fix this\n    resolved: false\n    line: 1\n    selected_text: Hello World\n`,
    );

    const { results, changed, written } = await reanchorFile(sidecarPath, {
      noGit: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("anchored");
    expect(results[0].newLine).toBe(2);
    expect(changed).toBeGreaterThanOrEqual(1);
    expect(written).toBe(true);
  });

  it("re-anchors a sidecar whose selected_text starts and ends with blank lines", async () => {
    const docPath = path.join(tmpDir, "blank-range.md");
    const sidecarPath = path.join(tmpDir, "blank-range.md.review.yaml");

    await writeFile(
      docPath,
      [
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "",
        "text text",
        "",
        "line 10",
        "",
      ].join("\n"),
    );

    await writeSidecar(sidecarPath, {
      mrsf_version: "1.0",
      document: "blank-range.md",
      comments: [
        makeComment({
          id: "c-blank",
          line: 7,
          end_line: 9,
          selected_text: "\ntext text\n",
        }),
      ],
    });

    const parsed = await parseSidecar(sidecarPath);
    expect(parsed.comments[0].selected_text).toBe("\ntext text\n");

    const { results } = await reanchorFile(sidecarPath, {
      dryRun: true,
      noGit: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("anchored");
    expect(results[0].newLine).toBe(7);
    expect(results[0].newEndLine).toBe(9);
  });

  it("parses and re-anchors a YAML block scalar with a leading blank line", async () => {
    const docPath = path.join(tmpDir, "blank-range-block.md");
    const sidecarPath = path.join(tmpDir, "blank-range-block.md.review.yaml");

    await writeFile(docPath, ["a", "b", "", "text text", "", "c"].join("\n"));
    await writeFile(
      sidecarPath,
      [
        'mrsf_version: "1.0"',
        "document: blank-range-block.md",
        "comments:",
        "  - id: c-block",
        "    author: A",
        '    timestamp: "2025-01-01T00:00:00Z"',
        "    text: Example",
        "    resolved: false",
        "    line: 3",
        "    end_line: 5",
        "    selected_text: |+",
        "",
        "      text text",
        "",
      ].join("\n"),
    );

    const parsed = await parseSidecar(sidecarPath);
    expect(parsed.comments[0].selected_text).toBe("\ntext text\n");

    const { results } = await reanchorFile(sidecarPath, {
      dryRun: true,
      noGit: true,
    });

    expect(results[0].status).toBe("anchored");
    expect(results[0].newLine).toBe(3);
    expect(results[0].newEndLine).toBe(5);
  });

  it("re-anchors LF selected_text against a CRLF document with blank edge lines", async () => {
    const docPath = path.join(tmpDir, "blank-range-crlf.md");
    const sidecarPath = path.join(tmpDir, "blank-range-crlf.md.review.yaml");

    await writeFile(
      docPath,
      ["line 1", "line 2", "", "text text", "", "line 6", ""].join("\r\n"),
    );
    await writeSidecar(sidecarPath, {
      mrsf_version: "1.0",
      document: "blank-range-crlf.md",
      comments: [
        makeComment({
          id: "c-crlf",
          line: 3,
          end_line: 5,
          selected_text: "\ntext text\n",
        }),
      ],
    });

    const { results } = await reanchorFile(sidecarPath, {
      dryRun: true,
      noGit: true,
    });

    expect(results[0].status).toBe("anchored");
    expect(results[0].newLine).toBe(3);
    expect(results[0].newEndLine).toBe(5);
  });
});

/**
 * Tests for the fuzzy matching engine.
 */

import { describe, it, expect } from "vitest";
import {
  exactMatch,
  normalizedMatch,
  fuzzySearch,
  combinedScore,
} from "../lib/fuzzy.js";

// Helper: make a 1-based line array (index 0 is unused).
function lines1(...content: string[]): string[] {
  return ["", ...content];
}

// ---------------------------------------------------------------------------
// exactMatch
// ---------------------------------------------------------------------------

describe("exactMatch", () => {
  const lines = lines1(
    "# Hello World",
    "",
    "This is a test document.",
    "Another line here.",
    "This is a test document.", // duplicate
  );

  it("finds a unique match", () => {
    const results = exactMatch(lines, "Another line here.");
    expect(results).toHaveLength(1);
    expect(results[0].line).toBe(4);
    expect(results[0].score).toBe(1.0);
  });

  it("finds multiple matches", () => {
    const results = exactMatch(lines, "This is a test document.");
    expect(results).toHaveLength(2);
    expect(results[0].line).toBe(3);
    expect(results[1].line).toBe(5);
  });

  it("returns empty for no match", () => {
    const results = exactMatch(lines, "nonexistent text");
    expect(results).toHaveLength(0);
  });

  it("matches multi-line text", () => {
    const results = exactMatch(lines, "This is a test document.\nAnother line here.");
    expect(results).toHaveLength(1);
    expect(results[0].line).toBe(3);
    expect(results[0].endLine).toBe(4);
  });

  it("matches substring within a line", () => {
    const results = exactMatch(lines, "test document");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].startColumn).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// normalizedMatch
// ---------------------------------------------------------------------------

describe("normalizedMatch", () => {
  const lines = lines1(
    "  function  foo(  bar  ) {",
    "  return bar;",
    "  }",
  );

  it("matches with normalized whitespace", () => {
    const results = normalizedMatch(lines, "function foo( bar ) {");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // At least one result should be the first real line with score 0.95
    const best = results.reduce((a, b) => (a.score >= b.score ? a : b));
    expect(best.score).toBe(0.95);
  });

  it("does not match completely different text", () => {
    const results = normalizedMatch(lines, "something else entirely");
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// combinedScore
// ---------------------------------------------------------------------------

describe("combinedScore", () => {
  it("returns 1.0 for identical strings", () => {
    expect(combinedScore("hello world", "hello world")).toBe(1.0);
  });

  it("returns high score for similar strings", () => {
    const score = combinedScore(
      "This is a test line",
      "This is a testing line",
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns low score for very different strings", () => {
    const score = combinedScore(
      "completely different content",
      "nothing similar here at all whatsoever",
    );
    expect(score).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// fuzzySearch
// ---------------------------------------------------------------------------

describe("fuzzySearch", () => {
  const lines = lines1(
    "# Introduction",
    "",
    "The quick brown fox jumps over the lazy dog.",
    "Another paragraph here.",
    "The slow brown fox crawls under the sleepy dog.", // similar to line 3
  );

  it("finds a high-confidence fuzzy match", () => {
    const results = fuzzySearch(
      lines,
      "The quick brown fox jumps over the lazy dog",
      0.8,
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].line).toBe(3);
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it("respects threshold", () => {
    const results = fuzzySearch(lines, "completely unrelated text", 0.9);
    expect(results).toHaveLength(0);
  });

  it("uses hintLine for proximity bonus", () => {
    const results = fuzzySearch(lines, "brown fox", 0.5, 5);
    // Should include matches near line 5
    expect(results.length).toBeGreaterThan(0);
  });
});

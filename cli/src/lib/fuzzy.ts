/**
 * MRSF Fuzzy Matching Engine
 *
 * Provides exact, normalized, token-level LCS, and character-level
 * Levenshtein matching for re-anchoring selected_text.
 */

import { distance as levenshtein } from "fastest-levenshtein";
import type { FuzzyCandidate } from "./types.js";

// ---------------------------------------------------------------------------
// Exact matching
// ---------------------------------------------------------------------------

/**
 * Find all exact occurrences of `needle` in lines (1-based array).
 */
export function exactMatch(
  lines: string[],
  needle: string,
): FuzzyCandidate[] {
  if (!needle) return [];

  const results: FuzzyCandidate[] = [];
  const needleLines = needle.split("\n");
  const needleLineCount = needleLines.length;

  // Slide a window across the document
  for (let startLine = 1; startLine <= lines.length - needleLineCount; startLine++) {
    // Build the text for this window
    const windowLines = lines.slice(startLine, startLine + needleLineCount);
    const windowText = windowLines.join("\n");

    // Check if the needle appears anywhere within this window (for single-line)
    if (needleLineCount === 1) {
      let col = 0;
      const line = windowLines[0];
      while (col < line.length) {
        const idx = line.indexOf(needle, col);
        if (idx === -1) break;
        results.push({
          text: needle,
          line: startLine,
          endLine: startLine,
          startColumn: idx,
          endColumn: idx + needle.length,
          score: 1.0,
        });
        col = idx + 1;
      }
    } else {
      // Multi-line: check if the window contains the exact needle
      const idx = windowText.indexOf(needle);
      if (idx !== -1) {
        // Calculate start column
        const beforeMatch = windowText.slice(0, idx);
        const linesBeforeEnd = beforeMatch.split("\n");
        const startCol = linesBeforeEnd[linesBeforeEnd.length - 1].length;

        // Calculate end column
        const afterMatch = needle.split("\n");
        const endCol = afterMatch[afterMatch.length - 1].length;
        if (startCol === 0 || linesBeforeEnd.length === 1) {
          results.push({
            text: needle,
            line: startLine + linesBeforeEnd.length - 1,
            endLine: startLine + linesBeforeEnd.length - 1 + afterMatch.length - 1,
            startColumn: startCol,
            endColumn: endCol,
            score: 1.0,
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Normalized matching (collapse whitespace)
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Find matches after normalizing whitespace.
 */
export function normalizedMatch(
  lines: string[],
  needle: string,
): FuzzyCandidate[] {
  const normNeedle = normalize(needle);
  if (!normNeedle) return [];

  const results: FuzzyCandidate[] = [];

  // Try expanding windows of varying sizes
  const needleLineEstimate = needle.split("\n").length;
  const minWindow = Math.max(1, needleLineEstimate - 1);
  const maxWindow = Math.min(lines.length - 1, needleLineEstimate + 2);

  for (let winSize = minWindow; winSize <= maxWindow; winSize++) {
    for (let startLine = 1; startLine + winSize - 1 < lines.length; startLine++) {
      const windowLines = lines.slice(startLine, startLine + winSize);
      const windowText = windowLines.join("\n");
      const normWindow = normalize(windowText);

      if (normWindow.includes(normNeedle)) {
        results.push({
          text: windowText,
          line: startLine,
          endLine: startLine + winSize - 1,
          startColumn: 0,
          endColumn: windowLines[windowLines.length - 1].length,
          score: 0.95,
        });
      }
    }
  }

  return deduplicateCandidates(results);
}

// ---------------------------------------------------------------------------
// Token-level LCS
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/**
 * Longest Common Subsequence length of two token arrays.
 */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  // Optimize: use two rows instead of full matrix
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

/**
 * Score two texts using token-level LCS.
 * Returns 0.0–1.0.
 */
export function tokenLcsScore(a: string, b: string): number {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.length === 0 && tokB.length === 0) return 1.0;
  if (tokA.length === 0 || tokB.length === 0) return 0.0;
  const lcs = lcsLength(tokA, tokB);
  return lcs / Math.max(tokA.length, tokB.length);
}

// ---------------------------------------------------------------------------
// Character-level Levenshtein score
// ---------------------------------------------------------------------------

/**
 * Normalized Levenshtein similarity 0.0–1.0.
 */
export function levenshteinScore(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

// ---------------------------------------------------------------------------
// Combined fuzzy scoring
// ---------------------------------------------------------------------------

/**
 * Compute a combined similarity score between two text fragments.
 * Blends token LCS (structural) and Levenshtein (character-level).
 */
export function combinedScore(needle: string, candidate: string): number {
  const tScore = tokenLcsScore(needle, candidate);

  // Full Levenshtein is expensive for long texts; only use for short ones
  let lScore: number;
  if (needle.length < 500 && candidate.length < 500) {
    lScore = levenshteinScore(needle, candidate);
  } else {
    lScore = tScore; // fall back to token score only
  }

  // Weight: 60% token LCS, 40% Levenshtein
  return tScore * 0.6 + lScore * 0.4;
}

// ---------------------------------------------------------------------------
// Fuzzy search across document
// ---------------------------------------------------------------------------

/**
 * Search the document for fuzzy matches of `needle`.
 *
 * @param lines     1-based line array (index 0 unused).
 * @param needle    The original selected_text.
 * @param threshold Minimum score to include (0.0–1.0).
 * @param hintLine  Optional original line number for proximity scoring.
 */
export function fuzzySearch(
  lines: string[],
  needle: string,
  threshold: number = 0.6,
  hintLine?: number,
): FuzzyCandidate[] {
  if (!needle) return [];

  const needleLines = needle.split("\n");
  const needleLineCount = needleLines.length;
  const candidates: FuzzyCandidate[] = [];

  // Window sizes: ±30% of original line count, minimum 1
  const minWindow = Math.max(1, Math.floor(needleLineCount * 0.7));
  const maxWindow = Math.min(
    lines.length - 1,
    Math.ceil(needleLineCount * 1.3) + 1,
  );

  for (let winSize = minWindow; winSize <= maxWindow; winSize++) {
    for (let startLine = 1; startLine + winSize - 1 < lines.length; startLine++) {
      const windowLines = lines.slice(startLine, startLine + winSize);
      const windowText = windowLines.join("\n");

      const score = combinedScore(needle, windowText);

      if (score >= threshold) {
        candidates.push({
          text: windowText,
          line: startLine,
          endLine: startLine + winSize - 1,
          startColumn: 0,
          endColumn: windowLines[windowLines.length - 1].length,
          score,
        });
      }
    }
  }

  // For single-line needles, also try substring matching within each line
  if (needleLineCount === 1 && needle.length < 200) {
    for (let lineNum = 1; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      if (!line) continue;

      // Sliding window within line
      const winLen = needle.length;
      const minWinLen = Math.max(3, Math.floor(winLen * 0.7));
      const maxWinLen = Math.min(line.length, Math.ceil(winLen * 1.3));

      for (let len = minWinLen; len <= maxWinLen; len++) {
        for (let col = 0; col + len <= line.length; col++) {
          const sub = line.substring(col, col + len);
          const score = combinedScore(needle, sub);
          if (score >= threshold) {
            candidates.push({
              text: sub,
              line: lineNum,
              endLine: lineNum,
              startColumn: col,
              endColumn: col + len,
              score,
            });
          }
        }
      }
    }
  }

  // Deduplicate and sort
  let deduped = deduplicateCandidates(candidates);

  // Apply proximity bonus if hintLine is provided
  if (hintLine != null) {
    deduped = deduped.map((c) => {
      const dist = Math.abs(c.line - hintLine);
      // Small bonus for proximity (up to 0.1 for exact line match)
      const proximityBonus = 0.1 * Math.max(0, 1 - dist / 50);
      return { ...c, score: Math.min(1.0, c.score + proximityBonus) };
    });
  }

  return deduped.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateCandidates(
  candidates: FuzzyCandidate[],
): FuzzyCandidate[] {
  const seen = new Map<string, FuzzyCandidate>();
  for (const c of candidates) {
    const key = `${c.line}:${c.startColumn}:${c.endLine}:${c.endColumn}`;
    const existing = seen.get(key);
    if (!existing || c.score > existing.score) {
      seen.set(key, c);
    }
  }
  return Array.from(seen.values());
}

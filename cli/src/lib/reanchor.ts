/**
 * MRSF Re-anchor Engine — §7.4 Anchoring Resolution Procedure.
 *
 * Implements a four-step algorithm to re-locate each comment's
 * anchor within the current document revision:
 *
 *   Step 0  – diff-based shift (git + commit available)
 *   Step 1  – exact text match
 *   Step 1.5– fuzzy match ≥ high threshold (0.8)
 *   Step 2  – line/column fallback (commit-aware staleness)
 *   Step 3  – lower-threshold fuzzy ≥ configured threshold (0.6)
 *   Step 4  – orphan
 */

import type {
  Comment,
  MrsfDocument,
  ReanchorOptions,
  ReanchorResult,
  ReanchorStatus,
  FuzzyCandidate,
  DiffHunk,
} from "./types.js";
import {
  findRepoRoot,
  getCurrentCommit,
  getDiff,
  getFileAtCommit,
  getLineShift,
  isGitAvailable,
  parseDiffHunks,
} from "./git.js";
import {
  exactMatch,
  fuzzySearch,
  normalizedMatch,
} from "./fuzzy.js";
import { readDocumentLines } from "./parser.js";
import { discoverSidecar, sidecarToDocument } from "./discovery.js";
import { parseSidecar } from "./parser.js";
import { writeSidecar } from "./writer.js";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGH_THRESHOLD = 0.8;
const DEFAULT_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Single comment re-anchoring
// ---------------------------------------------------------------------------

/**
 * Re-anchor a single comment against the current document lines.
 */
export function reanchorComment(
  comment: Comment,
  documentLines: string[],
  opts: {
    diffHunks?: DiffHunk[];
    threshold?: number;
    commitIsStale?: boolean;
  } = {},
): ReanchorResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const commentId = comment.id;
  const selectedText = comment.selected_text;

  // No selected_text and no line — nothing to anchor
  if (!selectedText && comment.line == null) {
    return {
      commentId,
      status: "anchored",
      score: 1.0,
      reason: "Document-level comment (no anchor needed).",
    };
  }

  // -----------------------------------------------------------------------
  // Step 0: Diff-based shift
  // -----------------------------------------------------------------------
  if (comment.line != null && opts.diffHunks?.length) {
    const { shift, modified } = getLineShift(opts.diffHunks, comment.line);

    // For line-only comments (no selected_text), apply the diff shift directly
    if (!selectedText) {
      const shiftedLine = comment.line + shift;
      const lineSpan =
        comment.end_line != null ? comment.end_line - comment.line : 0;
      const shiftedEndLine =
        comment.end_line != null ? shiftedLine + lineSpan : undefined;
      return {
        commentId,
        status: shift === 0 ? "anchored" : "shifted",
        score: 1.0,
        newLine: shiftedLine,
        newEndLine: shiftedEndLine,
        reason:
          shift === 0
            ? "Line-only comment unchanged (diff confirms position)."
            : `Line-only comment shifted by ${shift > 0 ? "+" : ""}${shift} line(s) via diff.`,
      };
    }

    if (!modified) {
      const shiftedLine = comment.line + shift;
      const lineSpan =
        comment.end_line != null ? comment.end_line - comment.line : 0;
      const shiftedEndLine =
        comment.end_line != null ? shiftedLine + lineSpan : undefined;

      // Verify the selected text still matches at the shifted position
      const textAtShifted = extractText(
        documentLines,
        shiftedLine,
        shiftedEndLine,
        comment.start_column,
        comment.end_column,
      );

      if (textAtShifted === selectedText) {
        return {
          commentId,
          status: shift === 0 ? "anchored" : "shifted",
          score: 1.0,
          newLine: shiftedLine,
          newEndLine: shiftedEndLine,
          reason:
            shift === 0
              ? "Diff confirms text unchanged at original position."
              : `Diff shifted by ${shift > 0 ? "+" : ""}${shift} line(s).`,
        };
      }
    }
    // Fall through — line was modified or text doesn't match after shift
  }

  // -----------------------------------------------------------------------
  // Step 1: Exact text match
  // -----------------------------------------------------------------------
  if (selectedText) {
    const exactCandidates = exactMatch(documentLines, selectedText);

    if (exactCandidates.length === 1) {
      const c = exactCandidates[0];
      return {
        commentId,
        status: "anchored",
        score: 1.0,
        newLine: c.line,
        newEndLine: c.endLine,
        newStartColumn: c.startColumn,
        newEndColumn: c.endColumn,
        reason: "Exact text match (unique).",
      };
    }

    if (exactCandidates.length > 1 && comment.line != null) {
      // Disambiguate by proximity to original line
      const best = closestToLine(exactCandidates, comment.line);
      return {
        commentId,
        status: "anchored",
        score: 1.0,
        newLine: best.line,
        newEndLine: best.endLine,
        newStartColumn: best.startColumn,
        newEndColumn: best.endColumn,
        reason: `Exact text match (${exactCandidates.length} occurrences; chose nearest to original line ${comment.line}).`,
      };
    }

    // -----------------------------------------------------------------------
    // Step 1.5: Normalized + high-threshold fuzzy match
    // -----------------------------------------------------------------------

    // Try whitespace-normalized match first
    const normCandidates = normalizedMatch(documentLines, selectedText);
    if (normCandidates.length === 1) {
      const c = normCandidates[0];
      return {
        commentId,
        status: "fuzzy",
        score: c.score,
        newLine: c.line,
        newEndLine: c.endLine,
        newStartColumn: c.startColumn,
        newEndColumn: c.endColumn,
        anchoredText: c.text,
        previousSelectedText: selectedText,
        reason: "Normalized whitespace match.",
      };
    }

    // High threshold fuzzy
    const fuzzyCandidates = fuzzySearch(
      documentLines, selectedText, HIGH_THRESHOLD, comment.line,
    );

    if (fuzzyCandidates.length === 1 || (fuzzyCandidates.length > 0 && fuzzyCandidates[0].score >= HIGH_THRESHOLD)) {
      const best =
        fuzzyCandidates.length === 1
          ? fuzzyCandidates[0]
          : closestToLine(fuzzyCandidates, comment.line ?? 1);
      return {
        commentId,
        status: "fuzzy",
        score: best.score,
        newLine: best.line,
        newEndLine: best.endLine,
        newStartColumn: best.startColumn,
        newEndColumn: best.endColumn,
        anchoredText: best.text,
        previousSelectedText: selectedText,
        reason: `High-confidence fuzzy match (score ${best.score.toFixed(3)}).`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Step 2: Line/column fallback
  // -----------------------------------------------------------------------
  if (comment.line != null) {
    const lineIdx = comment.line - 1;
    if (lineIdx >= 0 && lineIdx < documentLines.length) {
      const qualifier = opts.commitIsStale
        ? " (commit is stale — line may have shifted)"
        : "";

      // If we have selected_text, check if current line text is a decent fuzzy match
      if (selectedText) {
        const lineText = documentLines[lineIdx];
        const candidates = fuzzySearch(
          [lineText], selectedText, DEFAULT_THRESHOLD,
        );
        if (candidates.length > 0) {
          return {
            commentId,
            status: "fuzzy",
            score: candidates[0].score,
            newLine: comment.line,
            newEndLine: comment.end_line,
            anchoredText: candidates[0].text,
            previousSelectedText: selectedText,
            reason: `Line-fallback with fuzzy text match (score ${candidates[0].score.toFixed(3)})${qualifier}.`,
          };
        }
      }

      // Pure line fallback
      // If there's no selected_text, the comment is purely line-anchored.
      // A commit change alone doesn't make it ambiguous — we accept it as-is.
      const isLineOnly = !selectedText;
      return {
        commentId,
        status: isLineOnly ? "anchored" : (opts.commitIsStale ? "ambiguous" : "anchored"),
        score: isLineOnly ? 1.0 : (opts.commitIsStale ? 0.5 : 0.8),
        newLine: comment.line,
        newEndLine: comment.end_line,
        reason: isLineOnly
          ? "Line-only comment (no selected_text to verify)."
          : `Line/column fallback${qualifier}.`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Step 3: Lower-threshold fuzzy search
  // -----------------------------------------------------------------------
  if (selectedText) {
    const lowCandidates = fuzzySearch(
      documentLines, selectedText, threshold, comment.line,
    );

    if (lowCandidates.length === 1) {
      const c = lowCandidates[0];
      return {
        commentId,
        status: "fuzzy",
        score: c.score,
        newLine: c.line,
        newEndLine: c.endLine,
        newStartColumn: c.startColumn,
        newEndColumn: c.endColumn,
        anchoredText: c.text,
        previousSelectedText: selectedText,
        reason: `Low-threshold fuzzy match (score ${c.score.toFixed(3)}).`,
      };
    }

    if (lowCandidates.length > 1) {
      // Ambiguous — multiple low-confidence matches
      const best = lowCandidates[0];
      return {
        commentId,
        status: "ambiguous",
        score: best.score,
        newLine: best.line,
        newEndLine: best.endLine,
        reason: `Ambiguous: ${lowCandidates.length} fuzzy matches (best score ${best.score.toFixed(3)}).`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Orphan
  // -----------------------------------------------------------------------
  return {
    commentId,
    status: "orphaned",
    score: 0,
    reason: "No match found. Comment is orphaned.",
  };
}

// ---------------------------------------------------------------------------
// Batch re-anchoring
// ---------------------------------------------------------------------------

/**
 * Re-anchor all comments in an MRSF document.
 */
export async function reanchorDocument(
  doc: MrsfDocument,
  documentLines: string[],
  opts: ReanchorOptions & {
    documentPath?: string;
    repoRoot?: string;
  } = {},
): Promise<ReanchorResult[]> {
  const results: ReanchorResult[] = [];
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  // Determine git context
  let diffHunks: DiffHunk[] | undefined;
  let commitIsStale = false;

  if (!opts.noGit && (await isGitAvailable())) {
    const repoRoot = opts.repoRoot ?? (await findRepoRoot(opts.cwd));
    if (repoRoot && opts.documentPath) {
      const relPath = path.relative(repoRoot, opts.documentPath);
      const head = await getCurrentCommit(repoRoot);

      // Use a shared fromCommit for all comments, or per-comment
      const globalFrom = opts.fromCommit;

      for (const comment of doc.comments) {
        const commentCommit = globalFrom ?? comment.commit;
        if (commentCommit && head && commentCommit !== head) {
          commitIsStale = true;
          // Get diff for this commit range
          const hunks = await getDiff(commentCommit, head, relPath, repoRoot);
          const result = reanchorComment(comment, documentLines, {
            diffHunks: hunks,
            threshold,
            commitIsStale: true,
          });
          results.push(result);
          continue;
        }

        // non-stale or no commit
        results.push(
          reanchorComment(comment, documentLines, { threshold, commitIsStale: false }),
        );
      }

      return results;
    }
  }

  // No git — pure text-based re-anchoring
  for (const comment of doc.comments) {
    results.push(
      reanchorComment(comment, documentLines, { threshold }),
    );
  }

  return results;
}

/**
 * Apply re-anchor results to the document's comments.
 * Mutates the document in place and returns the number of changed comments.
 */
export function applyReanchorResults(
  doc: MrsfDocument,
  results: ReanchorResult[],
  opts: { updateText?: boolean; force?: boolean; headCommit?: string } = {},
): number {
  let changed = 0;
  const resultMap = new Map(results.map((r) => [r.commentId, r]));

  for (const comment of doc.comments) {
    const result = resultMap.get(comment.id);
    if (!result) continue;

    let isChanged = false;

    if (result.newLine != null && result.newLine !== comment.line) {
      comment.line = result.newLine;
      isChanged = true;
    }
    if (result.newEndLine != null && result.newEndLine !== comment.end_line) {
      comment.end_line = result.newEndLine;
      isChanged = true;
    }
    if (result.newStartColumn != null && result.newStartColumn !== comment.start_column) {
      comment.start_column = result.newStartColumn;
      isChanged = true;
    }
    if (result.newEndColumn != null && result.newEndColumn !== comment.end_column) {
      comment.end_column = result.newEndColumn;
      isChanged = true;
    }

    // Handle anchored_text / selected_text per §6.2 & §7.4 Step 3a.
    // By default, selected_text is preserved (SHOULD NOT modify).
    // anchored_text records the text currently at the resolved position.
    if (result.anchoredText != null && result.anchoredText !== comment.selected_text) {
      if (opts.updateText) {
        // Opt-in: replace selected_text and clear anchored_text
        comment.selected_text = result.anchoredText;
        delete comment.anchored_text;
      } else {
        // Default: preserve selected_text, record current text in anchored_text
        comment.anchored_text = result.anchoredText;
      }
      isChanged = true;
    } else if (result.anchoredText != null && result.anchoredText === comment.selected_text) {
      // Text matches exactly — clear any stale anchored_text
      if (comment.anchored_text) {
        delete comment.anchored_text;
        isChanged = true;
      }
    }

    // Audit fields (x_ extension prefix per §10)
    if (isChanged || result.status !== "anchored") {
      comment.x_reanchor_status = result.status;
      comment.x_reanchor_score = result.score;
    }

    // --force: firmly anchor high-confidence results
    // Update commit to HEAD and clear audit fields so the comment
    // won't be re-evaluated on the next reanchor run.
    if (
      opts.force &&
      opts.headCommit &&
      (result.status === "anchored" || result.status === "shifted") &&
      result.score >= HIGH_THRESHOLD
    ) {
      comment.commit = opts.headCommit;
      delete comment.x_reanchor_status;
      delete comment.x_reanchor_score;
      // Clear stale anchored_text since anchor is now confirmed
      if (comment.anchored_text && comment.anchored_text === comment.selected_text) {
        delete comment.anchored_text;
      }
      isChanged = true;
    }

    if (isChanged) changed++;
  }

  return changed;
}

/**
 * High-level re-anchor for a single sidecar file path.
 */
export async function reanchorFile(
  sidecarPath: string,
  opts: ReanchorOptions = {},
): Promise<{
  results: ReanchorResult[];
  changed: number;
  written: boolean;
}> {
  const doc = await parseSidecar(sidecarPath);
  const docPath = sidecarToDocument(sidecarPath);
  const documentLines = await readDocumentLines(docPath);

  const repoRoot = !opts.noGit ? await findRepoRoot(opts.cwd) : null;
  const headCommit = repoRoot ? await getCurrentCommit(repoRoot) : undefined;

  const results = await reanchorDocument(doc, documentLines, {
    ...opts,
    documentPath: docPath,
    repoRoot: repoRoot ?? undefined,
  });

  let changed = 0;
  let written = false;

  if (!opts.dryRun) {
    changed = applyReanchorResults(doc, results, {
      updateText: opts.updateText,
      force: opts.force,
      headCommit: headCommit ?? undefined,
    });
    if (changed > 0 || opts.autoUpdate) {
      await writeSidecar(sidecarPath, doc);
      written = true;
    }
  }

  return { results, changed, written };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text from document lines at the given position.
 * Lines array is 1-based (index 0 is unused), so lines[line] is the content.
 */
function extractText(
  lines: string[],
  line: number,
  endLine?: number,
  startColumn?: number,
  endColumn?: number,
): string | null {
  const startIdx = line;  // 1-based array: lines[1] = first line
  const endIdx = endLine ?? line;

  if (startIdx < 1 || endIdx >= lines.length) return null;

  if (startIdx === endIdx) {
    const text = lines[startIdx];
    if (startColumn != null && endColumn != null) {
      return text.slice(startColumn, endColumn);
    }
    return text;
  }

  // Multi-line
  const result: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    let l = lines[i];
    if (i === startIdx && startColumn != null) l = l.slice(startColumn);
    if (i === endIdx && endColumn != null) l = l.slice(0, endColumn);
    result.push(l);
  }
  return result.join("\n");
}

/**
 * Pick the candidate closest to a hint line.
 */
function closestToLine<T extends { line: number }>(
  candidates: T[],
  targetLine: number,
): T {
  return candidates.reduce((best, c) =>
    Math.abs(c.line - targetLine) < Math.abs(best.line - targetLine) ? c : best,
  );
}

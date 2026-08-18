import type {
  AnchorPosition,
  Comment,
  DiffHunk,
  FuzzyCandidate,
  MrsfDocument,
  ReanchorResult,
} from "./types.js";
import {
  exactMatch,
  fuzzySearch,
  fuzzySearchThresholds,
  normalizedMatch,
} from "./fuzzy.js";
import {
  projectCommentAnchor,
  type RevisionProjectionIndex,
} from "./revision-projection.js";

export const HIGH_THRESHOLD = 0.8;
export const DEFAULT_THRESHOLD = 0.6;

/**
 * Default proximity window (in lines) for the §7.4 step 1a relocation guard.
 *
 * A lone exact match of `selected_text` that lands farther than this many
 * lines from the comment's original `line` — while the text at the original
 * position has changed — is treated as an in-place edit rather than a
 * confident relocation. See {@link isImplausibleExactRelocation}.
 */
export const DEFAULT_PROXIMITY_WINDOW = 5;

export function toReanchorLines(documentText: string): string[] {
  return ["", ...documentText.replace(/\r\n/g, "\n").split("\n")];
}

export function reanchorComment(
  comment: Comment,
  documentLines: string[],
  opts: {
    diffHunks?: DiffHunk[];
    threshold?: number;
    commitIsStale?: boolean;
    proximityWindow?: number;
    revisionProjection?: RevisionProjectionIndex;
  } = {},
): ReanchorResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const proximityWindow = opts.proximityWindow ?? DEFAULT_PROXIMITY_WINDOW;
  const commentId = comment.id;
  const selectedText = comment.selected_text;
  let fuzzyCandidateSets: Map<number, FuzzyCandidate[]> | undefined;

  if (!selectedText && comment.line == null) {
    return {
      commentId,
      status: "anchored",
      score: 1.0,
      reason: "Document-level comment (no anchor needed).",
    };
  }

  if (comment.line != null && opts.diffHunks?.length) {
    const { shift, modified } = getLineShift(opts.diffHunks, comment.line);

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
  }

  if (selectedText && opts.revisionProjection) {
    const projected = projectCommentAnchor(
      comment,
      opts.revisionProjection,
      threshold,
    );
    if (projected) {
      return {
        commentId,
        status: projected.exact ? "anchored" : "fuzzy",
        score: projected.score,
        newLine: projected.line,
        newEndLine: projected.endLine,
        newStartColumn: projected.startColumn,
        newEndColumn: projected.endColumn,
        anchoredText: projected.exact ? undefined : projected.text,
        previousSelectedText: projected.exact ? undefined : selectedText,
        reason: projected.reason,
      };
    }
  }

  if (selectedText) {
    const exactCandidates = exactMatch(documentLines, selectedText);

    // Pick the best exact candidate: the only one, or — when several remain —
    // the one nearest to the original line (§7.4 step 1b).
    let chosen: FuzzyCandidate | undefined;
    let chosenReason = "";
    if (exactCandidates.length === 1) {
      chosen = exactCandidates[0];
      chosenReason = "Exact text match (unique).";
    } else if (exactCandidates.length > 1 && comment.line != null) {
      chosen = closestToLine(exactCandidates, comment.line);
      chosenReason = `Exact text match (${exactCandidates.length} occurrences; chose nearest to original line ${comment.line}).`;
    }

    if (chosen) {
      // §7.4 step 1a proximity guard: a lone/closest exact match that lands far
      // from the original position — while the text at the original position no
      // longer equals selected_text — most likely indicates an in-place edit of
      // the anchored text, not a genuine relocation. Keep the comment at its
      // original position and flag it for re-anchoring instead of teleporting it
      // onto an unrelated identical token with full confidence.
      if (isImplausibleExactRelocation(comment, chosen, documentLines, proximityWindow)) {
        const textAtOrigin = extractText(
          documentLines,
          comment.line as number,
          comment.end_line,
          comment.start_column,
          comment.end_column,
        );
        return {
          commentId,
          status: "fuzzy",
          score: 0.5,
          newLine: comment.line,
          newEndLine: comment.end_line,
          newStartColumn: comment.start_column,
          newEndColumn: comment.end_column,
          anchoredText: textAtOrigin ?? undefined,
          previousSelectedText: selectedText,
          reason:
            `Lone exact match at line ${chosen.line} is beyond the proximity window ` +
            `(±${proximityWindow}) of original line ${comment.line} and the text at the ` +
            `original position changed; kept at original position, needs re-anchoring.`,
        };
      }

      return {
        commentId,
        status: "anchored",
        score: 1.0,
        newLine: chosen.line,
        newEndLine: chosen.endLine,
        newStartColumn: chosen.startColumn,
        newEndColumn: chosen.endColumn,
        reason: chosenReason,
      };
    }

    const normCandidates = normalizedMatch(documentLines, selectedText);
    if (normCandidates.length === 1) {
      const candidate = normCandidates[0];
      return {
        commentId,
        status: "fuzzy",
        score: candidate.score,
        newLine: candidate.line,
        newEndLine: candidate.endLine,
        newStartColumn: candidate.startColumn,
        newEndColumn: candidate.endColumn,
        anchoredText: candidate.text,
        previousSelectedText: selectedText,
        reason: "Normalized whitespace match.",
      };
    }

    fuzzyCandidateSets = fuzzySearchThresholds(
      documentLines,
      selectedText,
      [HIGH_THRESHOLD, threshold],
      comment.line,
    );
    const fuzzyCandidates = fuzzyCandidateSets.get(HIGH_THRESHOLD) ?? [];

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

  if (comment.line != null) {
    const lineIdx = comment.line;
    if (lineIdx > 0 && lineIdx < documentLines.length) {
      const qualifier = opts.commitIsStale
        ? " (commit is stale — line may have shifted)"
        : "";

      if (selectedText) {
        const lineText = documentLines[lineIdx];
        const candidates = fuzzySearch(["", lineText], selectedText, DEFAULT_THRESHOLD);
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

  if (selectedText) {
    const lowCandidates = fuzzyCandidateSets?.get(threshold)
      ?? fuzzySearch(documentLines, selectedText, threshold, comment.line);

    if (lowCandidates.length === 1) {
      const candidate = lowCandidates[0];
      return {
        commentId,
        status: "fuzzy",
        score: candidate.score,
        newLine: candidate.line,
        newEndLine: candidate.endLine,
        newStartColumn: candidate.startColumn,
        newEndColumn: candidate.endColumn,
        anchoredText: candidate.text,
        previousSelectedText: selectedText,
        reason: `Low-threshold fuzzy match (score ${candidate.score.toFixed(3)}).`,
      };
    }

    if (lowCandidates.length > 1) {
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

  return {
    commentId,
    status: "orphaned",
    score: 0,
    reason: "No match found. Comment is orphaned.",
  };
}

export function reanchorDocumentLines(
  doc: MrsfDocument,
  documentLines: string[],
  opts: { threshold?: number; proximityWindow?: number } = {},
): ReanchorResult[] {
  return doc.comments.map((comment) => reanchorComment(comment, documentLines, opts));
}

export function reanchorDocumentText(
  doc: MrsfDocument,
  documentText: string,
  opts: { threshold?: number; proximityWindow?: number } = {},
): ReanchorResult[] {
  return reanchorDocumentLines(doc, toReanchorLines(documentText), opts);
}

export function resolveAnchor(
  comment: Comment,
  documentText: string,
  opts: { threshold?: number; proximityWindow?: number } = {},
): AnchorPosition {
  const normalizedText = documentText.replace(/\r\n/g, "\n");
  const documentLines = toReanchorLines(documentText);
  const result = reanchorComment(comment, documentLines, opts);

  if (result.status === "orphaned") {
    return {
      status: "orphaned",
      score: result.score,
      reason: result.reason,
    };
  }

  const line = result.newLine ?? comment.line;
  if (line == null) {
    return {
      status: result.status,
      score: result.score,
      reason: result.reason,
    };
  }

  const rawLines = normalizedText.split("\n");
  const lineStarts = computeLineStarts(rawLines);
  const endLine = result.newEndLine ?? comment.end_line ?? line;
  const startColumn = result.newStartColumn ?? comment.start_column ?? 0;
  const endColumn = result.newEndColumn ?? comment.end_column;
  const from = offsetFor(lineStarts, rawLines, line, startColumn);
  const selectedText = comment.selected_text?.replace(/\r\n/g, "\n");
  const to =
    endColumn != null
      ? offsetFor(lineStarts, rawLines, endLine, endColumn)
      : selectedText
        ? from + selectedText.length
        : offsetFor(lineStarts, rawLines, endLine, rawLines[endLine - 1]?.length ?? 0);

  return {
    status: result.status,
    score: result.score,
    from,
    to,
    line,
    endLine,
    startColumn,
    endColumn: endColumn ?? columnForOffset(lineStarts, rawLines, endLine, to),
    reason: result.reason,
  };
}

function computeLineStarts(lines: string[]): number[] {
  const starts = [0];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

function offsetFor(
  lineStarts: number[],
  lines: string[],
  line: number,
  column: number,
): number {
  const start = lineStarts[line] ?? 0;
  const maxColumn = lines[line - 1]?.length ?? 0;
  return start + Math.max(0, Math.min(column, maxColumn));
}

function columnForOffset(
  lineStarts: number[],
  lines: string[],
  line: number,
  offset: number,
): number {
  const start = lineStarts[line] ?? 0;
  const maxColumn = lines[line - 1]?.length ?? 0;
  return Math.max(0, Math.min(offset - start, maxColumn));
}

export function applyReanchorResults(
  doc: MrsfDocument,
  results: ReanchorResult[],
  opts: { updateText?: boolean; force?: boolean; headCommit?: string } = {},
): number {
  let changed = 0;
  const resultMap = new Map(results.map((result) => [result.commentId, result]));

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

    if (result.anchoredText != null && result.anchoredText !== comment.selected_text) {
      if (opts.updateText) {
        comment.selected_text = result.anchoredText;
        delete comment.anchored_text;
      } else {
        comment.anchored_text = result.anchoredText;
      }
      isChanged = true;
    } else if (result.anchoredText != null && result.anchoredText === comment.selected_text) {
      if (comment.anchored_text) {
        delete comment.anchored_text;
        isChanged = true;
      }
    }

    if (isChanged || result.status !== "anchored") {
      comment.x_reanchor_status = result.status;
      comment.x_reanchor_score = result.score;
    }

    if (
      opts.force
      && opts.headCommit
      && (result.status === "anchored" || result.status === "shifted")
      && result.score >= HIGH_THRESHOLD
    ) {
      comment.commit = opts.headCommit;
      delete comment.x_reanchor_status;
      delete comment.x_reanchor_score;
      if (comment.anchored_text && comment.anchored_text === comment.selected_text) {
        delete comment.anchored_text;
      }
      isChanged = true;
    }

    if (isChanged) {
      changed += 1;
    }
  }

  return changed;
}

function extractText(
  lines: string[],
  line: number,
  endLine?: number,
  startColumn?: number,
  endColumn?: number,
): string | null {
  const startIdx = line;
  const endIdx = endLine ?? line;

  if (startIdx < 1 || endIdx >= lines.length) return null;

  if (startIdx === endIdx) {
    const text = lines[startIdx];
    if (startColumn != null && endColumn != null) {
      return text.slice(startColumn, endColumn);
    }
    return text;
  }

  const result: string[] = [];
  for (let index = startIdx; index <= endIdx; index += 1) {
    let currentLine = lines[index];
    if (index === startIdx && startColumn != null) currentLine = currentLine.slice(startColumn);
    if (index === endIdx && endColumn != null) currentLine = currentLine.slice(0, endColumn);
    result.push(currentLine);
  }
  return result.join("\n");
}

function closestToLine<T extends { line: number }>(candidates: T[], targetLine: number): T {
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.line - targetLine) < Math.abs(best.line - targetLine) ? candidate : best,
  );
}

/**
 * §7.4 step 1a relocation guard.
 *
 * Returns true when a chosen exact-match candidate is an *implausible*
 * full-confidence relocation: the original `line` still exists in the document,
 * the candidate is farther than `proximityWindow` lines away, and the text now
 * at the original position no longer equals `selected_text`. This is the
 * signature of an in-place edit of the anchored text (which removed the
 * original occurrence) rather than a genuine move of the selection.
 *
 * When the original line no longer exists (the document shrank or the section
 * was removed) or no positional anchor is available, relocation is treated as a
 * legitimate §7.4 step 3 contextual re-anchor and this returns false.
 */
function isImplausibleExactRelocation(
  comment: Comment,
  candidate: FuzzyCandidate,
  lines: string[],
  proximityWindow: number,
): boolean {
  if (comment.line == null) return false;

  // Original position must still exist to be a viable fallback anchor.
  if (comment.line <= 0 || comment.line >= lines.length) return false;

  // A nearby match is plausibly the same (or an adjacent) edit region.
  if (Math.abs(candidate.line - comment.line) <= proximityWindow) return false;

  // If the text at the original position still equals selected_text, the
  // original occurrence is intact and relocation is not a teleport.
  const textAtOrigin = extractText(
    lines,
    comment.line,
    comment.end_line,
    comment.start_column,
    comment.end_column,
  );
  if (textAtOrigin === comment.selected_text) return false;

  return true;
}

function getLineShift(diffHunks: DiffHunk[], line: number): { shift: number; modified: boolean } {
  let shift = 0;
  let modified = false;

  for (const hunk of diffHunks) {
    const oldStart = hunk.oldStart;
    const oldEnd = hunk.oldStart + Math.max(hunk.oldCount, 1) - 1;

    if (line >= oldStart && line <= oldEnd && hunk.oldCount > 0) {
      modified = true;
    }

    if (line > oldEnd || (hunk.oldCount === 0 && line >= oldStart)) {
      shift += hunk.newCount - hunk.oldCount;
    }
  }

  return { shift, modified };
}
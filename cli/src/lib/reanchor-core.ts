import type {
  Comment,
  DiffHunk,
  MrsfDocument,
  ReanchorResult,
} from "./types.js";
import {
  exactMatch,
  fuzzySearch,
  normalizedMatch,
} from "./fuzzy.js";

export const HIGH_THRESHOLD = 0.8;
export const DEFAULT_THRESHOLD = 0.6;

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
  } = {},
): ReanchorResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const commentId = comment.id;
  const selectedText = comment.selected_text;

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

  if (selectedText) {
    const exactCandidates = exactMatch(documentLines, selectedText);

    if (exactCandidates.length === 1) {
      const candidate = exactCandidates[0];
      return {
        commentId,
        status: "anchored",
        score: 1.0,
        newLine: candidate.line,
        newEndLine: candidate.endLine,
        newStartColumn: candidate.startColumn,
        newEndColumn: candidate.endColumn,
        reason: "Exact text match (unique).",
      };
    }

    if (exactCandidates.length > 1 && comment.line != null) {
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

    const fuzzyCandidates = fuzzySearch(
      documentLines,
      selectedText,
      HIGH_THRESHOLD,
      comment.line,
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

  if (comment.line != null) {
    const lineIdx = comment.line - 1;
    if (lineIdx >= 0 && lineIdx < documentLines.length) {
      const qualifier = opts.commitIsStale
        ? " (commit is stale — line may have shifted)"
        : "";

      if (selectedText) {
        const lineText = documentLines[lineIdx];
        const candidates = fuzzySearch([lineText], selectedText, DEFAULT_THRESHOLD);
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
    const lowCandidates = fuzzySearch(
      documentLines,
      selectedText,
      threshold,
      comment.line,
    );

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
  opts: { threshold?: number } = {},
): ReanchorResult[] {
  return doc.comments.map((comment) => reanchorComment(comment, documentLines, opts));
}

export function reanchorDocumentText(
  doc: MrsfDocument,
  documentText: string,
  opts: { threshold?: number } = {},
): ReanchorResult[] {
  return reanchorDocumentLines(doc, toReanchorLines(documentText), opts);
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
import { combinedScore, exactMatch } from "./fuzzy.js";
import type { Comment } from "./types.js";

const CONTEXT_RADIUS = 8;

export interface RevisionProjectionIndex {
  sourceLines: string[];
  targetLines: string[];
  lineMap: Map<number, number>;
}

export interface ProjectedAnchor {
  line: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  text: string;
  score: number;
  exact: boolean;
  contextSupport: number;
  contextMargin: number;
  reason: string;
}

export function createRevisionProjection(
  sourceLines: string[],
  targetLines: string[],
): RevisionProjectionIndex {
  const sourceOccurrences = collectLineOccurrences(sourceLines);
  const targetOccurrences = collectLineOccurrences(targetLines);
  const lineMap = new Map<number, number>();

  for (const [text, sourceLineNumbers] of sourceOccurrences) {
    const targetLineNumbers = targetOccurrences.get(text);
    if (sourceLineNumbers.length === 1 && targetLineNumbers?.length === 1) {
      lineMap.set(sourceLineNumbers[0], targetLineNumbers[0]);
    }
  }

  return { sourceLines, targetLines, lineMap };
}

export function projectCommentAnchor(
  comment: Comment,
  projection: RevisionProjectionIndex,
  threshold: number,
): ProjectedAnchor | undefined {
  if (comment.line == null || !comment.selected_text) return undefined;

  const sourceText = extractText(
    projection.sourceLines,
    comment.line,
    comment.end_line,
    comment.start_column,
    comment.end_column,
  );
  if (sourceText !== comment.selected_text) return undefined;

  const exactCandidates = exactMatch(
    projection.targetLines,
    comment.selected_text,
  );
  if (exactCandidates.length === 1) {
    const candidate = exactCandidates[0];
    const contextSupport = countIndependentExactSupport(
      comment,
      candidate.line,
      projection,
    );
    if (contextSupport >= 2) {
      return {
        line: candidate.line,
        endLine: candidate.endLine,
        startColumn: candidate.startColumn,
        endColumn: candidate.endColumn,
        text: candidate.text,
        score: 1,
        exact: true,
        contextSupport,
        contextMargin: 1,
        reason: "Source revision and neighboring line evidence confirm exact relocation.",
      };
    }
  }
  if (exactCandidates.length > 0) return undefined;

  const projected = projectLineFromContext(comment, projection);
  if (projected == null) return undefined;
  const projectedLine = projected.line;

  const lineSpan = (comment.end_line ?? comment.line) - comment.line;
  const projectedEndLine = projectedLine + lineSpan;
  if (
    projectedLine < 1
    || projectedEndLine >= projection.targetLines.length
  ) {
    return undefined;
  }

  const columns = projectColumns(comment, projection, projectedLine);
  const targetText = extractText(
    projection.targetLines,
    projectedLine,
    projectedEndLine,
    columns.startColumn,
    columns.endColumn,
  );
  if (targetText == null) return undefined;

  const score = Math.min(
    1,
    combinedScore(comment.selected_text, targetText) + 0.1,
  );
  if (score < threshold) return undefined;

  return {
    line: projectedLine,
    endLine: projectedEndLine,
    startColumn: columns.startColumn,
    endColumn: columns.endColumn,
    text: targetText,
    score,
    exact: targetText === comment.selected_text,
    contextSupport: projected.support,
    contextMargin: projected.margin,
    reason: "Source revision context projects the edited anchor range.",
  };
}

function collectLineOccurrences(lines: string[]): Map<string, number[]> {
  const occurrences = new Map<string, number[]>();

  for (let line = 1; line < lines.length; line += 1) {
    const text = lines[line];
    if (!text.trim()) continue;
    const existing = occurrences.get(text);
    if (existing) {
      existing.push(line);
    } else {
      occurrences.set(text, [line]);
    }
  }

  return occurrences;
}

function countIndependentExactSupport(
  comment: Comment,
  candidateLine: number,
  projection: RevisionProjectionIndex,
): number {
  const sourceEndLine = comment.end_line ?? (comment.line as number);
  const expectedShift = candidateLine - (comment.line as number);

  if (
    comment.start_column != null
    || comment.end_column != null
  ) {
    const mappedContainerLine = projection.lineMap.get(comment.line as number);
    if (mappedContainerLine === candidateLine) return 2;
  }

  let support = 0;
  for (
    let distance = 1;
    distance <= CONTEXT_RADIUS;
    distance += 1
  ) {
    for (const sourceLine of [
      (comment.line as number) - distance,
      sourceEndLine + distance,
    ]) {
      if (sourceLine < 1 || sourceLine >= projection.sourceLines.length) {
        continue;
      }
      const targetLine = projection.lineMap.get(sourceLine);
      if (targetLine != null && targetLine - sourceLine === expectedShift) {
        support += 1;
      }
    }
  }

  return support;
}

function projectLineFromContext(
  comment: Comment,
  projection: RevisionProjectionIndex,
): { line: number; support: number; margin: number } | undefined {
  const sourceLine = comment.line as number;
  const sourceEndLine = comment.end_line ?? sourceLine;
  const votes = new Map<number, { count: number; nearest: number }>();

  for (let distance = 1; distance <= CONTEXT_RADIUS; distance += 1) {
    for (const contextLine of [
      sourceLine - distance,
      sourceEndLine + distance,
    ]) {
      if (contextLine < 1 || contextLine >= projection.sourceLines.length) {
        continue;
      }
      const targetLine = projection.lineMap.get(contextLine);
      if (targetLine == null) continue;
      const shift = targetLine - contextLine;
      const vote = votes.get(shift);
      if (vote) {
        vote.count += 1;
        vote.nearest = Math.min(vote.nearest, distance);
      } else {
        votes.set(shift, { count: 1, nearest: distance });
      }
    }
  }

  const ranked = [...votes.entries()].sort((left, right) =>
    right[1].count - left[1].count
    || left[1].nearest - right[1].nearest
    || Math.abs(left[0]) - Math.abs(right[0])
  );
  const best = ranked[0];
  if (!best) return undefined;
  if (best[1].count < 2 && best[1].nearest > 3) return undefined;
  if (
    ranked[1]
    && ranked[1][1].count === best[1].count
    && ranked[1][1].nearest === best[1].nearest
  ) {
    return undefined;
  }

  const runnerUpCount = ranked[1]?.[1].count ?? 0;
  return {
    line: sourceLine + best[0],
    support: best[1].count,
    margin: (best[1].count - runnerUpCount) / best[1].count,
  };
}

function projectColumns(
  comment: Comment,
  projection: RevisionProjectionIndex,
  targetLine: number,
): { startColumn?: number; endColumn?: number } {
  if (
    comment.line == null
    || (comment.end_line != null && comment.end_line !== comment.line)
    || comment.start_column == null
    || comment.end_column == null
  ) {
    return {
      startColumn: comment.start_column,
      endColumn: comment.end_column,
    };
  }

  const sourceLine = projection.sourceLines[comment.line];
  const targetLineText = projection.targetLines[targetLine];
  const prefix = sourceLine.slice(0, comment.start_column);
  const suffix = sourceLine.slice(comment.end_column);
  const startColumn = targetLineText.startsWith(prefix)
    ? prefix.length
    : Math.min(comment.start_column, targetLineText.length);
  const endColumn = targetLineText.endsWith(suffix)
    ? targetLineText.length - suffix.length
    : Math.min(
      targetLineText.length,
      startColumn + (comment.end_column - comment.start_column),
    );

  return { startColumn, endColumn };
}

function extractText(
  lines: string[],
  line: number,
  endLine?: number,
  startColumn?: number,
  endColumn?: number,
): string | null {
  const finalLine = endLine ?? line;
  if (line < 1 || finalLine >= lines.length) return null;

  if (line === finalLine) {
    const text = lines[line];
    return startColumn != null && endColumn != null
      ? text.slice(startColumn, endColumn)
      : text;
  }

  const result: string[] = [];
  for (let current = line; current <= finalLine; current += 1) {
    let text = lines[current];
    if (current === line && startColumn != null) text = text.slice(startColumn);
    if (current === finalLine && endColumn != null) text = text.slice(0, endColumn);
    result.push(text);
  }
  return result.join("\n");
}

import { combinedScore } from "./fuzzy.js";
import type { Comment, ReanchorStatus } from "./types.js";

const MATCH_THRESHOLD = 0.35;
const AMBIGUITY_MARGIN = 0.03;

type BlockType =
  | "heading"
  | "code"
  | "list"
  | "table"
  | "blockquote"
  | "paragraph";

interface MarkdownBlock {
  startLine: number;
  endLine: number;
  type: BlockType;
  text: string;
  headingPath: string[];
}

interface DocumentBlockIndex {
  lines: string[];
  blocks: MarkdownBlock[];
  lineToBlock: Map<number, number>;
}

interface CandidateWindow {
  startBlock: number;
  endBlock: number;
  startLine: number;
  endLine: number;
  type: BlockType;
  text: string;
  headingPath: string[];
  score: number;
}

export interface AnchorContextIndex {
  source: DocumentBlockIndex;
  target: DocumentBlockIndex;
}

export interface ContextAnchorResolution {
  status: Extract<ReanchorStatus, "anchored" | "fuzzy" | "ambiguous" | "orphaned">;
  score: number;
  line?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  text?: string;
  reason: string;
}

export function createAnchorContextIndex(
  sourceLines: string[],
  targetLines: string[],
): AnchorContextIndex {
  return {
    source: createDocumentBlockIndex(sourceLines),
    target: createDocumentBlockIndex(targetLines),
  };
}

export function resolveContextAnchor(
  comment: Comment,
  index: AnchorContextIndex,
): ContextAnchorResolution | undefined {
  if (comment.line == null || !comment.selected_text) return undefined;
  const sourceBlockIndex = index.source.lineToBlock.get(comment.line);
  if (sourceBlockIndex == null) return undefined;
  const sourceBlock = index.source.blocks[sourceBlockIndex];
  const sourceText = extractText(
    index.source.lines,
    comment.line,
    comment.end_line,
    comment.start_column,
    comment.end_column,
  );
  if (sourceText !== comment.selected_text) return undefined;
  const textAtCurrentPosition = extractText(
    index.target.lines,
    comment.line,
    comment.end_line,
    comment.start_column,
    comment.end_column,
  );
  if (textAtCurrentPosition === comment.selected_text) {
    return {
      status: "anchored",
      score: 1,
      line: comment.line,
      endLine: comment.end_line ?? comment.line,
      startColumn: comment.start_column,
      endColumn: comment.end_column,
      text: comment.selected_text,
      reason: "Source-verified anchor remains exact at its stored position.",
    };
  }

  const candidates = createCandidateWindows(sourceBlock, index.target)
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(
        sourceBlock,
        sourceBlockIndex,
        candidate,
        index,
        comment.line as number,
      ),
    }))
    .filter((candidate) => candidate.score >= MATCH_THRESHOLD)
    .sort((left, right) =>
      right.score - left.score
      || Math.abs(left.startLine - (comment.line as number))
        - Math.abs(right.startLine - (comment.line as number))
    );

  const best = candidates[0];
  if (!best) {
    if (
      index.target.lines.slice(1).join("\n").includes(comment.selected_text)
    ) {
      return undefined;
    }
    return {
      status: "orphaned",
      score: 0,
      reason: "Source block has no plausible structural or contextual match.",
    };
  }

  if (candidates[1] && best.score - candidates[1].score < AMBIGUITY_MARGIN) {
    return {
      status: "ambiguous",
      score: best.score,
      line: best.startLine,
      endLine: best.endLine,
      reason:
        `Structural candidates are too close (${best.score.toFixed(3)} vs `
        + `${candidates[1].score.toFixed(3)}).`,
    };
  }

  const range = resolveCandidateRange(comment, sourceBlock, best, index.target);
  const exact = range.text === comment.selected_text;
  const repeatedExactText = exact
    && countOccurrences(
      index.target.lines.slice(1).join("\n"),
      comment.selected_text,
    ) > 1;
  return {
    status: exact && !repeatedExactText ? "anchored" : "fuzzy",
    score: exact && !repeatedExactText ? 1 : best.score,
    line: range.line,
    endLine: range.endLine,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
    text: range.text,
    reason: exact && !repeatedExactText
      ? "Markdown structure and bidirectional context disambiguate the exact anchor."
      : repeatedExactText
        ? "Markdown context selects one repeated exact anchor tentatively."
        : "Markdown structure and bidirectional context locate the edited anchor.",
  };
}

function createDocumentBlockIndex(lines: string[]): DocumentBlockIndex {
  const blocks: MarkdownBlock[] = [];
  const lineToBlock = new Map<number, number>();
  const headings: Array<{ level: number; title: string }> = [];
  let line = 1;

  while (line < lines.length) {
    if (!lines[line].trim()) {
      line += 1;
      continue;
    }

    const startLine = line;
    const marker = classifyLine(lines[line]);
    if (marker.type === "heading") {
      while (
        headings.length > 0
        && headings[headings.length - 1].level >= marker.headingLevel
      ) {
        headings.pop();
      }
      const block = makeBlock(
        lines,
        startLine,
        startLine,
        "heading",
        headings.map((heading) => heading.title),
      );
      blocks.push(block);
      headings.push({ level: marker.headingLevel, title: marker.headingTitle });
      line += 1;
      continue;
    }

    if (marker.type === "code") {
      line += 1;
      while (line < lines.length && !lines[line].trimStart().startsWith("```")) {
        line += 1;
      }
      if (line < lines.length) line += 1;
    } else {
      line += 1;
      while (
        line < lines.length
        && lines[line].trim()
        && continuesBlock(marker.type, lines[line])
      ) {
        line += 1;
      }
    }

    blocks.push(makeBlock(
      lines,
      startLine,
      line - 1,
      marker.type,
      headings.map((heading) => heading.title),
    ));
  }

  for (const [blockIndex, block] of blocks.entries()) {
    for (let blockLine = block.startLine; blockLine <= block.endLine; blockLine += 1) {
      lineToBlock.set(blockLine, blockIndex);
    }
  }

  return { lines, blocks, lineToBlock };
}

function makeBlock(
  lines: string[],
  startLine: number,
  endLine: number,
  type: BlockType,
  headingPath: string[],
): MarkdownBlock {
  return {
    startLine,
    endLine,
    type,
    text: lines.slice(startLine, endLine + 1).join("\n"),
    headingPath,
  };
}

function classifyLine(line: string): {
  type: BlockType;
  headingLevel: number;
  headingTitle: string;
} {
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    return {
      type: "heading",
      headingLevel: heading[1].length,
      headingTitle: heading[2].trim(),
    };
  }
  if (line.trimStart().startsWith("```")) {
    return { type: "code", headingLevel: 0, headingTitle: "" };
  }
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
    return { type: "list", headingLevel: 0, headingTitle: "" };
  }
  if (/^\s*\|/.test(line)) {
    return { type: "table", headingLevel: 0, headingTitle: "" };
  }
  if (/^\s*>/.test(line)) {
    return { type: "blockquote", headingLevel: 0, headingTitle: "" };
  }
  return { type: "paragraph", headingLevel: 0, headingTitle: "" };
}

function continuesBlock(type: BlockType, line: string): boolean {
  if (type === "list") return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
  if (type === "table") return /^\s*\|/.test(line);
  if (type === "blockquote") return /^\s*>/.test(line);
  if (type === "paragraph") {
    const next = classifyLine(line);
    return next.type === "paragraph";
  }
  return false;
}

function createCandidateWindows(
  sourceBlock: MarkdownBlock,
  target: DocumentBlockIndex,
): CandidateWindow[] {
  const candidates: CandidateWindow[] = [];

  for (let start = 0; start < target.blocks.length; start += 1) {
    const block = target.blocks[start];
    candidates.push(toCandidateWindow(target, start, start));

    if (
      sourceBlock.type === "paragraph"
      && block.type === "paragraph"
      && target.blocks[start + 1]?.type === "paragraph"
      && samePath(block.headingPath, target.blocks[start + 1].headingPath)
    ) {
      candidates.push(toCandidateWindow(target, start, start + 1));
    }
  }

  return candidates;
}

function toCandidateWindow(
  target: DocumentBlockIndex,
  startBlock: number,
  endBlock: number,
): CandidateWindow {
  const first = target.blocks[startBlock];
  const last = target.blocks[endBlock];
  return {
    startBlock,
    endBlock,
    startLine: first.startLine,
    endLine: last.endLine,
    type: first.type,
    text: target.lines.slice(first.startLine, last.endLine + 1).join("\n"),
    headingPath: first.headingPath,
    score: 0,
  };
}

function scoreCandidate(
  sourceBlock: MarkdownBlock,
  sourceBlockIndex: number,
  candidate: CandidateWindow,
  index: AnchorContextIndex,
  originalLine: number,
): number {
  const content = textSimilarity(sourceBlock.text, candidate.text);
  const type = sourceBlock.type === candidate.type ? 1 : 0;
  const heading = pathSimilarity(sourceBlock.headingPath, candidate.headingPath);
  const previous = neighborSimilarity(
    index.source.blocks[sourceBlockIndex - 1],
    index.target.blocks[candidate.startBlock - 1],
  );
  const next = neighborSimilarity(
    index.source.blocks[sourceBlockIndex + 1],
    index.target.blocks[candidate.endBlock + 1],
  );
  const proximity = Math.max(
    0,
    1 - Math.abs(candidate.startLine - originalLine) / 100,
  );

  return Math.min(
    1,
    content * 0.45
      + type * 0.1
      + heading * 0.1
      + previous * 0.15
      + next * 0.15
      + proximity * 0.05,
  );
}

function neighborSimilarity(
  source: MarkdownBlock | undefined,
  target: MarkdownBlock | undefined,
): number {
  if (!source || !target) return 0;
  return textSimilarity(source.text, target.text);
}

function textSimilarity(left: string, right: string): number {
  return Math.max(
    tokenDice(left, right),
    combinedScore(normalizeText(left), normalizeText(right)),
  );
}

function pathSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  return tokenDice(left.join(" "), right.join(" "));
}

function tokenDice(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const token of rightTokens) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  }
  let overlap = 0;
  for (const token of leftTokens) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      remaining.set(token, count - 1);
    }
  }
  return (2 * overlap) / (leftTokens.length + rightTokens.length);
}

function tokenize(text: string): string[] {
  return normalizeText(text).match(/[\p{L}\p{N}_-]+/gu) ?? [];
}

function normalizeText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function resolveCandidateRange(
  comment: Comment,
  sourceBlock: MarkdownBlock,
  candidate: CandidateWindow,
  target: DocumentBlockIndex,
): {
  line: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  text: string;
} {
  const exactIndex = candidate.text.indexOf(comment.selected_text as string);
  const selectedIsWholeBlock =
    comment.line === sourceBlock.startLine
    && (comment.end_line ?? comment.line) === sourceBlock.endLine
    && comment.start_column == null
    && comment.end_column == null
    && comment.selected_text === sourceBlock.text;
  const sourceOccurrenceIsUnique =
    countOccurrences(sourceBlock.text, comment.selected_text as string) === 1;
  if (exactIndex >= 0 && (selectedIsWholeBlock || sourceOccurrenceIsUnique)) {
    return exactRange(
      candidate.startLine,
      candidate.text,
      comment.selected_text as string,
      exactIndex,
    );
  }

  if (selectedIsWholeBlock) {
    return {
      line: candidate.startLine,
      endLine: candidate.endLine,
      text: candidate.text,
    };
  }

  const relativeLine = (comment.line as number) - sourceBlock.startLine;
  const line = Math.min(candidate.endLine, candidate.startLine + relativeLine);
  const lineSpan = (comment.end_line ?? comment.line as number)
    - (comment.line as number);
  const endLine = Math.min(candidate.endLine, line + lineSpan);
  const startColumn = comment.start_column;
  const endColumn = comment.end_column;
  return {
    line,
    endLine,
    startColumn,
    endColumn,
    text: extractText(
      target.lines,
      line,
      endLine,
      startColumn,
      endColumn,
    ) ?? "",
  };
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const index = text.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + 1;
  }
  return count;
}

function exactRange(
  startLine: number,
  candidateText: string,
  selectedText: string,
  index: number,
): {
  line: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  text: string;
} {
  const before = candidateText.slice(0, index).split("\n");
  const selectedLines = selectedText.split("\n");
  const line = startLine + before.length - 1;
  const startColumn = before.at(-1)?.length ?? 0;
  const finalSelectedLineLength = selectedLines.at(-1)?.length ?? 0;
  return {
    line,
    endLine: line + selectedLines.length - 1,
    startColumn,
    endColumn: selectedLines.length === 1
      ? startColumn + finalSelectedLineLength
      : finalSelectedLineLength,
    text: selectedText,
  };
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

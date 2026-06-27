import type { Node as ProsemirrorNode } from "@milkdown/prose/model";

export interface PmTextBlock {
  /** PM position of the block's first child (its content start). */
  contentStart: number;
  /** PM `textContent` of this block. */
  text: string;
  /** 0-based PM line index for this block's first line. */
  pmLineIndex: number;
  /** Whether this block has been claimed by a higher-priority match. */
  claimed: boolean;
}

export interface MatchedRange {
  /** Inclusive PM start position. */
  from: number;
  /** Exclusive PM end position. */
  to: number;
}

/**
 * Walk every textblock descendant of the doc and collect a snapshot of its
 * content + PM position. We use `descendants` (not just top-level children)
 * so paragraphs nested inside blockquotes, list items, table cells, etc. are
 * each available for individual matching — that's what scopes a highlight to
 * a single visual block instead of letting it span across siblings.
 */
export function collectPmTextBlocks(
  doc: ProsemirrorNode,
  pmLineForOffset: (offset: number) => number,
  posToOffset: readonly number[],
): PmTextBlock[] {
  const blocks: PmTextBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    if (text.length === 0) return false;
    const contentStart = pos + 1;
    const startOffset = posToOffset[contentStart] ?? posToOffset[pos] ?? 0;
    const pmLineIndex = pmLineForOffset(startOffset);
    blocks.push({ contentStart, text, pmLineIndex, claimed: false });
    return false;
  });
  return blocks;
}

/**
 * Split a comment's `selected_text` into paragraph-shaped chunks. The MRSF
 * spec stores selected_text with literal `\n\n` between paragraphs.
 */
export function splitSelectedTextIntoChunks(selectedText: string): string[] {
  return selectedText
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/^\s+|\s+$/g, ""))
    .filter((chunk) => chunk.length > 0);
}

interface ChunkMatch {
  block: PmTextBlock;
  offset: number;
  length: number;
}

/**
 * Find the best matching PM text block for a chunk. Preference order:
 *   1. Unclaimed block whose textContent contains the chunk verbatim,
 *      tiebreaking by proximity to `hintPmLine`.
 *   2. Unclaimed block whose textContent contains a long-enough prefix of
 *      the chunk (handles minor edits since the comment was authored).
 */
function findMatchingBlock(
  chunk: string,
  blocks: readonly PmTextBlock[],
  hintPmLine: number,
): ChunkMatch | null {
  const trimmed = chunk.trim();
  if (trimmed.length === 0) return null;

  let best: ChunkMatch & { distance: number } | null = null;
  for (const block of blocks) {
    if (block.claimed) continue;
    const idx = block.text.indexOf(trimmed);
    if (idx < 0) continue;
    const distance = Math.abs(block.pmLineIndex - hintPmLine);
    if (!best || distance < best.distance) {
      best = { block, offset: idx, length: trimmed.length, distance };
    }
  }
  if (best) return { block: best.block, offset: best.offset, length: best.length };

  const prefix = trimmed.slice(0, Math.min(32, trimmed.length));
  if (prefix.length < 8) return null;
  for (const block of blocks) {
    if (block.claimed) continue;
    const idx = block.text.indexOf(prefix);
    if (idx < 0) continue;
    const distance = Math.abs(block.pmLineIndex - hintPmLine);
    if (!best || distance < best.distance) {
      best = { block, offset: idx, length: Math.min(trimmed.length, block.text.length - idx), distance };
    }
  }
  return best ? { block: best.block, offset: best.offset, length: best.length } : null;
}

/**
 * Resolve a comment's `selected_text` into one or more PM ranges by matching
 * each paragraph chunk against the textContent of PM textblocks. Each chunk
 * is anchored to a single block, so the resulting ranges never span across
 * paragraph/heading/list-item boundaries — even when the original comment
 * stretched across multiple blocks.
 *
 * Mutates `blocks[*].claimed` so subsequent calls don't double-anchor on the
 * same block (useful when many comments target the same paragraph).
 *
 * Returns an empty array when no chunks could be matched. Callers may then
 * fall back to coordinate-based positioning.
 */
export function resolveSelectedTextRanges(
  selectedText: string,
  blocks: PmTextBlock[],
  hintPmLine: number,
): MatchedRange[] {
  const chunks = splitSelectedTextIntoChunks(selectedText);
  const ranges: MatchedRange[] = [];
  for (const chunk of chunks) {
    const match = findMatchingBlock(chunk, blocks, hintPmLine);
    if (!match) continue;
    match.block.claimed = true;
    const from = match.block.contentStart + match.offset;
    const to = from + match.length;
    ranges.push({ from, to });
  }
  return ranges;
}

/**
 * Locate a selected text snippet inside the original markdown source.
 *
 * The PM editor exposes selected text with single `\n` between paragraphs,
 * while the markdown source uses blank lines (`\n\n+`). Rather than try to
 * align the two coordinate spaces with line maps, we split the selected
 * text into paragraph-shaped chunks and find each chunk inside the source,
 * then derive `(line, end_line, start_column, end_column)` from those
 * matches.
 *
 * Returns `null` when the first/last chunk can't be located in source —
 * caller should fall back to its existing coordinate-based logic.
 */
export interface SourceLocation {
  /** 0-based source line index of the first matched chunk. */
  startLineIndex: number;
  /** 0-based source line index of the last matched chunk. */
  endLineIndex: number;
  /** 0-based column of the first matched chunk inside its source line. */
  startColumn: number;
  /** 0-based column AFTER the last matched chunk inside its source line. */
  endColumn: number;
}

export function locateSelectionInSource(
  selectedText: string,
  sourceText: string,
): SourceLocation | null {
  const trimmed = selectedText.replace(/^\s+|\s+$/g, "");
  if (trimmed.length === 0) return null;
  const normalizedSource = sourceText.replace(/\r\n/g, "\n");

  const offsetToLineCol = (offset: number): { line: number; column: number } => {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset; i++) {
      if (normalizedSource[i] === "\n") {
        line += 1;
        lineStart = i + 1;
      }
    }
    return { line, column: offset - lineStart };
  };

  // Fast path: the entire selection appears verbatim in source (single
  // paragraph, no inline-mark stripping difference).
  const directIdx = normalizedSource.indexOf(trimmed);
  if (directIdx >= 0) {
    const startLineCol = offsetToLineCol(directIdx);
    const endLineCol = offsetToLineCol(directIdx + trimmed.length);
    return {
      startLineIndex: startLineCol.line,
      endLineIndex: endLineCol.line,
      startColumn: startLineCol.column,
      endColumn: endLineCol.column,
    };
  }

  // Multi-paragraph fallback: split by single `\n` (PM separator) AND blank
  // lines, find first and last non-empty chunk in source.
  const chunks = trimmed
    .split(/\n+/)
    .map((c) => c.replace(/^\s+|\s+$/g, ""))
    .filter((c) => c.length >= 4);
  if (chunks.length === 0) return null;

  const firstChunkIdx = normalizedSource.indexOf(chunks[0]);
  if (firstChunkIdx < 0) return null;

  const lastChunk = chunks[chunks.length - 1];
  const lastChunkIdx = normalizedSource.indexOf(lastChunk, firstChunkIdx);
  if (lastChunkIdx < 0) return null;

  const startLineCol = offsetToLineCol(firstChunkIdx);
  const endLineCol = offsetToLineCol(lastChunkIdx + lastChunk.length);
  return {
    startLineIndex: startLineCol.line,
    endLineIndex: endLineCol.line,
    startColumn: startLineCol.column,
    endColumn: endLineCol.column,
  };
}

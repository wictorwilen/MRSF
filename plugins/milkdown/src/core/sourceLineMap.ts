import type { Node as ProsemirrorNode } from "@milkdown/prose/model";

export interface SourceLineMapBlock {
  srcStart: number;
  srcEnd: number;
  pmStart: number;
  pmEnd: number;
}

export interface SourceLineMap {
  identity: boolean;
  blocks: readonly SourceLineMapBlock[];
  srcToPm(srcLineIndex: number): number;
  pmToSrc(pmLineIndex: number): number;
}

/**
 * Identity map. Used when block counts don't align between markdown source
 * and the PM doc (e.g. exotic constructs we don't model). Falls back to the
 * pre-existing pass-through behaviour.
 */
export const IDENTITY_SOURCE_LINE_MAP: SourceLineMap = {
  identity: true,
  blocks: [],
  srcToPm: (line) => line,
  pmToSrc: (line) => line,
};

/**
 * Parse markdown source into a list of "logical blocks" — runs of non-blank
 * lines separated by blank lines, with fenced code blocks treated atomically.
 *
 * Input is a 0-based line array (matching what `splitDocumentLines` returns).
 */
export function parseSourceBlocks(srcLines: readonly string[]): SourceLineMapBlock[] {
  const blocks: SourceLineMapBlock[] = [];
  let inFence = false;
  let fenceMarker = "";
  let blockStart = -1;

  const isFenceOpen = (line: string): { ok: true; marker: string } | { ok: false } => {
    const match = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (!match) return { ok: false };
    return { ok: true, marker: match[1][0] };
  };

  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    const isBlank = line.trim() === "";

    if (inFence) {
      if (blockStart === -1) blockStart = i;
      const closes = /^\s{0,3}(```+|~~~+)\s*$/.exec(line);
      if (closes && closes[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }

    const fence = isFenceOpen(line);
    if (fence.ok) {
      if (blockStart === -1) blockStart = i;
      inFence = true;
      fenceMarker = fence.marker;
      continue;
    }

    if (isBlank) {
      if (blockStart !== -1) {
        blocks.push({ srcStart: blockStart, srcEnd: i - 1, pmStart: 0, pmEnd: 0 });
        blockStart = -1;
      }
    } else if (blockStart === -1) {
      blockStart = i;
    }
  }

  if (blockStart !== -1) {
    blocks.push({
      srcStart: blockStart,
      srcEnd: srcLines.length - 1,
      pmStart: 0,
      pmEnd: 0,
    });
  }

  return blocks;
}

/**
 * Walk the PM doc top-level children and report each one's PM-text line span
 * (inclusive, 0-based). Uses the precomputed posToOffset from the cached PM
 * text model.
 */
export function parsePmTopLevelBlocks(
  doc: ProsemirrorNode,
  posToOffset: readonly number[],
  lineStarts: readonly number[],
): Array<{ pmStart: number; pmEnd: number }> {
  const blocks: Array<{ pmStart: number; pmEnd: number }> = [];
  const totalLines = lineStarts.length;
  if (totalLines === 0) return blocks;

  const offsetToLine = (offset: number): number => {
    let low = 0;
    let high = totalLines - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const start = lineStarts[mid];
      const next = lineStarts[mid + 1] ?? Number.MAX_SAFE_INTEGER;
      if (offset < start) {
        high = mid - 1;
        continue;
      }
      if (offset >= next) {
        low = mid + 1;
        continue;
      }
      return mid;
    }
    return totalLines - 1;
  };

  let cursor = 0;
  doc.content.forEach((child, childOffset) => {
    const startPos = childOffset;
    const endPos = childOffset + child.nodeSize;
    const startOffset = posToOffset[startPos] ?? cursor;
    const endOffsetRaw = posToOffset[Math.min(endPos, posToOffset.length - 1)] ?? cursor;
    const endOffset = Math.max(startOffset, endOffsetRaw - 1);

    const pmStart = offsetToLine(startOffset);
    const pmEnd = offsetToLine(endOffset);
    blocks.push({ pmStart, pmEnd });
    cursor = endOffset;
  });

  return blocks;
}

/**
 * Build a bidirectional line-number mapping between the markdown source
 * (which contains blank lines between blocks plus markup like `# `, `> `)
 * and the PM text model (which strips block markup and uses single-newline
 * separators between sibling blocks).
 *
 * The map is per-block-aligned: each markdown source block (run of non-blank
 * lines, code fences atomic) is paired with the corresponding PM top-level
 * block by index. Within a paired block, line offsets are linearly mapped.
 *
 * If the block counts don't match (loose lists, exotic markup, etc.) we
 * fall back to identity mapping so callers see no worse than today's
 * behaviour.
 */
export function buildSourceLineMap(
  srcLines: readonly string[],
  doc: ProsemirrorNode,
  posToOffset: readonly number[],
  lineStarts: readonly number[],
): SourceLineMap {
  const srcBlocks = parseSourceBlocks(srcLines);
  const pmBlocks = parsePmTopLevelBlocks(doc, posToOffset, lineStarts);

  if (srcBlocks.length === 0 || pmBlocks.length === 0) {
    return IDENTITY_SOURCE_LINE_MAP;
  }

  if (srcBlocks.length !== pmBlocks.length) {
    return IDENTITY_SOURCE_LINE_MAP;
  }

  const blocks: SourceLineMapBlock[] = srcBlocks.map((srcBlock, i) => ({
    srcStart: srcBlock.srcStart,
    srcEnd: srcBlock.srcEnd,
    pmStart: pmBlocks[i].pmStart,
    pmEnd: pmBlocks[i].pmEnd,
  }));

  // Sanity: blocks should be non-decreasing on both axes.
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].srcStart < blocks[i - 1].srcEnd || blocks[i].pmStart < blocks[i - 1].pmEnd) {
      // Out of order — bail to identity rather than producing wrong mappings.
      return IDENTITY_SOURCE_LINE_MAP;
    }
  }

  const findSrcBlockIndex = (srcLine: number): number => {
    // Find block containing srcLine, or the nearest block (snap to gap).
    let low = 0;
    let high = blocks.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const block = blocks[mid];
      if (srcLine < block.srcStart) {
        high = mid - 1;
        continue;
      }
      if (srcLine > block.srcEnd) {
        low = mid + 1;
        continue;
      }
      return mid;
    }
    // srcLine is in a gap between blocks; pick whichever block boundary is closer.
    if (high < 0) return 0;
    if (low >= blocks.length) return blocks.length - 1;
    const distToPrev = srcLine - blocks[high].srcEnd;
    const distToNext = blocks[low].srcStart - srcLine;
    return distToPrev <= distToNext ? high : low;
  };

  const findPmBlockIndex = (pmLine: number): number => {
    let low = 0;
    let high = blocks.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const block = blocks[mid];
      if (pmLine < block.pmStart) {
        high = mid - 1;
        continue;
      }
      if (pmLine > block.pmEnd) {
        low = mid + 1;
        continue;
      }
      return mid;
    }
    if (high < 0) return 0;
    if (low >= blocks.length) return blocks.length - 1;
    const distToPrev = pmLine - blocks[high].pmEnd;
    const distToNext = blocks[low].pmStart - pmLine;
    return distToPrev <= distToNext ? high : low;
  };

  return {
    identity: false,
    blocks,
    srcToPm(srcLine: number): number {
      if (srcLine <= blocks[0].srcStart) {
        return Math.max(0, blocks[0].pmStart + (srcLine - blocks[0].srcStart));
      }
      const last = blocks[blocks.length - 1];
      if (srcLine >= last.srcEnd) {
        return last.pmEnd + (srcLine - last.srcEnd);
      }
      const idx = findSrcBlockIndex(srcLine);
      const block = blocks[idx];
      const blockSrcLen = block.srcEnd - block.srcStart;
      const blockPmLen = block.pmEnd - block.pmStart;

      if (srcLine >= block.srcStart && srcLine <= block.srcEnd) {
        if (blockSrcLen === 0) return block.pmStart;
        const ratio = (srcLine - block.srcStart) / blockSrcLen;
        return block.pmStart + Math.round(ratio * blockPmLen);
      }
      // Gap between blocks: snap to the chosen block's nearest edge.
      if (srcLine < block.srcStart) {
        return block.pmStart;
      }
      return block.pmEnd;
    },
    pmToSrc(pmLine: number): number {
      if (pmLine <= blocks[0].pmStart) {
        return Math.max(0, blocks[0].srcStart + (pmLine - blocks[0].pmStart));
      }
      const last = blocks[blocks.length - 1];
      if (pmLine >= last.pmEnd) {
        return last.srcEnd + (pmLine - last.pmEnd);
      }
      const idx = findPmBlockIndex(pmLine);
      const block = blocks[idx];
      const blockSrcLen = block.srcEnd - block.srcStart;
      const blockPmLen = block.pmEnd - block.pmStart;

      if (pmLine >= block.pmStart && pmLine <= block.pmEnd) {
        if (blockPmLen === 0) return block.srcStart;
        const ratio = (pmLine - block.pmStart) / blockPmLen;
        return block.srcStart + Math.round(ratio * blockSrcLen);
      }
      if (pmLine < block.pmStart) {
        return block.srcStart;
      }
      return block.srcEnd;
    },
  };
}

const MAP_CACHE = new WeakMap<ProsemirrorNode, { srcText: string; map: SourceLineMap }>();

/**
 * Cache the SourceLineMap per (PM doc, source text). The doc is the cache
 * key; we re-derive when the source text the caller is comparing against
 * changes (which happens after `host.getDocumentText` is re-read).
 */
export function getCachedSourceLineMap(
  doc: ProsemirrorNode,
  srcText: string,
  posToOffset: readonly number[],
  lineStarts: readonly number[],
): SourceLineMap {
  const cached = MAP_CACHE.get(doc);
  if (cached && cached.srcText === srcText) {
    return cached.map;
  }
  const srcLines = srcText.replace(/\r\n/g, "\n").split("\n");
  const map = buildSourceLineMap(srcLines, doc, posToOffset, lineStarts);
  MAP_CACHE.set(doc, { srcText, map });
  return map;
}

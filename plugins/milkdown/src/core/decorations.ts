import type { Node as ProsemirrorNode } from "@milkdown/prose/model";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { DecorationSnapshot, EditorPoint, InlineDecorationSnapshot } from "../types.js";
import { IDENTITY_SOURCE_LINE_MAP, type SourceLineMap, getCachedSourceLineMap } from "./sourceLineMap.js";
import { collectPmTextBlocks, resolveSelectedTextRanges } from "./textMatch.js";
import { getProsemirrorTextModel, pointToOffset, textOffsetToPmPos } from "./textModel.js";

export interface MilkdownDecorationOptions {
  inlineHighlights?: boolean;
  /**
   * The original markdown source text. Used to map markdown source line
   * numbers (the spec coordinate system stored in comments) to PM-text-model
   * line indices for decoration rendering. When omitted we fall back to an
   * identity mapping (the legacy, often-wrong behaviour).
   */
  sourceText?: string;
}

export function buildInlineDecorations(
  doc: ProsemirrorNode,
  snapshot: DecorationSnapshot | null,
  text: string,
  options: MilkdownDecorationOptions = {},
): DecorationSet {
  if (!snapshot) {
    return DecorationSet.empty;
  }

  if ((options.inlineHighlights ?? true) === false || snapshot.inlineRanges.length === 0) {
    return DecorationSet.empty;
  }

  const model = getProsemirrorTextModel(doc);
  const effectiveText = model.text;
  const lineStarts = model.lineStarts;
  const posToOffset = model.posToOffset;
  const decorations: Decoration[] = [];

  const sourceLineMap: SourceLineMap = options.sourceText != null
    ? getCachedSourceLineMap(doc, options.sourceText, posToOffset, lineStarts)
    : IDENTITY_SOURCE_LINE_MAP;

  const totalLines = lineStarts.length;
  const offsetToLine = (offset: number): number => {
    let low = 0;
    let high = totalLines - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const start = lineStarts[mid];
      const next = lineStarts[mid + 1] ?? Number.MAX_SAFE_INTEGER;
      if (offset < start) { high = mid - 1; continue; }
      if (offset >= next) { low = mid + 1; continue; }
      return mid;
    }
    return Math.max(0, totalLines - 1);
  };

  const pmTextBlocks = collectPmTextBlocks(doc, offsetToLine, posToOffset);

  const pushDecoration = (from: number, to: number, commentId: string, resolved: boolean): void => {
    if (to <= from) return;
    decorations.push(
      Decoration.inline(from, to, {
        class: "mrsf-inline-highlight",
        "data-mrsf-comment-id": commentId,
        "data-mrsf-resolved": String(resolved),
      }),
    );
  };

  const translatePoint = (point: EditorPoint): EditorPoint => {
    if (sourceLineMap.identity) return point;
    return { lineIndex: sourceLineMap.srcToPm(point.lineIndex), column: point.column };
  };

  /**
   * Fallback line-based decoration. Only used when selectedText is unavailable
   * or didn't match any PM block (e.g. heavily edited paragraph).
   */
  const fallbackLineDecoration = (inlineRange: InlineDecorationSnapshot): void => {
    const translatedStart = translatePoint(inlineRange.range.start);
    const translatedEnd = translatePoint(inlineRange.range.end);
    const startLine = translatedStart.lineIndex;
    const endLine = translatedEnd.lineIndex;

    const emit = (start: EditorPoint, end: EditorPoint): void => {
      const startOffset = pointToOffset(start, effectiveText, lineStarts);
      const endOffset = pointToOffset(end, effectiveText, lineStarts);
      if (endOffset <= startOffset) return;
      const from = textOffsetToPmPos(doc, startOffset);
      const to = textOffsetToPmPos(doc, endOffset);
      pushDecoration(from, to, inlineRange.commentId, inlineRange.resolved);
    };

    if (startLine === endLine) {
      emit(translatedStart, translatedEnd);
      return;
    }
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      if (lineIndex < 0 || lineIndex >= totalLines) continue;
      const lineStart = lineStarts[lineIndex];
      const nextLineStart = lineStarts[lineIndex + 1];
      const lineLength = nextLineStart != null
        ? Math.max(0, nextLineStart - lineStart - 1)
        : Math.max(0, effectiveText.length - lineStart);
      if (lineLength === 0) continue;
      const start: EditorPoint = lineIndex === startLine ? translatedStart : { lineIndex, column: 0 };
      const end: EditorPoint = lineIndex === endLine ? translatedEnd : { lineIndex, column: lineLength };
      emit(start, end);
    }
  };

  for (const inlineRange of snapshot.inlineRanges) {
    // Primary path: match selected_text against PM block textContent. This
    // is robust to coordinate-system differences (markdown source vs PM text)
    // and naturally scopes each decoration to a single block.
    const selectedText = inlineRange.selectedText;
    if (selectedText && selectedText.length > 0) {
      const hintPmLine = sourceLineMap.identity
        ? inlineRange.range.start.lineIndex
        : sourceLineMap.srcToPm(inlineRange.range.start.lineIndex);
      const ranges = resolveSelectedTextRanges(selectedText, pmTextBlocks, hintPmLine);
      if (ranges.length > 0) {
        for (const range of ranges) {
          pushDecoration(range.from, range.to, inlineRange.commentId, inlineRange.resolved);
        }
        continue;
      }
    }

    fallbackLineDecoration(inlineRange);
  }

  void text;

  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}
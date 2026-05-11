import type { Node as ProsemirrorNode } from "@milkdown/prose/model";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { DecorationSnapshot, EditorPoint } from "../types.js";
import { getProsemirrorTextModel, pointToOffset, textOffsetToPmPos } from "./textModel.js";

export interface MilkdownDecorationOptions {
  inlineHighlights?: boolean;
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

  // Use the cached PM text model — this is the same `text` that `getDocumentText`
  // returned for this `doc`, so we can grab the precomputed lineStarts and
  // posToOffset arrays without rewalking the tree per call.
  const model = getProsemirrorTextModel(doc);
  const effectiveText = model.text;
  const lineStarts = model.lineStarts;
  const decorations: Decoration[] = [];

  // We split each inline range into one decoration per PM text line. This
  // both avoids spanning block boundaries (which can render as stray empty
  // boxes on blank lines/paragraph gaps) and keeps each individual decoration
  // cheap for ProseMirror to map through transactions.
  const pushLineDecoration = (
    start: EditorPoint,
    end: EditorPoint,
    commentId: string,
    resolved: boolean,
  ): void => {
    const startOffset = pointToOffset(start, effectiveText, lineStarts);
    const endOffset = pointToOffset(end, effectiveText, lineStarts);
    if (endOffset <= startOffset) {
      return;
    }

    const from = textOffsetToPmPos(doc, startOffset);
    const to = textOffsetToPmPos(doc, endOffset);
    if (to <= from) {
      return;
    }

    decorations.push(
      Decoration.inline(from, to, {
        class: "mrsf-inline-highlight",
        "data-mrsf-comment-id": commentId,
        "data-mrsf-resolved": String(resolved),
      }),
    );
  };

  for (const inlineRange of snapshot.inlineRanges) {
    const startLine = inlineRange.range.start.lineIndex;
    const endLine = inlineRange.range.end.lineIndex;

    if (startLine === endLine) {
      pushLineDecoration(
        inlineRange.range.start,
        inlineRange.range.end,
        inlineRange.commentId,
        inlineRange.resolved,
      );
      continue;
    }

    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      // Skip lines that are out of bounds for the PM text — these would
      // otherwise clamp to a stray byte at the document edge and render as
      // a tiny block-boundary decoration.
      if (lineIndex < 0 || lineIndex >= lineStarts.length) {
        continue;
      }

      const lineStart = lineStarts[lineIndex];
      const nextLineStart = lineStarts[lineIndex + 1];
      const lineLength = nextLineStart != null
        ? Math.max(0, nextLineStart - lineStart - 1)
        : Math.max(0, effectiveText.length - lineStart);

      // Empty PM line: skip entirely so we never produce a 0/1-char decoration
      // floating in the empty paragraph gap.
      if (lineLength === 0) {
        continue;
      }

      const start: EditorPoint = lineIndex === startLine
        ? inlineRange.range.start
        : { lineIndex, column: 0 };
      const end: EditorPoint = lineIndex === endLine
        ? inlineRange.range.end
        : { lineIndex, column: lineLength };

      pushLineDecoration(start, end, inlineRange.commentId, inlineRange.resolved);
    }
  }

  // `effectiveText` parameter is intentionally accepted by callers but the
  // canonical text comes from the cached model; keep the parameter to retain
  // backwards-compatible signature.
  void text;

  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}
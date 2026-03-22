import type { Node as ProsemirrorNode } from "@milkdown/prose/model";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { DecorationSnapshot } from "../types.js";
import { pointToOffset, textOffsetToPmPos } from "./textModel.js";

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

  const decorations = snapshot.inlineRanges.flatMap((inlineRange) => {
    const startOffset = pointToOffset(inlineRange.range.start, text);
    const endOffset = pointToOffset(inlineRange.range.end, text);
    if (endOffset <= startOffset) {
      return [];
    }

    const from = textOffsetToPmPos(doc, startOffset);
    const to = textOffsetToPmPos(doc, endOffset);
    if (to <= from) {
      return [];
    }

    return [
      Decoration.inline(from, to, {
        class: "mrsf-inline-highlight",
        "data-mrsf-comment-id": inlineRange.commentId,
        "data-mrsf-resolved": String(inlineRange.resolved),
      }),
    ];
  });

  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}
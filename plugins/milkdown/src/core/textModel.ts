import type { Node as ProsemirrorNode } from "@milkdown/prose/model";
import type { EditorState, Selection } from "@milkdown/prose/state";
import type { DocumentGeometry, EditorContentChange, EditorPoint, EditorRange, EditorSelection } from "../types.js";
import { normalizeRange } from "./positions.js";

interface ProsemirrorTextModel {
  text: string;
  posToOffset: number[];
}

function isTableContainer(node: ProsemirrorNode): boolean {
  return node.type.name === "table";
}

function isTableRow(node: ProsemirrorNode): boolean {
  return node.type.name === "tableRow";
}

function separatorBetweenSiblings(parent: ProsemirrorNode, previous: ProsemirrorNode, next: ProsemirrorNode): string {
  if (isTableRow(parent)) {
    return "\t";
  }

  if (isTableContainer(parent)) {
    return "\n";
  }

  if (previous.isBlock && next.isBlock) {
    return "\n";
  }

  return "";
}

function createProsemirrorTextModel(doc: ProsemirrorNode): ProsemirrorTextModel {
  const maxPos = doc.content.size;
  const posToOffset = new Array<number>(maxPos + 1);
  const parts: string[] = [];
  let offset = 0;

  const markPos = (pos: number): void => {
    const clamped = Math.max(0, Math.min(pos, maxPos));
    posToOffset[clamped] = offset;
  };

  const append = (text: string): void => {
    if (!text) {
      return;
    }
    parts.push(text);
    offset += text.length;
  };

  const walk = (node: ProsemirrorNode, pos: number, isTopLevel = false): void => {
    if (node.isText) {
      const text = node.text ?? "";
      for (let index = 0; index <= text.length; index += 1) {
        const currentPos = Math.min(maxPos, pos + index);
        posToOffset[currentPos] = offset + index;
      }
      append(text);
      return;
    }

    const contentStart = isTopLevel ? 0 : Math.min(maxPos, pos + 1);
    markPos(pos);
    markPos(contentStart);

    if (node.isLeaf || node.childCount === 0) {
      const endPos = isTopLevel ? maxPos : Math.min(maxPos, pos + node.nodeSize);
      markPos(endPos);
      return;
    }

    let previousChild: ProsemirrorNode | null = null;
    node.forEach((child, childOffset) => {
      const childPos = isTopLevel ? childOffset : pos + 1 + childOffset;
      if (previousChild) {
        append(separatorBetweenSiblings(node, previousChild, child));
      }
      markPos(childPos);
      walk(child, childPos, false);
      previousChild = child;
    });

    const contentEnd = isTopLevel ? maxPos : Math.min(maxPos, pos + node.nodeSize - 1);
    const endPos = isTopLevel ? maxPos : Math.min(maxPos, pos + node.nodeSize);
    markPos(contentEnd);
    markPos(endPos);
  };

  walk(doc, 0, true);

  let lastSeen = 0;
  for (let pos = 0; pos <= maxPos; pos += 1) {
    const current = posToOffset[pos];
    if (current == null) {
      posToOffset[pos] = lastSeen;
      continue;
    }
    lastSeen = current;
  }

  return {
    text: parts.join(""),
    posToOffset,
  };
}

export function getDocumentText(doc: ProsemirrorNode): string {
  return createProsemirrorTextModel(doc).text;
}

export function createLineIndex(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function geometryFromText(text: string): DocumentGeometry {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return {
    lineCount: lines.length,
    getLineLength: (lineIndex: number) => lines[lineIndex]?.length ?? 0,
  };
}

export function offsetToPoint(offset: number, text: string): EditorPoint {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const starts = createLineIndex(text);

  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const current = starts[mid];
    const next = starts[mid + 1] ?? Number.MAX_SAFE_INTEGER;
    if (clamped < current) {
      high = mid - 1;
      continue;
    }
    if (clamped >= next) {
      low = mid + 1;
      continue;
    }
    return { lineIndex: mid, column: clamped - current };
  }

  const lastLine = starts.length - 1;
  return { lineIndex: lastLine, column: clamped - starts[lastLine] };
}

export function pointToOffset(point: EditorPoint, text: string): number {
  const starts = createLineIndex(text);
  const lineIndex = Math.max(0, Math.min(point.lineIndex, starts.length - 1));
  const lineStart = starts[lineIndex];
  const lineEnd = starts[lineIndex + 1] != null ? starts[lineIndex + 1] - 1 : text.length;
  return Math.min(lineStart + Math.max(0, point.column), lineEnd);
}

export function diffTextChange(before: string, after: string): EditorContentChange[] {
  if (before === after) {
    return [];
  }

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;

  return [{
    range: {
      start: offsetToPoint(prefix, before),
      end: offsetToPoint(beforeEnd, before),
    },
    text: after.slice(prefix, afterEnd),
  }];
}

export function pmPosToTextOffset(doc: ProsemirrorNode, pos: number): number {
  const model = createProsemirrorTextModel(doc);
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  return model.posToOffset[clamped] ?? model.text.length;
}

export function textOffsetToPmPos(doc: ProsemirrorNode, targetOffset: number): number {
  const model = createProsemirrorTextModel(doc);
  const maxPos = doc.content.size;
  const clampedOffset = Math.max(0, Math.min(targetOffset, model.text.length));
  let low = 0;
  let high = maxPos;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = model.posToOffset[mid] ?? model.text.length;
    if (value <= clampedOffset) {
      best = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  return best;
}

export function selectionToEditorSelection(selection: Selection, doc: ProsemirrorNode): EditorSelection {
  const text = getDocumentText(doc);
  const startOffset = pmPosToTextOffset(doc, selection.from);
  const endOffset = pmPosToTextOffset(doc, selection.to);
  return normalizeRange({
    start: offsetToPoint(startOffset, text),
    end: offsetToPoint(endOffset, text),
  });
}

export function getSelectedText(state: EditorState): string {
  const { selection, doc } = state;
  if (selection.empty) {
    return "";
  }

  const model = createProsemirrorTextModel(doc);
  const startOffset = pmPosToTextOffset(doc, selection.from);
  const endOffset = pmPosToTextOffset(doc, selection.to);
  return model.text.slice(startOffset, endOffset);
}

export function rangeFromOffsets(startOffset: number, endOffset: number, text: string): EditorRange {
  return normalizeRange({
    start: offsetToPoint(startOffset, text),
    end: offsetToPoint(endOffset, text),
  });
}
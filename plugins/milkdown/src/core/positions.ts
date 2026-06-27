import type { Comment } from "@mrsf/cli/browser";
import type { AnchorFields, DocumentGeometry, EditorPoint, EditorRange, EditorSelection } from "../types.js";

export function comparePoints(left: EditorPoint, right: EditorPoint): number {
  if (left.lineIndex !== right.lineIndex) {
    return left.lineIndex - right.lineIndex;
  }
  return left.column - right.column;
}

export function normalizeRange(range: EditorRange): EditorRange {
  if (comparePoints(range.start, range.end) <= 0) {
    return range;
  }

  return {
    start: range.end,
    end: range.start,
  };
}

export function commentToEditorRange(comment: Comment, geometry?: DocumentGeometry): EditorRange | undefined {
  if (comment.line == null) {
    return undefined;
  }

  const startLine = comment.line - 1;
  if (startLine < 0) return undefined;
  if (geometry && startLine >= geometry.lineCount) return undefined;

  if (comment.start_column != null && comment.end_column != null) {
    const endLineRaw = comment.end_line != null ? comment.end_line - 1 : startLine;
    const endLine = geometry
      ? Math.min(Math.max(endLineRaw, startLine), geometry.lineCount - 1)
      : Math.max(endLineRaw, startLine);

    return {
      start: { lineIndex: startLine, column: comment.start_column },
      end: { lineIndex: endLine, column: comment.end_column },
    };
  }

  if (comment.end_line != null) {
    const endLineRaw = comment.end_line - 1;
    const endLine = geometry
      ? Math.min(Math.max(endLineRaw, startLine), geometry.lineCount - 1)
      : Math.max(endLineRaw, startLine);
    const endColumn = geometry ? geometry.getLineLength(endLine) : Number.MAX_SAFE_INTEGER;

    return {
      start: { lineIndex: startLine, column: 0 },
      end: { lineIndex: endLine, column: endColumn },
    };
  }

  const endColumn = geometry ? geometry.getLineLength(startLine) : Number.MAX_SAFE_INTEGER;

  return {
    start: { lineIndex: startLine, column: 0 },
    end: { lineIndex: startLine, column: endColumn },
  };
}

export function selectionToAnchor(selection: EditorSelection): AnchorFields {
  const normalized = normalizeRange(selection);
  const start = normalized.start;
  const end = normalized.end;
  const line = start.lineIndex + 1;

  if (start.lineIndex === end.lineIndex && start.column === end.column) {
    return { line };
  }

  const anchor: AnchorFields = {
    line,
    start_column: start.column,
    end_column: end.column,
  };

  if (start.lineIndex !== end.lineIndex) {
    anchor.end_line = end.lineIndex + 1;
  }

  return anchor;
}

export function isInlineComment(comment: Comment): boolean {
  return comment.start_column != null && comment.end_column != null;
}

export function isDocumentLevelComment(comment: Comment): boolean {
  return comment.line == null && comment.selected_text == null;
}

/**
 * Returns true when a comment that nominally has columns (i.e. `isInlineComment`
 * is true) actually spans multiple full lines — start at column 0 of the first
 * line and end at or past the end of the final selected line. Such selections
 * are visually line/paragraph comments and should NOT be rendered with the
 * yellow inline highlight; only the line and gutter treatments apply.
 *
 * Single-line selections are always considered inline, even if their
 * start_column/end_column happen to coincide with the line's bounds — the
 * reviewer is highlighting specific text within that line.
 *
 * Without geometry we cannot tell, so we are conservative and return false
 * (keep inline highlighting).
 */
export function isWholeLineSelection(comment: Comment, geometry?: DocumentGeometry): boolean {
  if (!isInlineComment(comment)) return false;
  if (comment.start_column !== 0) return false;
  if (comment.line == null) return false;
  if (!geometry) return false;

  const startLineIndex = comment.line - 1;
  const endLineIndex = (comment.end_line ?? comment.line) - 1;
  if (startLineIndex === endLineIndex) return false;
  if (startLineIndex < 0 || endLineIndex < 0) return false;
  if (startLineIndex >= geometry.lineCount || endLineIndex >= geometry.lineCount) return false;
  if (startLineIndex > endLineIndex) return false;

  const endLineLength = geometry.getLineLength(endLineIndex);
  return (comment.end_column ?? 0) >= endLineLength;
}
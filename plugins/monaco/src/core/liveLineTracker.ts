import type { Comment } from "@mrsf/cli/browser";
import type { EditorContentChange } from "../types.js";

interface EditorPoint {
  lineIndex: number;
  column: number;
}

function comparePoints(left: EditorPoint, right: EditorPoint): number {
  if (left.lineIndex !== right.lineIndex) {
    return left.lineIndex - right.lineIndex;
  }

  return left.column - right.column;
}

function insertedEndPoint(change: EditorContentChange): EditorPoint {
  const segments = change.text.split("\n");
  if (segments.length === 1) {
    return {
      lineIndex: change.range.start.lineIndex,
      column: change.range.start.column + segments[0].length,
    };
  }

  return {
    lineIndex: change.range.start.lineIndex + segments.length - 1,
    column: segments[segments.length - 1]?.length ?? 0,
  };
}

function transformPoint(
  point: EditorPoint,
  change: EditorContentChange,
  affinity: "start" | "end",
): EditorPoint {
  const start = change.range.start;
  const end = change.range.end;
  const replacementEnd = insertedEndPoint(change);

  if (comparePoints(point, start) < 0) {
    return point;
  }

  if (comparePoints(point, end) > 0) {
    if (point.lineIndex === end.lineIndex) {
      return {
        lineIndex: replacementEnd.lineIndex,
        column: replacementEnd.column + (point.column - end.column),
      };
    }

    return {
      lineIndex: replacementEnd.lineIndex + (point.lineIndex - end.lineIndex),
      column: point.column,
    };
  }

  return affinity === "start"
    ? { ...start }
    : { ...replacementEnd };
}

function updateInlineComment(comment: Comment, change: EditorContentChange): boolean {
  if (comment.line == null || comment.start_column == null || comment.end_column == null) {
    return false;
  }

  const startPoint = {
    lineIndex: comment.line - 1,
    column: comment.start_column,
  };
  const endPoint = {
    lineIndex: (comment.end_line ?? comment.line) - 1,
    column: comment.end_column,
  };

  const nextStart = transformPoint(startPoint, change, "start");
  const nextEnd = transformPoint(endPoint, change, "end");
  const moved = nextStart.lineIndex !== startPoint.lineIndex
    || nextStart.column !== startPoint.column
    || nextEnd.lineIndex !== endPoint.lineIndex
    || nextEnd.column !== endPoint.column;

  if (!moved) {
    return false;
  }

  comment.line = Math.max(1, nextStart.lineIndex + 1);
  comment.start_column = Math.max(0, nextStart.column);
  comment.end_line = nextEnd.lineIndex === nextStart.lineIndex
    ? undefined
    : Math.max(1, nextEnd.lineIndex + 1);
  comment.end_column = Math.max(0, nextEnd.column);
  return true;
}

export function applyLineShifts(
  comments: Comment[],
  changes: readonly EditorContentChange[],
): boolean {
  let anyMoved = false;

  const sorted = [...changes].sort((left, right) => {
    if (left.range.start.lineIndex !== right.range.start.lineIndex) {
      return right.range.start.lineIndex - left.range.start.lineIndex;
    }

    return right.range.start.column - left.range.start.column;
  });

  for (const change of sorted) {
    for (const comment of comments) {
      if (comment.reply_to) continue;
      if (comment.line == null) continue;

      if (comment.start_column != null && comment.end_column != null) {
        if (updateInlineComment(comment, change)) {
          anyMoved = true;
        }
        continue;
      }

      const startPoint = { lineIndex: comment.line - 1, column: 0 };
      const endPoint = { lineIndex: (comment.end_line ?? comment.line) - 1, column: 0 };
      const nextStart = transformPoint(startPoint, change, "start");
      const nextEnd = transformPoint(endPoint, change, "end");

      if (
        nextStart.lineIndex !== startPoint.lineIndex
        || nextEnd.lineIndex !== endPoint.lineIndex
      ) {
        comment.line = Math.max(1, nextStart.lineIndex + 1);
        comment.end_line = comment.end_line != null || nextEnd.lineIndex !== nextStart.lineIndex
          ? Math.max(1, nextEnd.lineIndex + 1)
          : undefined;
        anyMoved = true;
      }
    }
  }

  return anyMoved;
}
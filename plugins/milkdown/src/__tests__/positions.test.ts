import { describe, expect, it } from "vitest";
import type { Comment } from "@mrsf/cli/browser";
import {
  commentToEditorRange,
  comparePoints,
  isDocumentLevelComment,
  isInlineComment,
  normalizeRange,
  selectionToAnchor,
} from "../core/positions.js";

const geometry = {
  lineCount: 3,
  getLineLength: (lineIndex: number) => [5, 4, 5][lineIndex] ?? 0,
};

describe("positions", () => {
  it("compares points and normalizes ranges", () => {
    expect(comparePoints({ lineIndex: 0, column: 1 }, { lineIndex: 0, column: 4 })).toBeLessThan(0);
    expect(comparePoints({ lineIndex: 2, column: 0 }, { lineIndex: 1, column: 9 })).toBeGreaterThan(0);
    expect(normalizeRange({
      start: { lineIndex: 2, column: 4 },
      end: { lineIndex: 1, column: 2 },
    })).toEqual({
      start: { lineIndex: 1, column: 2 },
      end: { lineIndex: 2, column: 4 },
    });
  });

  it("converts comments to editor ranges across inline, line, and multiline anchors", () => {
    const inline = {
      id: "c1",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Inline",
      resolved: false,
      line: 2,
      start_column: 1,
      end_column: 3,
    } satisfies Comment;
    expect(commentToEditorRange(inline, geometry)).toEqual({
      start: { lineIndex: 1, column: 1 },
      end: { lineIndex: 1, column: 3 },
    });

    const multiline = {
      ...inline,
      end_line: 3,
      end_column: 2,
    } satisfies Comment;
    expect(commentToEditorRange(multiline, geometry)).toEqual({
      start: { lineIndex: 1, column: 1 },
      end: { lineIndex: 2, column: 2 },
    });

    const lineLevel = {
      ...inline,
      start_column: undefined,
      end_column: undefined,
      end_line: undefined,
    } satisfies Comment;
    expect(commentToEditorRange(lineLevel, geometry)).toEqual({
      start: { lineIndex: 1, column: 0 },
      end: { lineIndex: 1, column: 4 },
    });

    const lineSpan = {
      ...lineLevel,
      end_line: 4,
    } satisfies Comment;
    expect(commentToEditorRange(lineSpan, geometry)).toEqual({
      start: { lineIndex: 1, column: 0 },
      end: { lineIndex: 2, column: 5 },
    });

    expect(commentToEditorRange({ ...inline, line: undefined } satisfies Comment, geometry)).toBeUndefined();
    expect(commentToEditorRange({ ...inline, line: 0 } satisfies Comment, geometry)).toBeUndefined();
    expect(commentToEditorRange({ ...inline, line: 10 } satisfies Comment, geometry)).toBeUndefined();
  });

  it("converts selections to anchors and detects inline and document-level comments", () => {
    expect(selectionToAnchor({
      start: { lineIndex: 1, column: 4 },
      end: { lineIndex: 1, column: 4 },
    })).toEqual({ line: 2 });

    expect(selectionToAnchor({
      start: { lineIndex: 2, column: 3 },
      end: { lineIndex: 1, column: 1 },
    })).toEqual({
      line: 2,
      end_line: 3,
      start_column: 1,
      end_column: 3,
    });

    const inline = {
      id: "inline",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Inline",
      resolved: false,
      line: 1,
      start_column: 0,
      end_column: 2,
    } satisfies Comment;
    const documentLevel = {
      id: "doc",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Doc",
      resolved: false,
    } satisfies Comment;

    expect(isInlineComment(inline)).toBe(true);
    expect(isInlineComment(documentLevel)).toBe(false);
    expect(isDocumentLevelComment(documentLevel)).toBe(true);
    expect(isDocumentLevelComment({ ...documentLevel, selected_text: "alpha" } satisfies Comment)).toBe(false);
  });
});
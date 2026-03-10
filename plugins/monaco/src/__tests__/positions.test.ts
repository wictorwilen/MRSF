import { describe, expect, it } from "vitest";
import type { Comment } from "@mrsf/cli";
import {
  commentToEditorRange,
  normalizeRange,
  selectionToAnchor,
} from "../core/positions.js";

function makeComment(overrides: Partial<Comment>): Comment {
  return {
    id: "c1",
    text: "Comment",
    ...overrides,
  } as Comment;
}

describe("positions", () => {
  it("normalizes reversed ranges", () => {
    expect(
      normalizeRange({
        start: { lineIndex: 3, column: 8 },
        end: { lineIndex: 2, column: 4 },
      }),
    ).toEqual({
      start: { lineIndex: 2, column: 4 },
      end: { lineIndex: 3, column: 8 },
    });
  });

  it("maps inline comments to precise ranges", () => {
    const geometry = {
      lineCount: 3,
      getLineLength: (lineIndex: number) => [10, 20, 30][lineIndex] ?? 0,
    };

    expect(
      commentToEditorRange(
        makeComment({
          line: 2,
          start_column: 3,
          end_column: 9,
        }),
        geometry,
      ),
    ).toEqual({
      start: { lineIndex: 1, column: 3 },
      end: { lineIndex: 1, column: 9 },
    });
  });

  it("maps line comments to whole-line ranges", () => {
    const geometry = {
      lineCount: 2,
      getLineLength: (lineIndex: number) => [12, 18][lineIndex] ?? 0,
    };

    expect(
      commentToEditorRange(
        makeComment({
          line: 2,
        }),
        geometry,
      ),
    ).toEqual({
      start: { lineIndex: 1, column: 0 },
      end: { lineIndex: 1, column: 18 },
    });
  });

  it("preserves blank-edge multi-line ranges", () => {
    const geometry = {
      lineCount: 9,
      getLineLength: (lineIndex: number) =>
        [4, 4, 4, 4, 4, 4, 0, 9, 0][lineIndex] ?? 0,
    };

    expect(
      commentToEditorRange(
        makeComment({
          line: 7,
          end_line: 9,
          selected_text: "\ntext text\n",
        }),
        geometry,
      ),
    ).toEqual({
      start: { lineIndex: 6, column: 0 },
      end: { lineIndex: 8, column: 0 },
    });
  });

  it("converts a cursor selection into a line anchor", () => {
    expect(
      selectionToAnchor({
        start: { lineIndex: 4, column: 2 },
        end: { lineIndex: 4, column: 2 },
      }),
    ).toEqual({ line: 5 });
  });

  it("normalizes reversed multi-line selections into anchor fields", () => {
    expect(
      selectionToAnchor({
        start: { lineIndex: 7, column: 12 },
        end: { lineIndex: 5, column: 3 },
      }),
    ).toEqual({
      line: 6,
      end_line: 8,
      start_column: 3,
      end_column: 12,
    });
  });
});
import { describe, expect, it } from "vitest";
import type { Comment } from "@mrsf/cli";
import { applyLineShifts } from "../core/liveLineTracker.js";

function makeComment(overrides: Partial<Comment>): Comment {
  return {
    id: "c1",
    text: "Comment",
    ...overrides,
  } as Comment;
}

describe("liveLineTracker", () => {
  it("shifts comments below a multi-line insertion", () => {
    const comments = [makeComment({ line: 5 })];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { lineIndex: 1, column: 0 },
          end: { lineIndex: 1, column: 0 },
        },
        text: "a\nb\n",
      },
    ]);

    expect(moved).toBe(true);
    expect(comments[0].line).toBe(7);
  });

  it("shifts inline columns for same-line edits before the anchor", () => {
    const comments = [
      makeComment({
        line: 3,
        start_column: 5,
        end_column: 10,
      }),
    ];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { lineIndex: 2, column: 2 },
          end: { lineIndex: 2, column: 2 },
        },
        text: "XYZ",
      },
    ]);

    expect(moved).toBe(true);
    expect(comments[0].start_column).toBe(8);
    expect(comments[0].end_column).toBe(13);
  });

  it("clamps comments inside a replaced block", () => {
    const comments = [makeComment({ line: 4, end_line: 5 })];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { lineIndex: 1, column: 0 },
          end: { lineIndex: 4, column: 0 },
        },
        text: "replacement",
      },
    ]);

    expect(moved).toBe(true);
    expect(comments[0].line).toBe(2);
    expect(comments[0].end_line).toBe(2);
  });

  it("moves inline anchors across inserted new lines", () => {
    const comments = [
      makeComment({
        line: 3,
        start_column: 5,
        end_column: 10,
      }),
    ];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { lineIndex: 2, column: 2 },
          end: { lineIndex: 2, column: 2 },
        },
        text: "A\nBC\n",
      },
    ]);

    expect(moved).toBe(true);
    expect(comments[0].line).toBe(5);
    expect(comments[0].start_column).toBe(3);
    expect(comments[0].end_column).toBe(8);
  });
});
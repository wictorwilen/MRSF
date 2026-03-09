import { describe, expect, it } from "vitest";
import type { Comment } from "@mrsf/cli";
import { applyLineShifts } from "../../store/LiveLineTracker.js";

function makeComment(overrides: Partial<Comment>): Comment {
  return {
    id: "c1",
    author: "Alice",
    text: "Comment",
    timestamp: "2026-03-09T12:00:00Z",
    ...overrides,
  } as Comment;
}

describe("LiveLineTracker", () => {
  it("shifts comments below a multi-line insertion", () => {
    const comments = [makeComment({ line: 5 })];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        text: "a\nb\n",
      },
    ] as never);

    expect(moved).toBe(true);
    expect(comments[0].line).toBe(7);
  });

  it("shifts inline columns when the edit is before the anchor", () => {
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
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 },
        },
        text: "XYZ",
      },
    ] as never);

    expect(moved).toBe(true);
    expect(comments[0].start_column).toBe(8);
    expect(comments[0].end_column).toBe(13);
  });

  it("clamps overlapping same-line edits to the replacement boundary", () => {
    const comments = [
      makeComment({
        line: 4,
        start_column: 4,
        end_column: 9,
      }),
    ];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 8 },
        },
        text: "Q",
      },
    ] as never);

    expect(moved).toBe(true);
    expect(comments[0].start_column).toBe(3);
    expect(comments[0].end_column).toBe(4);
  });

  it("shrinks the end column for edits that stay within the anchor", () => {
    const comments = [
      makeComment({
        line: 4,
        start_column: 4,
        end_column: 10,
      }),
    ];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { line: 3, character: 6 },
          end: { line: 3, character: 8 },
        },
        text: "Z",
      },
    ] as never);

    expect(moved).toBe(true);
    expect(comments[0].start_column).toBe(4);
    expect(comments[0].end_column).toBe(9);
  });

  it("does not move column anchors for same-line edits after the range", () => {
    const comments = [
      makeComment({
        line: 4,
        start_column: 2,
        end_column: 6,
      }),
    ];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { line: 3, character: 7 },
          end: { line: 3, character: 7 },
        },
        text: "tail",
      },
    ] as never);

    expect(moved).toBe(false);
    expect(comments[0].start_column).toBe(2);
    expect(comments[0].end_column).toBe(6);
  });

  it("preserves relative offsets for comments inside replaced blocks", () => {
    const comments = [makeComment({ line: 4, end_line: 5 })];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 4, character: 0 },
        },
        text: "replacement",
      },
    ] as never);

    expect(moved).toBe(true);
    expect(comments[0].line).toBe(2);
    expect(comments[0].end_line).toBe(2);
  });

  it("applies multiple edits in reverse document order", () => {
    const comments = [
      makeComment({
        line: 6,
        end_line: 7,
      }),
    ];

    const moved = applyLineShifts(comments, [
      {
        range: {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 0 },
        },
        text: "tail\n",
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        text: "head\n",
      },
    ] as never);

    expect(moved).toBe(true);
    expect(comments[0].line).toBe(8);
    expect(comments[0].end_line).toBe(9);
  });

  it("ignores replies and comments without positions", () => {
    const reply = makeComment({ id: "reply", reply_to: "root", line: 6 });
    const unpositioned = makeComment({ id: "note", line: undefined });

    const moved = applyLineShifts([reply, unpositioned], [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        text: "hello\n",
      },
    ] as never);

    expect(moved).toBe(false);
    expect(reply.line).toBe(6);
    expect(unpositioned.line).toBeUndefined();
  });
});
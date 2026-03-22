import { describe, expect, it } from "vitest";
import type { Comment } from "@mrsf/cli/browser";
import { applyLineShifts } from "../core/liveLineTracker.js";

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    author: "A",
    timestamp: "2025-01-01T00:00:00.000Z",
    text: "Comment",
    resolved: false,
    line: 2,
    ...overrides,
  };
}

describe("liveLineTracker", () => {
  it("moves inline comments across edits and leaves replies untouched", () => {
    const inline = makeComment({ start_column: 1, end_column: 4 });
    const reply = makeComment({ id: "reply", reply_to: "c1", start_column: 0, end_column: 2 });
    const moved = applyLineShifts([inline, reply], [{
      range: {
        start: { lineIndex: 1, column: 0 },
        end: { lineIndex: 1, column: 1 },
      },
      text: "prefix\nnext",
    }]);

    expect(moved).toBe(true);
    expect(inline.line).toBe(2);
    expect(inline.end_line).toBe(3);
    expect(reply.line).toBe(2);
  });

  it("updates line comments, preserves unchanged comments, and returns false when nothing moves", () => {
    const lineComment = makeComment({ end_line: 3 });
    const inline = makeComment({ id: "inline", start_column: 0, end_column: 2, line: 1 });
    const unchanged = applyLineShifts([inline], [{
      range: {
        start: { lineIndex: 2, column: 0 },
        end: { lineIndex: 2, column: 0 },
      },
      text: "tail",
    }]);

    expect(unchanged).toBe(false);

    const moved = applyLineShifts([lineComment], [{
      range: {
        start: { lineIndex: 0, column: 0 },
        end: { lineIndex: 0, column: 0 },
      },
      text: "new\n",
    }]);

    expect(moved).toBe(true);
    expect(lineComment.line).toBe(3);
    expect(lineComment.end_line).toBe(4);
  });
});
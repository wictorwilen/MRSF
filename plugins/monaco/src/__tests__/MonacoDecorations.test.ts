import { describe, expect, it } from "vitest";
import {
  createMonacoDecorationSet,
  defaultMonacoDecorationClasses,
} from "../MonacoDecorations.js";
import type { DecorationSnapshot } from "../types.js";

function makeSnapshot(): DecorationSnapshot {
  return {
    threadsByLine: [
      {
        line: 2,
        threads: [
          {
            line: 2,
            rootCommentId: "root-1",
            commentIds: ["root-1", "reply-1"],
            replyCount: 1,
            resolved: false,
            highestSeverity: "high",
            range: {
              start: { lineIndex: 1, column: 2 },
              end: { lineIndex: 1, column: 5 },
            },
          },
        ],
      },
    ],
    gutterMarks: [
      {
        line: 2,
        threadCount: 1,
        commentCount: 2,
        resolvedState: "open",
        highestSeverity: "high",
      },
    ],
    inlineRanges: [
      {
        commentId: "root-1",
        line: 2,
        selectedText: "foo",
        resolved: false,
        severity: "high",
        range: {
          start: { lineIndex: 1, column: 2 },
          end: { lineIndex: 1, column: 5 },
        },
      },
    ],
    hoverTargets: [
      {
        line: 2,
        commentIds: ["root-1", "reply-1"],
      },
    ],
    documentLevelCommentIds: [],
    orphanedCommentIds: [],
  };
}

describe("MonacoDecorations", () => {
  it("creates gutter and inline decorations from a snapshot", () => {
    const set = createMonacoDecorationSet(makeSnapshot());

    expect(set.gutter).toHaveLength(1);
    expect(set.inline).toHaveLength(1);
    expect(set.gutter[0].options.glyphMarginClassName).toContain("mrsf-monaco-gutter-open");
    expect(set.gutter[0].options.glyphMarginClassName).toContain("mrsf-monaco-gutter-high");
    expect(set.inline[0].options.className).toContain("mrsf-monaco-inline");
    expect(set.inline[0].options.className).toContain("mrsf-monaco-inline-high");
    expect(set.inline[0].options.hoverMessage).toBeUndefined();
  });

  it("can disable gutter or inline decorations independently", () => {
    const set = createMonacoDecorationSet(makeSnapshot(), {
      gutterIcons: false,
      inlineHighlights: false,
    });

    expect(set.gutter).toEqual([]);
    expect(set.inline).toEqual([]);
  });

  it("exposes default class names for host overrides", () => {
    const classes = defaultMonacoDecorationClasses();

    expect(classes.inlineBase).toBe("mrsf-monaco-inline");
    expect(classes.lineResolved).toBe("mrsf-monaco-gutter-resolved");
  });
});
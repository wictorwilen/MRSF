import { describe, expect, it } from "vitest";
import { buildHoverContents } from "../MonacoHover.js";
import type { ReviewState, ReviewThread } from "../types.js";

function makeState(): ReviewState {
  return {
    resourceId: "file:///doc.md",
    document: {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [],
    },
    sidecarPath: "/tmp/doc.md.review.yaml",
    documentPath: "/tmp/doc.md",
    documentLines: ["alpha", "beta"],
    snapshot: {
      threadsByLine: [
        {
          line: 2,
          threads: [
            {
              line: 2,
              rootCommentId: "c1",
              commentIds: ["c1", "c2"],
              replyCount: 1,
              resolved: false,
              highestSeverity: "medium",
              range: {
                start: { lineIndex: 1, column: 1 },
                end: { lineIndex: 1, column: 4 },
              },
            },
          ],
        },
      ],
      gutterMarks: [],
      inlineRanges: [],
      hoverTargets: [],
      documentLevelCommentIds: [],
      orphanedCommentIds: [],
    },
    loaded: true,
    dirty: false,
    hasPendingShifts: false,
    lastReanchorResults: [],
  };
}

function makeThreads(): ReviewThread[] {
  return [
    {
      line: 2,
      rootComment: {
        id: "c1",
        author: "Alice",
        timestamp: "2025-01-01T00:00:00.000Z",
        text: "Root comment",
        resolved: false,
        line: 2,
        severity: "medium",
        selected_text: "beta",
      } as ReviewThread["rootComment"],
      replies: [
        {
          id: "c2",
          author: "Bob",
          timestamp: "2025-01-02T00:00:00.000Z",
          text: "Reply text",
          resolved: true,
          reply_to: "c1",
        } as ReviewThread["replies"][number],
      ],
    },
  ];
}

describe("MonacoHover", () => {
  it("builds markdown hover content for a thread", () => {
    const hover = buildHoverContents(makeState(), makeThreads(), 2);

    expect(hover).not.toBeNull();
    expect(hover?.contents[0].value).toContain("**Alice**");
    expect(hover?.contents[0].value).toContain("> beta");
    expect(hover?.contents[0].value).toContain("↳ **Bob** · resolved");
    expect(hover?.range?.startLineNumber).toBe(2);
  });

  it("returns null when there are no threads", () => {
    expect(buildHoverContents(makeState(), [], 2)).toBeNull();
  });
});
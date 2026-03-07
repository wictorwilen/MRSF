import { describe, expect, it } from "vitest";
import type { MrsfDocument } from "@mrsf/cli";
import { projectDecorationSnapshot } from "../core/threadProjection.js";

function makeDocument(): MrsfDocument {
  return {
    version: "1.0",
    comments: [
      {
        id: "root-1",
        text: "Open inline",
        line: 2,
        start_column: 1,
        end_column: 4,
        selected_text: "foo",
        severity: "medium",
      },
      {
        id: "reply-1",
        text: "Reply",
        reply_to: "root-1",
      },
      {
        id: "root-2",
        text: "Resolved line",
        line: 4,
        resolved: true,
        severity: "low",
      },
      {
        id: "root-3",
        text: "Missing line",
        line: 10,
      },
    ],
  } as MrsfDocument;
}

describe("threadProjection", () => {
  it("projects threads, gutter marks, and inline ranges", () => {
    const snapshot = projectDecorationSnapshot(makeDocument(), {
      geometry: {
        lineCount: 5,
        getLineLength: () => 12,
      },
    });

    expect(snapshot.threadsByLine).toHaveLength(2);
    expect(snapshot.gutterMarks).toEqual([
      {
        line: 2,
        threadCount: 1,
        commentCount: 2,
        resolvedState: "open",
        highestSeverity: "medium",
      },
      {
        line: 4,
        threadCount: 1,
        commentCount: 1,
        resolvedState: "resolved",
        highestSeverity: "low",
      },
    ]);
    expect(snapshot.inlineRanges).toHaveLength(1);
    expect(snapshot.orphanedCommentIds).toEqual(["root-3"]);
  });

  it("filters resolved comments when requested", () => {
    const snapshot = projectDecorationSnapshot(makeDocument(), {
      showResolved: false,
      geometry: {
        lineCount: 5,
        getLineLength: () => 12,
      },
    });

    expect(snapshot.gutterMarks).toHaveLength(1);
    expect(snapshot.gutterMarks[0].line).toBe(2);
  });

  it("marks replies without visible parents as orphaned", () => {
    const document = makeDocument();
    document.comments.push({
      id: "reply-2",
      text: "Dangling reply",
      reply_to: "missing-parent",
    } as MrsfDocument["comments"][number]);

    const snapshot = projectDecorationSnapshot(document);

    expect(snapshot.orphanedCommentIds).toContain("reply-2");
  });
});
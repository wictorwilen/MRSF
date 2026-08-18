import { describe, expect, it } from "vitest";
import { createAnchorContextIndex } from "../lib/anchor-context.js";
import { reconcileCommentAnchors } from "../lib/global-reconciliation.js";
import { reanchorComment } from "../lib/reanchor-core.js";
import type { Comment } from "../lib/types.js";

function lines(text: string): string[] {
  return ["", ...text.split("\n")];
}

function comment(id: string, line: number, selectedText: string): Comment {
  return {
    id,
    author: "tester",
    timestamp: "2025-01-01T00:00:00Z",
    text: "Review this",
    resolved: false,
    line,
    selected_text: selectedText,
  };
}

describe("global anchor reconciliation", () => {
  it("uses a moved section landmark to resolve repeated text", () => {
    const alpha = [
      "# Alpha",
      "",
      "Unique alpha landmark.",
      "",
      "Common lead-in.",
      "",
      "Repeated target.",
      "",
      "Common follow-up.",
      "",
      "Unique alpha tail.",
    ].join("\n");
    const beta = [
      "# Beta",
      "",
      "Unique beta landmark.",
      "",
      "Common lead-in.",
      "",
      "Repeated target.",
      "",
      "Common follow-up.",
      "",
      "Unique beta tail.",
    ].join("\n");
    const source = `${alpha}\n\n${beta}`;
    const target = `Intro.\n\n${beta.replace("# Beta", "# Current")}\n\n${
      alpha.replace("# Alpha", "# Current")
    }`;
    const sourceLines = lines(source);
    const targetLines = lines(target);
    const anchorContext = createAnchorContextIndex(sourceLines, targetLines);
    const comments = [
      comment("landmark", 3, "Unique alpha landmark."),
      comment("repeated", 7, "Repeated target."),
      comment("tail", 11, "Unique alpha tail."),
    ];
    const independent = comments.map((value) =>
      reanchorComment(value, targetLines, { anchorContext })
    );

    expect(independent[0]).toMatchObject({
      status: "anchored",
      newLine: 17,
    });
    expect(independent[1].status).toBe("ambiguous");

    expect(
      reconcileCommentAnchors(comments, independent, anchorContext)[1],
    ).toMatchObject({
      status: "anchored",
      newLine: 21,
    });
  });

  it("keeps an ambiguity when landmarks do not agree", () => {
    const source = [
      "Unique first.",
      "",
      "Repeated target.",
      "",
      "Unique last.",
    ].join("\n");
    const target = [
      "Unique first.",
      "",
      "Repeated target.",
      "",
      "Repeated target.",
      "",
      "Unique last.",
    ].join("\n");
    const sourceLines = lines(source);
    const targetLines = lines(target);
    const anchorContext = createAnchorContextIndex(sourceLines, targetLines);
    const comments = [comment("repeated", 3, "Repeated target.")];
    const independent = [{
      commentId: "repeated",
      status: "ambiguous" as const,
      score: 0.8,
      newLine: 3,
      reason: "Candidates are tied.",
    }];

    expect(
      reconcileCommentAnchors(comments, independent, anchorContext)[0].status,
    ).toBe("ambiguous");
  });
});

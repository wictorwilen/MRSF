import { describe, expect, it } from "vitest";
import { renderReviewThreadHtml } from "../ui/threadHtml.js";
import type { ReviewThread } from "../types.js";

function makeThread(): ReviewThread {
  return {
    line: 4,
    rootComment: {
      id: "c1",
      author: "Alice",
      timestamp: "2026-03-07T12:00:00.000Z",
      text: "Root comment",
      resolved: false,
      line: 4,
      selected_text: "selected text",
      severity: "medium",
      type: "note",
    } as ReviewThread["rootComment"],
    replies: [
      {
        id: "r1",
        author: "Bob",
        timestamp: "2026-03-07T12:05:00.000Z",
        text: "Reply text",
        resolved: true,
        reply_to: "c1",
      } as ReviewThread["replies"][number],
    ],
  };
}

describe("threadHtml", () => {
  it("renders shared-style thread HTML with action buttons", () => {
    const html = renderReviewThreadHtml(makeThread(), true);

    expect(html).toContain("mrsf-thread");
    expect(html).toContain("mrsf-selected-text");
    expect(html).toContain('data-mrsf-action="reply"');
    expect(html).toContain('data-mrsf-action="edit"');
    expect(html).toContain('data-mrsf-action="delete"');
    expect(html).toContain("Reply text");
  });
});
import { describe, it, expect } from "vitest";
import { escapeHtml, formatTime, renderCommentHtml, renderThreadHtml } from "../html.js";
import type { SlimComment, CommentThread } from "../types.js";

// ── Helpers ──────────────────────────────────────────────

function makeComment(overrides: Partial<SlimComment> = {}): SlimComment {
  return {
    id: "c1",
    author: "Alice",
    text: "A comment",
    line: 5,
    end_line: null,
    start_column: null,
    end_column: null,
    selected_text: null,
    resolved: false,
    reply_to: null,
    severity: null,
    type: null,
    timestamp: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<SlimComment> = {}, replies: SlimComment[] = []): CommentThread {
  return { comment: makeComment(overrides), replies };
}

// ── escapeHtml ───────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });

  it("escapes angle brackets", () => {
    expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('a"b')).toBe("a&quot;b");
  });

  it("handles all special chars together", () => {
    expect(escapeHtml('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });

  it("returns empty string as-is", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns clean string unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// ── formatTime ───────────────────────────────────────────

describe("formatTime", () => {
  it("returns empty string for null", () => {
    expect(formatTime(null)).toBe("");
  });

  it("returns a string for invalid ISO input (no throw)", () => {
    // new Date("not-a-date") produces Invalid Date without throwing
    const result = formatTime("not-a-date");
    expect(typeof result).toBe("string");
  });

  it("formats valid ISO date", () => {
    const result = formatTime("2026-03-02T18:22:59Z");
    // Locale-dependent but should contain the year
    expect(result).toContain("2026");
  });

  it("formats date-only string", () => {
    const result = formatTime("2024-01-15");
    expect(result).toContain("2024");
  });
});

// ── renderCommentHtml ────────────────────────────────────

describe("renderCommentHtml", () => {
  it("renders basic comment with author and body", () => {
    const html = renderCommentHtml(makeComment(), false, false);
    expect(html).toContain("mrsf-author");
    expect(html).toContain("Alice");
    expect(html).toContain("mrsf-comment-body");
    expect(html).toContain("A comment");
  });

  it("renders timestamp when present", () => {
    const html = renderCommentHtml(
      makeComment({ timestamp: "2026-03-02T18:22:59Z" }),
      false,
      false,
    );
    expect(html).toContain("mrsf-date");
    expect(html).toContain("2026");
  });

  it("omits timestamp element when null", () => {
    const html = renderCommentHtml(makeComment(), false, false);
    expect(html).not.toContain("mrsf-date");
  });

  it("renders severity badge", () => {
    const html = renderCommentHtml(makeComment({ severity: "high" }), false, false);
    expect(html).toContain("mrsf-severity");
    expect(html).toContain("mrsf-severity-high");
    expect(html).toContain("high");
  });

  it("renders type badge", () => {
    const html = renderCommentHtml(makeComment({ type: "suggestion" }), false, false);
    expect(html).toContain("mrsf-type");
    expect(html).toContain("suggestion");
  });

  it("renders resolved badge", () => {
    const html = renderCommentHtml(makeComment({ resolved: true }), false, false);
    expect(html).toContain("mrsf-resolved-badge");
    expect(html).toContain("✓ resolved");
    expect(html).toContain("mrsf-resolved");
  });

  it("renders selected_text quote", () => {
    const html = renderCommentHtml(
      makeComment({ selected_text: "some selected text" }),
      false,
      false,
    );
    expect(html).toContain("mrsf-selected-text");
    expect(html).toContain("some selected text");
  });

  it("omits selected_text element when null", () => {
    const html = renderCommentHtml(makeComment(), false, false);
    expect(html).not.toContain("mrsf-selected-text");
  });

  it("adds reply class when isReply is true", () => {
    const html = renderCommentHtml(makeComment(), true, false);
    expect(html).toContain("mrsf-reply");
  });

  it("omits reply class when isReply is false", () => {
    const html = renderCommentHtml(makeComment(), false, false);
    expect(html).not.toContain("mrsf-reply");
  });

  it("includes data-mrsf-comment-id attribute", () => {
    const html = renderCommentHtml(makeComment({ id: "abc-123" }), false, false);
    expect(html).toContain('data-mrsf-comment-id="abc-123"');
  });

  // Interactive mode
  it("renders action buttons in interactive mode", () => {
    const html = renderCommentHtml(makeComment(), false, true);
    expect(html).toContain("mrsf-actions");
    expect(html).toContain('data-mrsf-action="resolve"');
    expect(html).toContain('data-mrsf-action="reply"');
    expect(html).toContain('data-mrsf-action="edit"');
    expect(html).toContain('data-mrsf-action="delete"');
  });

  it("renders unresolve button for resolved comment in interactive mode", () => {
    const html = renderCommentHtml(makeComment({ resolved: true }), false, true);
    expect(html).toContain('data-mrsf-action="unresolve"');
    expect(html).not.toContain('data-mrsf-action="resolve"');
  });

  it("omits action buttons when not interactive", () => {
    const html = renderCommentHtml(makeComment(), false, false);
    expect(html).not.toContain("mrsf-actions");
    expect(html).not.toContain("data-mrsf-action");
  });

  it("escapes XSS in author field", () => {
    const html = renderCommentHtml(
      makeComment({ author: '<script>alert("xss")</script>' }),
      false,
      false,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes XSS in body text", () => {
    const html = renderCommentHtml(
      makeComment({ text: '<img onerror="alert(1)" src=x>' }),
      false,
      false,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes XSS in selected_text", () => {
    const html = renderCommentHtml(
      makeComment({ selected_text: '"><script>xss</script>' }),
      false,
      false,
    );
    expect(html).not.toContain("<script>");
  });

  it("escapes XSS in comment id", () => {
    const html = renderCommentHtml(
      makeComment({ id: '"><script>xss</script>' }),
      false,
      false,
    );
    expect(html).not.toContain("<script>");
  });

  it("renders all header elements for a fully-decorated comment", () => {
    const html = renderCommentHtml(
      makeComment({
        severity: "medium",
        type: "issue",
        resolved: true,
        timestamp: "2026-01-01T00:00:00Z",
        selected_text: "selected",
      }),
      false,
      true,
    );
    expect(html).toContain("mrsf-severity-medium");
    expect(html).toContain("mrsf-type");
    expect(html).toContain("mrsf-resolved-badge");
    expect(html).toContain("mrsf-date");
    expect(html).toContain("mrsf-selected-text");
    expect(html).toContain('data-mrsf-action="unresolve"');
  });
});

// ── renderThreadHtml ─────────────────────────────────────

describe("renderThreadHtml", () => {
  it("renders a thread wrapper", () => {
    const html = renderThreadHtml(makeThread(), false);
    expect(html).toContain("mrsf-thread");
  });

  it("renders root comment", () => {
    const html = renderThreadHtml(makeThread({ author: "Bob" }), false);
    expect(html).toContain("Bob");
  });

  it("renders replies section when replies present", () => {
    const reply = makeComment({ id: "r1", author: "Carol", text: "I agree", reply_to: "c1" });
    const html = renderThreadHtml(makeThread({}, [reply]), false);
    expect(html).toContain("mrsf-replies");
    expect(html).toContain("Carol");
    expect(html).toContain("I agree");
    expect(html).toContain("mrsf-reply");
  });

  it("omits replies section when no replies", () => {
    const html = renderThreadHtml(makeThread(), false);
    expect(html).not.toContain("mrsf-replies");
  });

  it("renders multiple replies in order", () => {
    const r1 = makeComment({ id: "r1", author: "Carol", text: "First reply", reply_to: "c1" });
    const r2 = makeComment({ id: "r2", author: "Dave", text: "Second reply", reply_to: "c1" });
    const html = renderThreadHtml(makeThread({}, [r1, r2]), false);
    const carolIdx = html.indexOf("Carol");
    const daveIdx = html.indexOf("Dave");
    expect(carolIdx).toBeLessThan(daveIdx);
  });

  it("passes interactive flag to comment rendering", () => {
    const html = renderThreadHtml(makeThread(), true);
    expect(html).toContain("mrsf-actions");
    expect(html).toContain('data-mrsf-action="resolve"');
  });

  it("passes interactive flag to reply rendering", () => {
    const reply = makeComment({ id: "r1", reply_to: "c1" });
    const html = renderThreadHtml(makeThread({}, [reply]), true);
    // Both root and reply should have actions
    const matches = html.match(/mrsf-actions/g);
    expect(matches?.length).toBe(2);
  });
});

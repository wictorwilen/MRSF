/**
 * Tests for @mrsf/markdown-it-mrsf plugin.
 */

import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "../index.js";
import type { MrsfPluginOptions } from "../types.js";
import type { MrsfDocument } from "@mrsf/cli";

/** Helper: create an MrsfDocument with the given comments. */
function makeSidecar(
  comments: Partial<MrsfDocument["comments"][number]>[],
): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "test.md",
    comments: comments.map((c, i) => ({
      id: c.id ?? `c${i}`,
      author: c.author ?? "Tester",
      timestamp: c.timestamp ?? "2026-01-01T00:00:00Z",
      text: c.text ?? `Comment ${i}`,
      resolved: c.resolved ?? false,
      ...c,
    })),
  } as MrsfDocument;
}

/** Helper: render markdown with the plugin. */
function render(
  markdown: string,
  comments: Partial<MrsfDocument["comments"][number]>[],
  opts?: Partial<MrsfPluginOptions>,
): string {
  const md = new MarkdownIt();
  md.use(mrsfPlugin, {
    comments: makeSidecar(comments),
    ...opts,
  });
  return md.render(markdown);
}

// ── Badge injection ────────────────────────────────────────

describe("badge injection", () => {
  it("should inject a badge for a line-anchored comment", () => {
    const html = render("# Hello\n\nWorld\n", [
      { id: "c1", text: "A comment", line: 1 },
    ]);
    expect(html).toContain("mrsf-badge");
    expect(html).toContain("mrsf-tooltip");
    expect(html).toContain("💬 1");
  });

  it("should inject badge at the correct line", () => {
    const html = render("Line one\n\nLine three\n", [
      { id: "c1", text: "Comment on line 3", line: 3 },
    ]);
    // The badge should be near the line-3 content
    expect(html).toContain('data-mrsf-line="3"');
    expect(html).toContain("Comment on line 3");
  });

  it("should not inject anything when no comments", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { comments: makeSidecar([]) });
    const html = md.render("# Hello\n");
    expect(html).not.toContain("mrsf-badge");
  });

  it("should not inject anything without sidecar data", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, {});
    const html = md.render("# Hello\n");
    expect(html).not.toContain("mrsf-badge");
  });
});

// ── Multiple comments on same line ─────────────────────────

describe("comment grouping", () => {
  it("should show total count for multiple comments on same line", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "First", line: 1 },
      { id: "c2", text: "Second", line: 1 },
    ]);
    expect(html).toContain("💬 2");
  });

  it("should include replies in the count", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Root", line: 1 },
      { id: "r1", text: "Reply", reply_to: "c1" },
    ]);
    expect(html).toContain("💬 2");
  });
});

// ── Reply threading ────────────────────────────────────────

describe("reply threading", () => {
  it("should render replies inside the tooltip", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Root comment", line: 1, author: "Alice" },
      { id: "r1", text: "A reply", reply_to: "c1", author: "Bob" },
    ]);
    expect(html).toContain("mrsf-replies");
    expect(html).toContain("mrsf-reply");
    expect(html).toContain("A reply");
    expect(html).toContain("Bob");
  });
});

// ── Resolved comments ──────────────────────────────────────

describe("resolved comments", () => {
  it("should show resolved badge when all resolved", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ]);
    expect(html).toContain("✓ 1");
    expect(html).toContain("mrsf-badge-resolved");
    expect(html).toContain("mrsf-resolved");
  });

  it("should hide resolved comments when showResolved is false", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { showResolved: false });
    expect(html).not.toContain("mrsf-badge");
  });

  it("should still show unresolved when showResolved is false", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Open", line: 1, resolved: false },
      { id: "c2", text: "Done", line: 1, resolved: true },
    ], { showResolved: false });
    expect(html).toContain("mrsf-badge");
    expect(html).toContain("Open");
    expect(html).not.toContain("Done");
  });
});

// ── Severity styling ───────────────────────────────────────

describe("severity", () => {
  it("should add severity class for high severity", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Critical", line: 1, severity: "high" },
    ]);
    expect(html).toContain("mrsf-badge-severity-high");
    expect(html).toContain("mrsf-severity-high");
  });

  it("should add severity class for medium severity", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Warning", line: 1, severity: "medium" },
    ]);
    expect(html).toContain("mrsf-badge-severity-medium");
    expect(html).toContain("mrsf-severity-medium");
  });

  it("should render severity label in tooltip", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Issue", line: 1, severity: "low" },
    ]);
    expect(html).toContain("mrsf-severity-low");
  });
});

// ── Comment type ───────────────────────────────────────────

describe("comment type", () => {
  it("should render type label in tooltip", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Fix this", line: 1, type: "suggestion" },
    ]);
    expect(html).toContain("mrsf-type");
    expect(html).toContain("suggestion");
  });
});

// ── Inline selected_text highlighting ──────────────────────

describe("inline highlighting", () => {
  it("should wrap selected_text in a mark element", () => {
    const html = render("This is important text here\n", [
      { id: "c1", text: "Highlight this", line: 1, selected_text: "important" },
    ]);
    expect(html).toContain("<mark");
    expect(html).toContain("mrsf-highlight");
    expect(html).toContain('data-mrsf-comment-id="c1"');
  });

  it("should show selected_text quote in tooltip", () => {
    const html = render("Some important text\n", [
      { id: "c1", text: "Note", line: 1, selected_text: "important" },
    ]);
    expect(html).toContain("mrsf-selected-text");
    expect(html).toContain("important");
  });
});

// ── Interactive mode ───────────────────────────────────────

describe("interactive mode", () => {
  it("should render action buttons when interactive is true", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { interactive: true });
    expect(html).toContain("mrsf-actions");
    expect(html).toContain("mrsf-action-btn");
    expect(html).toContain('data-mrsf-action="resolve"');
    expect(html).toContain('data-mrsf-action="reply"');
    expect(html).toContain('data-mrsf-action="edit"');
  });

  it("should render unresolve button for resolved comments", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { interactive: true });
    expect(html).toContain('data-mrsf-action="unresolve"');
    expect(html).not.toContain('data-mrsf-action="resolve"');
  });

  it("should NOT render action buttons when interactive is false", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { interactive: false });
    expect(html).not.toContain("mrsf-action-btn");
    expect(html).not.toContain('data-mrsf-action="resolve"');
  });

  it("should include comment id in action button data attributes", () => {
    const html = render("# Title\n", [
      { id: "abc123", text: "A comment", line: 1 },
    ], { interactive: true });
    expect(html).toContain('data-mrsf-comment-id="abc123"');
  });
});

// ── Data attributes ────────────────────────────────────────

describe("data attributes", () => {
  it("should add data-mrsf-line to highlighted elements", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ]);
    expect(html).toContain('data-mrsf-line="1"');
  });

  it("should add data-mrsf-comment-id to badge", () => {
    const html = render("# Title\n", [
      { id: "xyz", text: "Comment", line: 1 },
    ]);
    expect(html).toContain('data-mrsf-comment-id="xyz"');
  });
});

// ── Edge cases ─────────────────────────────────────────────

describe("edge cases", () => {
  it("should handle comments without line numbers gracefully", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Unanchored" },
    ]);
    // Unanchored comments should not produce badges
    expect(html).not.toContain("mrsf-badge");
  });

  it("should handle line numbers beyond document length", () => {
    const html = render("# Short\n", [
      { id: "c1", text: "Beyond", line: 999 },
    ]);
    // Should not crash, badge may or may not appear
    expect(html).toContain("<h1>");
  });

  it("should handle multiple comments on different lines", () => {
    const html = render("# One\n\n## Two\n\nThree\n", [
      { id: "c1", text: "On heading 1", line: 1 },
      { id: "c2", text: "On heading 2", line: 3 },
    ]);
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain('data-mrsf-line="3"');
  });
});

// ── HTML escaping ──────────────────────────────────────────

describe("html escaping", () => {
  it("should escape HTML in comment text", () => {
    const html = render("# Title\n", [
      { id: "c1", text: '<script>alert("xss")</script>', line: 1 },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should escape HTML in author name", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Comment", line: 1, author: '<b>Evil</b>' },
    ]);
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });
});

/**
 * Tests for @mrsf/rehype-mrsf plugin.
 */

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { rehypeMrsf } from "../index.js";
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

/** Helper: render markdown through the unified pipeline with the plugin. */
async function render(
  markdown: string,
  comments: Partial<MrsfDocument["comments"][number]>[],
  opts?: Partial<MrsfPluginOptions>,
): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeMrsf, {
      comments: makeSidecar(comments),
      ...opts,
    } as MrsfPluginOptions)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(result);
}

// ── Badge injection ────────────────────────────────────────

describe("badge injection", () => {
  it("should inject a badge for a line-anchored comment", async () => {
    const html = await render("# Hello\n\nWorld\n", [
      { id: "c1", text: "A comment", line: 1 },
    ]);
    expect(html).toContain("mrsf-badge");
    expect(html).toContain("mrsf-tooltip");
    expect(html).toContain("💬 1");
  });

  it("should inject badge at the correct line", async () => {
    const html = await render("Line one\n\nLine three\n", [
      { id: "c1", text: "Comment on line 3", line: 3 },
    ]);
    expect(html).toContain('data-mrsf-line="3"');
    expect(html).toContain("Comment on line 3");
  });

  it("should not inject anything when no comments", async () => {
    const result = await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeMrsf, { comments: makeSidecar([]) } as MrsfPluginOptions)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process("# Hello\n");
    expect(String(result)).not.toContain("mrsf-badge");
  });

  it("should not inject anything without sidecar data", async () => {
    const result = await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeMrsf, {} as MrsfPluginOptions)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process("# Hello\n");
    expect(String(result)).not.toContain("mrsf-badge");
  });

  it("should load comments from a custom loader function", async () => {
    const result = await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeMrsf, {
        loader: () => makeSidecar([
          { id: "ldr1", text: "From loader", line: 1 },
        ]),
      } as MrsfPluginOptions)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process("# Hello\n");
    const html = String(result);
    expect(html).toContain("mrsf-badge");
    expect(html).toContain("From loader");
  });

  it("should handle loader returning null", async () => {
    const result = await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeMrsf, { loader: () => null } as MrsfPluginOptions)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process("# Hello\n");
    expect(String(result)).not.toContain("mrsf-badge");
  });

  it("should prefer comments over loader", async () => {
    const result = await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeMrsf, {
        comments: makeSidecar([{ id: "inline1", text: "Inline", line: 1 }]),
        loader: () => makeSidecar([{ id: "ldr1", text: "Loader", line: 1 }]),
      } as MrsfPluginOptions)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process("# Hello\n");
    const html = String(result);
    expect(html).toContain("Inline");
    expect(html).not.toContain("Loader");
  });
});

// ── Multiple comments on same line ─────────────────────────

describe("comment grouping", () => {
  it("should show total count for multiple comments on same line", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "First", line: 1 },
      { id: "c2", text: "Second", line: 1 },
    ]);
    expect(html).toContain("💬 2");
  });

  it("should include replies in the count", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Root", line: 1 },
      { id: "r1", text: "Reply", reply_to: "c1" },
    ]);
    expect(html).toContain("💬 2");
  });
});

// ── Reply threading ────────────────────────────────────────

describe("reply threading", () => {
  it("should render replies inside the tooltip", async () => {
    const html = await render("# Title\n", [
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
  it("should show resolved badge when all resolved", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ]);
    expect(html).toContain("✓ 1");
    expect(html).toContain("mrsf-badge-resolved");
    expect(html).toContain("mrsf-resolved");
  });

  it("should hide resolved comments when showResolved is false", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { showResolved: false });
    expect(html).not.toContain("mrsf-badge");
  });

  it("should still show unresolved when showResolved is false", async () => {
    const html = await render("# Title\n", [
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
  it("should add severity class for high severity", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Critical", line: 1, severity: "high" },
    ]);
    expect(html).toContain("mrsf-badge-severity-high");
    expect(html).toContain("mrsf-severity-high");
  });

  it("should add severity class for medium severity", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Warning", line: 1, severity: "medium" },
    ]);
    expect(html).toContain("mrsf-badge-severity-medium");
    expect(html).toContain("mrsf-severity-medium");
  });

  it("should render severity label in tooltip", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Issue", line: 1, severity: "low" },
    ]);
    expect(html).toContain("mrsf-severity-low");
  });
});

// ── Comment type ───────────────────────────────────────────

describe("comment type", () => {
  it("should render type label in tooltip", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Fix this", line: 1, type: "suggestion" },
    ]);
    expect(html).toContain("mrsf-type");
    expect(html).toContain("suggestion");
  });
});

// ── Inline selected_text highlighting ──────────────────────

describe("inline highlighting", () => {
  it("should wrap selected_text in a mark element", async () => {
    const html = await render("This is important text here\n", [
      { id: "c1", text: "Highlight this", line: 1, selected_text: "important" },
    ]);
    expect(html).toContain("<mark");
    expect(html).toContain("mrsf-highlight");
    expect(html).toContain('data-mrsf-comment-id="c1"');
  });

  it("should show selected_text quote in tooltip", async () => {
    const html = await render("Some important text\n", [
      { id: "c1", text: "Note", line: 1, selected_text: "important" },
    ]);
    expect(html).toContain("mrsf-selected-text");
    expect(html).toContain("important");
  });
});

// ── Interactive mode ───────────────────────────────────────

describe("interactive mode", () => {
  it("should render action buttons when interactive is true", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { interactive: true });
    expect(html).toContain("mrsf-actions");
    expect(html).toContain("mrsf-action-btn");
    expect(html).toContain('data-mrsf-action="resolve"');
    expect(html).toContain('data-mrsf-action="reply"');
    expect(html).toContain('data-mrsf-action="edit"');
  });

  it("should render unresolve button for resolved comments", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { interactive: true });
    expect(html).toContain('data-mrsf-action="unresolve"');
    expect(html).not.toContain('data-mrsf-action="resolve"');
  });

  it("should NOT render action buttons when interactive is false", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { interactive: false });
    expect(html).not.toContain("mrsf-action-btn");
    expect(html).not.toContain('data-mrsf-action="resolve"');
  });

  it("should include comment id in action button data attributes", async () => {
    const html = await render("# Title\n", [
      { id: "abc123", text: "A comment", line: 1 },
    ], { interactive: true });
    expect(html).toContain('data-mrsf-comment-id="abc123"');
  });
});

// ── Data attributes ────────────────────────────────────────

describe("data attributes", () => {
  it("should add data-mrsf-line to highlighted elements", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ]);
    expect(html).toContain('data-mrsf-line="1"');
  });

  it("should add data-mrsf-comment-id to badge", async () => {
    const html = await render("# Title\n", [
      { id: "xyz", text: "Comment", line: 1 },
    ]);
    expect(html).toContain('data-mrsf-comment-id="xyz"');
  });
});

// ── Edge cases ─────────────────────────────────────────────

describe("edge cases", () => {
  it("should handle comments without line numbers gracefully", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Unanchored" },
    ]);
    expect(html).not.toContain("mrsf-badge");
  });

  it("should handle line numbers beyond document length", async () => {
    const html = await render("# Short\n", [
      { id: "c1", text: "Beyond", line: 999 },
    ]);
    expect(html).toContain("<h1>");
  });

  it("should handle multiple comments on different lines", async () => {
    const html = await render("# One\n\n## Two\n\nThree\n", [
      { id: "c1", text: "On heading 1", line: 1 },
      { id: "c2", text: "On heading 2", line: 3 },
    ]);
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain('data-mrsf-line="3"');
  });
});

// ── HTML escaping ──────────────────────────────────────────

describe("html escaping", () => {
  it("should escape HTML in comment text", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: '<script>alert("xss")</script>', line: 1 },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should escape HTML in author name", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1, author: '<b>Evil</b>' },
    ]);
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });

  it("should use <span> (not <div>) for tooltip elements inside paragraphs", async () => {
    const html = await render("Some text\n", [
      { id: "c1", text: "Comment", line: 1 },
    ]);
    expect(html).toContain('<span class="mrsf-tooltip"');
    expect(html).toContain('<span class="mrsf-thread"');
    expect(html).toContain('<span class="mrsf-comment"');
    expect(html).not.toContain('<div class="mrsf-tooltip"');
    expect(html).not.toContain('<div class="mrsf-thread"');
    expect(html).not.toContain('<div class="mrsf-comment"');
  });
});

// ── Resolved comment details (A) ──────────────────────────

describe("resolved comment details", () => {
  it("should show full comment details for resolved comments on hover", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Old issue", line: 1, resolved: true, severity: "low" },
    ]);
    expect(html).toContain("mrsf-tooltip");
    expect(html).toContain("Old issue");
    expect(html).toContain("mrsf-severity-low");
    expect(html).toContain("✓ resolved");
  });

  it("should render resolved badge with resolved class for styling", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ]);
    expect(html).toContain("mrsf-resolved-badge");
    expect(html).toContain("mrsf-badge-resolved");
  });
});

// ── Gutter position (B) ───────────────────────────────────

describe("gutter position", () => {
  it("should default to right gutter position", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ]);
    expect(html).toContain("mrsf-gutter-right");
  });

  it("should support tight gutter position", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ], { gutterPosition: "tight" });
    expect(html).toContain("mrsf-gutter-tight");
    expect(html).not.toContain("mrsf-gutter-right");
    expect(html).not.toContain("mrsf-gutter-left");
  });

  it("should support left gutter position", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ], { gutterPosition: "left" });
    expect(html).toContain("mrsf-gutter-left");
    expect(html).not.toContain("mrsf-gutter-right");
  });

  it("should support right gutter position explicitly", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ], { gutterPosition: "right" });
    expect(html).toContain("mrsf-gutter-right");
    expect(html).not.toContain("mrsf-gutter-left");
  });

  it("should wrap content in gutter container for left mode", async () => {
    const html = await render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ], { gutterPosition: "left" });
    expect(html).toContain("mrsf-gutter-container");
  });
});

// ── Gutter for inline (C) ─────────────────────────────────

describe("gutterForInline", () => {
  it("should show gutter badge for inline comments by default", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Comment", line: 1, selected_text: "Hello" },
    ]);
    expect(html).toContain("mrsf-badge");
    expect(html).toContain("mrsf-highlight");
  });

  it("should hide gutter badge when gutterForInline is false and all comments have selected_text", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Comment", line: 1, selected_text: "Hello" },
    ], { gutterForInline: false });
    expect(html).not.toContain("mrsf-badge");
    expect(html).toContain("mrsf-highlight");
  });

  it("should still show gutter badge when gutterForInline is false but some comments lack selected_text", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Inline", line: 1, selected_text: "Hello" },
      { id: "c2", text: "Line-only", line: 1 },
    ], { gutterForInline: false });
    expect(html).toContain("mrsf-badge");
    expect(html).toContain("mrsf-highlight");
  });

  it("should ignore gutterForInline when inlineHighlights is false", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Comment", line: 1, selected_text: "Hello" },
    ], { gutterForInline: false, inlineHighlights: false });
    expect(html).toContain("mrsf-badge");
    expect(html).not.toContain("mrsf-highlight");
  });
});

// ── Inline highlight tooltips (D) ─────────────────────────

describe("inline highlight tooltips", () => {
  it("should show tooltip when hovering inline highlight", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Check this text", line: 1, selected_text: "Hello", author: "Jane" },
    ]);
    expect(html).toContain("mrsf-inline-anchor");
    expect(html).toContain("mrsf-inline-tooltip");
    expect(html).toContain("Check this text");
    expect(html).toContain("Jane");
  });

  it("should include thread replies in inline tooltip", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Question", line: 1, selected_text: "Hello" },
      { id: "r1", text: "Reply here", reply_to: "c1" },
    ]);
    expect(html).toContain("mrsf-inline-tooltip");
    expect(html).toContain("Reply here");
  });

  it("should render interactive buttons in inline tooltip when interactive is true", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Check", line: 1, selected_text: "Hello" },
    ], { interactive: true });
    expect(html).toContain("mrsf-inline-tooltip");
    expect(html).toContain("mrsf-action-btn");
  });

  it("should add tabindex to highlighted text for keyboard accessibility", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Check", line: 1, selected_text: "Hello" },
    ]);
    expect(html).toContain("<mark");
    expect(html).toContain("mrsf-highlight");
    expect(html).toContain('tabindex="0"');
  });
});

// ── Inline highlights toggle (E) ──────────────────────────

describe("inlineHighlights option", () => {
  it("should show inline highlights by default", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Comment", line: 1, selected_text: "Hello" },
    ]);
    expect(html).toContain("mrsf-highlight");
    expect(html).toContain("mrsf-badge");
  });

  it("should hide inline highlights when inlineHighlights is false", async () => {
    const html = await render("Hello world\n", [
      { id: "c1", text: "Comment", line: 1, selected_text: "Hello" },
    ], { inlineHighlights: false });
    expect(html).not.toContain("mrsf-highlight");
    expect(html).not.toContain("mrsf-inline-anchor");
    expect(html).toContain("mrsf-badge");
  });

  it("should still show gutter badges for all comments when inlineHighlights is false", async () => {
    const html = await render("Hello world\n\nSecond line\n", [
      { id: "c1", text: "Inline", line: 1, selected_text: "Hello" },
      { id: "c2", text: "Line-only", line: 3 },
    ], { inlineHighlights: false });
    expect(html).not.toContain("mrsf-highlight");
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain('data-mrsf-line="3"');
  });
});

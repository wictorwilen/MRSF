/**
 * Tests for @mrsf/markdown-it-mrsf plugin (overlay gutter architecture).
 *
 * In the new architecture, the plugin ONLY:
 *   1. Adds data-mrsf-line / data-mrsf-start-line / data-mrsf-end-line attributes
 *   2. Optionally adds mrsf-line-highlight class (when lineHighlight is true)
 *   3. Appends a <script type="application/mrsf+json"> with thread data
 *
 * All visual rendering (badges, tooltips, highlights) happens at runtime
 * via the MrsfController — not tested here.
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

/** Helper: parse the embedded JSON data from the script tag. */
function parseDataScript(html: string): { threads: any[] } | null {
  const match = html.match(
    /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  return JSON.parse(match[1]);
}

// ── Line annotation ────────────────────────────────────────

describe("line annotation", () => {
  it("should annotate a block element for a line-anchored comment", () => {
    const html = render("# Hello\n\nWorld\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { lineHighlight: true });
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain("mrsf-line-highlight");
  });

  it("should annotate the correct line", () => {
    const html = render("Line one\n\nLine three\n", [
      { id: "c1", text: "Comment on line 3", line: 3 },
    ], { lineHighlight: true });
    expect(html).toContain('data-mrsf-line="3"');
    expect(html).toContain("mrsf-line-highlight");
  });

  it("should not inject anything when no comments", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { comments: makeSidecar([]) });
    const html = md.render("# Hello\n");
    expect(html).not.toContain("mrsf-line-highlight");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("should not inject anything without sidecar data", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, {});
    const html = md.render("# Hello\n");
    expect(html).not.toContain("mrsf-line-highlight");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("should load comments from a custom loader function", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, {
      loader: () => makeSidecar([
        { id: "ldr1", text: "From loader", line: 1 },
      ]),
      lineHighlight: true,
    });
    const html = md.render("# Hello\n");
    expect(html).toContain("mrsf-line-highlight");
    const data = parseDataScript(html);
    expect(data).not.toBeNull();
    expect(data!.threads[0].comment.text).toBe("From loader");
  });

  it("should handle loader returning null", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { loader: () => null });
    const html = md.render("# Hello\n");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("should prefer comments over loader", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, {
      comments: makeSidecar([{ id: "inline1", text: "Inline", line: 1 }]),
      loader: () => makeSidecar([{ id: "ldr1", text: "Loader", line: 1 }]),
    });
    const html = md.render("# Hello\n");
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.text).toBe("Inline");
  });

  it("should add data-mrsf-start-line and data-mrsf-end-line", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ]);
    expect(html).toContain('data-mrsf-start-line="1"');
    expect(html).toContain('data-mrsf-end-line="1"');
  });
});

// ── Embedded data script ───────────────────────────────────

describe("embedded data script", () => {
  it("should embed a script tag with comment data", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ]);
    expect(html).toContain('<script type="application/mrsf+json">');
    const data = parseDataScript(html);
    expect(data).not.toBeNull();
    expect(data!.threads).toHaveLength(1);
    expect(data!.threads[0].comment.id).toBe("c1");
    expect(data!.threads[0].comment.text).toBe("A comment");
  });

  it("should include multiple threads for multiple comments on same line", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "First", line: 1 },
      { id: "c2", text: "Second", line: 1 },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads).toHaveLength(2);
    expect(data!.threads[0].comment.text).toBe("First");
    expect(data!.threads[1].comment.text).toBe("Second");
  });

  it("should thread replies under their parent comment", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Root", line: 1 },
      { id: "r1", text: "Reply", reply_to: "c1" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads).toHaveLength(1);
    expect(data!.threads[0].comment.text).toBe("Root");
    expect(data!.threads[0].replies).toHaveLength(1);
    expect(data!.threads[0].replies[0].text).toBe("Reply");
  });

  it("should include author information", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Root comment", line: 1, author: "Alice" },
      { id: "r1", text: "A reply", reply_to: "c1", author: "Bob" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.author).toBe("Alice");
    expect(data!.threads[0].replies[0].author).toBe("Bob");
  });

  it("should include severity in thread data", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Critical", line: 1, severity: "high" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.severity).toBe("high");
  });

  it("should include comment type in thread data", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Fix this", line: 1, type: "suggestion" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.type).toBe("suggestion");
  });

  it("should include selected_text in thread data", () => {
    const html = render("Hello world\n", [
      { id: "c1", text: "Note", line: 1, selected_text: "Hello" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.selected_text).toBe("Hello");
  });

  it("should include resolved status in thread data", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.resolved).toBe(true);
  });

  it("should include threads from multiple lines", () => {
    const html = render("# One\n\n## Two\n\nThree\n", [
      { id: "c1", text: "On heading 1", line: 1 },
      { id: "c2", text: "On heading 2", line: 3 },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads).toHaveLength(2);
    const lines = data!.threads.map((t: any) => t.comment.line);
    expect(lines).toContain(1);
    expect(lines).toContain(3);
  });
});

// ── Resolved comments filtering ────────────────────────────

describe("resolved comments", () => {
  it("should include resolved comments by default", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { lineHighlight: true });
    expect(html).toContain("mrsf-line-highlight");
    const data = parseDataScript(html);
    expect(data!.threads).toHaveLength(1);
    expect(data!.threads[0].comment.resolved).toBe(true);
  });

  it("should hide resolved comments when showResolved is false", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { showResolved: false });
    expect(html).not.toContain("mrsf-line-highlight");
    expect(parseDataScript(html)).toBeNull();
  });

  it("should still show unresolved when showResolved is false", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Open", line: 1, resolved: false },
      { id: "c2", text: "Done", line: 1, resolved: true },
    ], { showResolved: false, lineHighlight: true });
    expect(html).toContain("mrsf-line-highlight");
    const data = parseDataScript(html);
    expect(data!.threads).toHaveLength(1);
    expect(data!.threads[0].comment.text).toBe("Open");
  });
});

// ── No visual DOM injection ────────────────────────────────

describe("no visual DOM injection", () => {
  it("should not contain any badge elements", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ]);
    expect(html).not.toContain("mrsf-badge");
    expect(html).not.toContain("💬");
    expect(html).not.toContain("✓ 1");
  });

  it("should not contain any tooltip elements", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1, author: "Alice" },
    ]);
    expect(html).not.toContain("mrsf-tooltip");
    expect(html).not.toContain("mrsf-thread");
    expect(html).not.toContain("mrsf-comment");
    expect(html).not.toContain("mrsf-replies");
  });

  it("should not contain inline highlight marks", () => {
    const html = render("Hello world\n", [
      { id: "c1", text: "Note", line: 1, selected_text: "Hello" },
    ]);
    expect(html).not.toContain("<mark");
    expect(html).not.toContain("mrsf-highlight");
    expect(html).not.toContain("mrsf-inline-anchor");
  });

  it("should not contain gutter containers", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Comment", line: 1 },
    ]);
    expect(html).not.toContain("mrsf-gutter-container");
    expect(html).not.toContain("mrsf-gutter-right");
    expect(html).not.toContain("mrsf-gutter-left");
    expect(html).not.toContain("mrsf-gutter-tight");
  });

  it("should not contain action buttons", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ]);
    expect(html).not.toContain("mrsf-action-btn");
    expect(html).not.toContain("mrsf-actions");
    expect(html).not.toContain('data-mrsf-action=');
  });
});

// ── Edge cases ─────────────────────────────────────────────

describe("edge cases", () => {
  it("should handle comments without line numbers gracefully", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Unanchored" },
    ]);
    expect(html).not.toContain("mrsf-line-highlight");
    expect(parseDataScript(html)).toBeNull();
  });

  it("should handle line numbers beyond document length", () => {
    const html = render("# Short\n", [
      { id: "c1", text: "Beyond", line: 999 },
    ]);
    expect(html).toMatch(/<h1\b/);
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

// ── JSON data safety ───────────────────────────────────────

describe("JSON data safety", () => {
  it("should safely encode HTML in comment text within JSON", () => {
    const html = render("# Title\n", [
      { id: "c1", text: '<script>alert("xss")</script>', line: 1 },
    ]);
    // The script content must not contain raw < chars — they are \u003c-escaped
    const scriptMatch = html.match(
      /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1]).not.toContain("<");
    // But when parsed, the original text is recovered
    const data = JSON.parse(scriptMatch![1]);
    expect(data.threads[0].comment.text).toBe('<script>alert("xss")</script>');
  });

  it("should safely encode HTML in author name within JSON", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Comment", line: 1, author: '<b>Evil</b>' },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.author).toBe("<b>Evil</b>");
  });
});

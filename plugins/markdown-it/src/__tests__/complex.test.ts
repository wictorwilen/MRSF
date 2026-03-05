/**
 * Advanced tests for @mrsf/markdown-it-mrsf plugin using a complex markdown fixture.
 *
 * These tests exercise every block-element type: headings (h1–h3),
 * paragraphs, blockquotes, ordered/unordered/nested lists, tables,
 * code fences, horizontal rules, images, and text with inline formatting.
 *
 * Each test verifies that the overlay gutter architecture correctly:
 *   - Annotates the right elements with data-mrsf-line attributes
 *   - Optionally applies mrsf-line-highlight when lineHighlight is enabled
 *   - Embeds accurate thread data in the <script> tag
 *   - Preserves native HTML structure (no injected wrappers/badges)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "../index.js";
import type { MrsfPluginOptions } from "../types.js";
import type { MrsfDocument } from "@mrsf/cli";
import { parseSidecarContent } from "@mrsf/cli";

// ── Fixture loading ────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../../shared/src/__fixtures__");

const complexMd = readFileSync(path.join(fixturesDir, "complex.md"), "utf-8");
const complexYaml = readFileSync(
  path.join(fixturesDir, "complex.md.review.yaml"),
  "utf-8",
);

let sidecar: MrsfDocument;

beforeAll(() => {
  sidecar = parseSidecarContent(complexYaml, "complex.md.review.yaml");
});

/** Render the complex markdown with all comments. */
function renderComplex(opts?: Partial<MrsfPluginOptions>): string {
  const md = new MarkdownIt();
  md.use(mrsfPlugin, {
    comments: sidecar,
    ...opts,
  });
  return md.render(complexMd);
}

/** Render arbitrary markdown with a subset of comments. */
function renderWith(
  markdown: string,
  comments: Partial<MrsfDocument["comments"][number]>[],
  opts?: Partial<MrsfPluginOptions>,
): string {
  const doc: MrsfDocument = {
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
  const md = new MarkdownIt();
  md.use(mrsfPlugin, { comments: doc, ...opts });
  return md.render(markdown);
}

/** Parse the embedded JSON data from the script tag. */
function parseDataScript(html: string): { threads: any[] } | null {
  const match = html.match(
    /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  return JSON.parse(match[1]);
}

/** Extract all data-mrsf-line values from the HTML. */
function extractAnnotatedLines(html: string): number[] {
  const re = /data-mrsf-line="(\d+)"/g;
  const lines: number[] = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    lines.push(Number(m[1]));
  }
  return [...new Set(lines)];
}

/** Count occurrences of mrsf-line-highlight in the HTML. */
function countHighlights(html: string): number {
  return (html.match(/mrsf-line-highlight/g) || []).length;
}

// ── Full document rendering ────────────────────────────────

describe("complex document — full render", () => {
  let html: string;
  let data: { threads: any[] };

  beforeAll(() => {
    html = renderComplex();
    data = parseDataScript(html)!;
  });

  it("should produce valid HTML with a data script", () => {
    expect(html).toContain('<script type="application/mrsf+json">');
    expect(data).not.toBeNull();
  });

  it("should embed all root-level threads (excluding replies)", () => {
    // 32 comments in sidecar, 4 are replies → 28 root threads
    expect(data.threads.length).toBe(28);
  });

  it("should thread replies correctly under their parents", () => {
    const bqThread = data.threads.find(
      (t: any) => t.comment.id === "bq-note",
    );
    expect(bqThread).toBeDefined();
    expect(bqThread.replies).toHaveLength(1);
    expect(bqThread.replies[0].id).toBe("bq-note-reply");
  });

  it("should thread multi-reply chains", () => {
    const migrateThread = data.threads.find(
      (t: any) => t.comment.id === "p-migrate",
    );
    expect(migrateThread).toBeDefined();
    expect(migrateThread.replies).toHaveLength(2);
    expect(migrateThread.replies[0].id).toBe("p-migrate-reply1");
    expect(migrateThread.replies[1].id).toBe("p-migrate-reply2");
  });

  it("should annotate many block elements", () => {
    const lines = extractAnnotatedLines(html);
    expect(lines.length).toBeGreaterThan(10);
  });

  it("should have highlight class on lines with comments when lineHighlight is enabled", () => {
    const hlHtml = renderComplex({ lineHighlight: true });
    expect(countHighlights(hlHtml)).toBeGreaterThan(0);
  });
});

// ── Heading annotations ────────────────────────────────────

describe("complex document — headings", () => {
  it("should annotate h1 with data-mrsf-line for line 1", () => {
    const html = renderComplex({ lineHighlight: true });
    expect(html).toMatch(/<h1[^>]*data-mrsf-line="1"[^>]*>/);
    expect(html).toMatch(/<h1[^>]*mrsf-line-highlight[^>]*>/);
  });

  it("should annotate h2 heading (line 5)", () => {
    const html = renderComplex({ lineHighlight: true });
    expect(html).toMatch(/<h2[^>]*data-mrsf-line="5"[^>]*>/);
    expect(html).toMatch(/<h2[^>]*mrsf-line-highlight[^>]*>/);
  });

  it("should annotate h3 heading (line 12)", () => {
    const html = renderComplex();
    expect(html).toMatch(/<h3[^>]*data-mrsf-line="12"[^>]*>/);
  });

  it("should not wrap heading content in extra elements", () => {
    const html = renderComplex();
    expect(html).not.toMatch(/<h1[^>]*>.*<div.*mrsf/);
    expect(html).not.toMatch(/<h1[^>]*>.*<span.*mrsf-badge/);
  });
});

// ── Paragraph annotations ──────────────────────────────────

describe("complex document — paragraphs", () => {
  it("should annotate paragraph with selected_text comment (line 3)", () => {
    const html = renderComplex({ lineHighlight: true });
    expect(html).toMatch(/<p[^>]*data-mrsf-line="3"[^>]*>/);
    expect(html).toMatch(/<p[^>]*mrsf-line-highlight[^>]*>/);
  });

  it("should annotate paragraph with inline code (line 7)", () => {
    const html = renderComplex();
    expect(html).toMatch(/<p[^>]*data-mrsf-line="7"[^>]*>/);
  });

  it("should preserve inline formatting inside paragraphs", () => {
    const html = renderComplex();
    // Line 7 has **Bearer token** and `Authorization`
    expect(html).toContain("<strong>Bearer token</strong>");
    expect(html).toContain("<code>Authorization</code>");
  });

  it("should not inject <mark> for selected_text comments", () => {
    const html = renderComplex();
    expect(html).not.toContain("<mark");
  });
});

// ── Blockquote annotations ─────────────────────────────────

describe("complex document — blockquotes", () => {
  it("should annotate blockquote content (lines 9-10)", () => {
    const html = renderComplex();
    // markdown-it produces <blockquote>\n<p>...</p>\n</blockquote>
    // The blockquote_open or the inner <p> should have the annotation
    const hasBqAnnotation = html.includes('data-mrsf-line="9"');
    expect(hasBqAnnotation).toBe(true);
  });

  it("should have highlight class on the blockquote comment", () => {
    const html = renderComplex({ lineHighlight: true });
    expect(html).toContain("mrsf-line-highlight");
  });

  it("should preserve blockquote structure", () => {
    const html = renderComplex();
    expect(html).toMatch(/<blockquote[^>]*>/);
  });
});

// ── List annotations ───────────────────────────────────────

describe("complex document — lists", () => {
  it("should annotate unordered list items (line 16)", () => {
    const html = renderComplex();
    expect(html).toMatch(/<li[^>]*data-mrsf-line="16"[^>]*>/);
  });

  it("should annotate nested list items (line 19)", () => {
    const html = renderComplex();
    // Nested list items in markdown-it get their own <li> tokens
    expect(html).toMatch(/<li[^>]*data-mrsf-line="19"[^>]*>/);
  });

  it("should annotate ordered list items (line 53)", () => {
    const html = renderComplex();
    expect(html).toMatch(/<li[^>]*data-mrsf-line="53"[^>]*>/);
  });

  it("should annotate nested ordered list items (line 56)", () => {
    const html = renderComplex();
    expect(html).toMatch(/<li[^>]*data-mrsf-line="56"[^>]*>/);
  });

  it("should annotate deeply nested list item (line 110)", () => {
    const html = renderComplex();
    expect(html).toMatch(/<li[^>]*data-mrsf-line="110"[^>]*>/);
  });

  it("should not wrap <li> in extra divs", () => {
    const html = renderComplex();
    expect(html).not.toMatch(/<li[^>]*>.*<div.*mrsf-line-row/);
  });
});

// ── Table annotations ──────────────────────────────────────

describe("complex document — tables", () => {
  it("should produce clean <table> elements", () => {
    const html = renderComplex();
    expect(html).toMatch(/<table[^>]*>/);
    expect(html).toMatch(/<thead[^>]*>/);
    expect(html).toMatch(/<tbody[^>]*>/);
  });

  it("should not inject spans inside table structure", () => {
    const html = renderComplex();
    expect(html).not.toMatch(/<table[^>]*>[\s]*<span/);
    expect(html).not.toMatch(/<thead[^>]*>[\s]*<span/);
    expect(html).not.toMatch(/<tbody[^>]*>[\s]*<span/);
  });

  it("should not inject badges or tooltips inside tables", () => {
    const html = renderComplex();
    expect(html).not.toContain("mrsf-badge");
    expect(html).not.toContain("mrsf-tooltip");
  });

  it("should have thread data for table-row comments", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const tblFree = data.threads.find((t: any) => t.comment.id === "tbl-free");
    expect(tblFree).toBeDefined();
    expect(tblFree.comment.line).toBe(26);

    const tblBiz = data.threads.find(
      (t: any) => t.comment.id === "tbl-business",
    );
    expect(tblBiz).toBeDefined();
    expect(tblBiz.comment.line).toBe(28);
  });
});

// ── Code fence annotations ─────────────────────────────────

describe("complex document — code fences", () => {
  it("should annotate element for JSON code fence (line 40)", () => {
    const html = renderComplex();
    // markdown-it uses fence tokens; the <code> or container should be annotated
    expect(html).toContain('data-mrsf-line="40"');
  });

  it("should annotate element for TypeScript code fence (line 62)", () => {
    const html = renderComplex();
    expect(html).toContain('data-mrsf-line="62"');
  });

  it("should annotate element for YAML code fence (line 78)", () => {
    const html = renderComplex();
    expect(html).toContain('data-mrsf-line="78"');
  });

  it("should preserve <pre><code> structure", () => {
    const html = renderComplex();
    expect(html).toMatch(/<pre><code/);
    expect(html).not.toMatch(/<div[^>]*mrsf[^>]*>[\s]*<pre/);
  });

  it("should have code fence comments in thread data with replies", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const codeJson = data.threads.find(
      (t: any) => t.comment.id === "code-json",
    );
    expect(codeJson).toBeDefined();
    expect(codeJson.comment.severity).toBe("medium");

    const codeTs = data.threads.find((t: any) => t.comment.id === "code-ts");
    expect(codeTs).toBeDefined();
    expect(codeTs.replies).toHaveLength(1);
    expect(codeTs.replies[0].id).toBe("code-ts-reply");
  });
});

// ── Thread data integrity ──────────────────────────────────

describe("complex document — thread data integrity", () => {
  it("should preserve severity across all comments", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const highSeverity = data.threads.filter(
      (t: any) => t.comment.severity === "high",
    );
    // h2-auth, ul-nested, code-ts, p-migrate, bq-step4
    expect(highSeverity.length).toBe(5);
  });

  it("should preserve comment types", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const suggestions = data.threads.filter(
      (t: any) => t.comment.type === "suggestion",
    );
    // h1-title, bq-note, h3-token, ol-admin, code-yaml, tbl-business, tbl-email, p-intro-inline, bq-step2
    expect(suggestions.length).toBe(9);
  });

  it("should preserve selected_text values", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const withSelectedText = data.threads.filter(
      (t: any) => t.comment.selected_text,
    );
    // p-intro, p-bearer, p-jwt, p-429, p-intro-inline, p-auth-header
    expect(withSelectedText.length).toBe(6);
    expect(withSelectedText.map((t: any) => t.comment.selected_text)).toContain(
      "Bearer token",
    );
  });

  it("should preserve author information", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const authors = new Set(data.threads.map((t: any) => t.comment.author));
    expect(authors).toContain("Alice");
    expect(authors).toContain("Bob");
    expect(authors).toContain("Charlie");
    expect(authors).toContain("Diana");
  });

  it("should include resolved comments by default", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const resolved = data.threads.filter(
      (t: any) => t.comment.resolved === true,
    );
    expect(resolved.length).toBe(1);
    expect(resolved[0].comment.id).toBe("p-resolved");
  });

  it("should exclude resolved comments when showResolved is false", () => {
    const html = renderComplex({ showResolved: false });
    const data = parseDataScript(html)!;
    const resolved = data.threads.filter(
      (t: any) => t.comment.resolved === true,
    );
    expect(resolved.length).toBe(0);
    // Total threads should be 27 (28 - 1 resolved)
    expect(data.threads.length).toBe(27);
  });
});

// ── DOM cleanliness ────────────────────────────────────────

describe("complex document — DOM cleanliness", () => {
  it("should not contain any badge elements", () => {
    const html = renderComplex();
    expect(html).not.toContain("mrsf-badge");
    expect(html).not.toContain("💬");
  });

  it("should not contain any tooltip elements", () => {
    const html = renderComplex();
    expect(html).not.toContain("mrsf-tooltip");
    expect(html).not.toContain("mrsf-thread");
    expect(html).not.toContain("mrsf-comment-body");
  });

  it("should not contain line-row wrappers", () => {
    const html = renderComplex();
    expect(html).not.toContain("mrsf-line-row");
    expect(html).not.toContain("mrsf-line-text");
    expect(html).not.toContain("mrsf-line-gutter");
  });

  it("should not contain gutter containers", () => {
    const html = renderComplex();
    expect(html).not.toContain("mrsf-gutter-container");
    expect(html).not.toContain("mrsf-gutter-left");
    expect(html).not.toContain("mrsf-gutter-right");
  });

  it("should not contain action buttons", () => {
    const html = renderComplex();
    expect(html).not.toContain("mrsf-action-btn");
    expect(html).not.toContain('data-mrsf-action=');
  });

  it("should not contain highlight marks", () => {
    const html = renderComplex();
    expect(html).not.toContain("<mark");
    expect(html).not.toContain("mrsf-highlight");
  });
});

// ── Specific element types ─────────────────────────────────

describe("complex document — specific elements", () => {
  it("should handle paragraph with strikethrough (line 114)", () => {
    const html = renderComplex();
    // The paragraph on line 114 has ~~2025-12-31~~ — verify line annotated
    expect(html).toContain('data-mrsf-line="114"');
  });

  it("should handle the last paragraph (line 118)", () => {
    const html = renderComplex();
    expect(html).toContain('data-mrsf-line="118"');
  });

  it("should handle paragraph after horizontal rule (line 30)", () => {
    const html = renderComplex();
    expect(html).toContain('data-mrsf-line="30"');
  });

  it("should produce a horizontal rule element", () => {
    const html = renderComplex();
    expect(html).toMatch(/<hr/);
  });

  it("should preserve image elements", () => {
    const html = renderComplex();
    expect(html).toContain("api-arch.png");
    expect(html).toContain("API Architecture");
  });

  it("should preserve link elements in paragraphs", () => {
    const html = renderComplex();
    expect(html).toContain("https://jwt.io");
    expect(html).toContain("JWT standard");
  });
});

// ── Multi-line block detection ─────────────────────────────

describe("complex document — multi-line blocks", () => {
  it("should set data-mrsf-start-line and data-mrsf-end-line on code fences", () => {
    const html = renderComplex();
    // The JSON code fence spans lines 40-47 (markdown-it maps lines 0-based internally)
    // fence token map should include the full range
    expect(html).toContain('data-mrsf-start-line=');
    expect(html).toContain('data-mrsf-end-line=');
  });

  it("should set line ranges on blockquotes", () => {
    const html = renderComplex();
    // blockquote_open should carry line range attributes
    expect(html).toMatch(
      /<blockquote[^>]*data-mrsf-start-line="9"[^>]*>/,
    );
  });

  it("should set line ranges on list containers", () => {
    const html = renderComplex();
    // bullet_list_open starting at line 16 should carry line range
    expect(html).toMatch(/<ul[^>]*data-mrsf-start-line="16"[^>]*>/);
  });
});

// ── Edge cases with complex content ────────────────────────

describe("complex document — edge cases", () => {
  it("should handle comments on adjacent lines without conflicts", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const bqThread = data.threads.find(
      (t: any) => t.comment.id === "bq-note",
    );
    expect(bqThread).toBeDefined();
    expect(bqThread.comment.line).toBe(9);
  });

  it("should handle multiple comments from different authors on same line", () => {
    const html = renderWith("# Title\n", [
      { id: "a1", text: "From Alice", line: 1, author: "Alice" },
      { id: "b1", text: "From Bob", line: 1, author: "Bob" },
    ]);
    const data = parseDataScript(html)!;
    expect(data.threads).toHaveLength(2);
    const authors = data.threads.map((t: any) => t.comment.author);
    expect(authors).toContain("Alice");
    expect(authors).toContain("Bob");
  });

  it("should handle deeply nested list comments correctly", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const depthThread = data.threads.find(
      (t: any) => t.comment.id === "ul-depth",
    );
    expect(depthThread).toBeDefined();
    expect(depthThread.comment.line).toBe(110);
    expect(depthThread.comment.severity).toBe("low");
  });

  it("should handle comments targeting both table rows", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const tableComments = data.threads.filter(
      (t: any) =>
        t.comment.id === "tbl-free" ||
        t.comment.id === "tbl-business" ||
        t.comment.id === "tbl-email",
    );
    expect(tableComments.length).toBe(3);
  });

  it("should handle all three code fences with different languages", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const codeComments = data.threads.filter(
      (t: any) =>
        t.comment.id === "code-json" ||
        t.comment.id === "code-ts" ||
        t.comment.id === "code-yaml",
    );
    expect(codeComments.length).toBe(3);
    expect(codeComments.find((t: any) => t.comment.id === "code-json")!.comment.line).toBe(40);
    expect(codeComments.find((t: any) => t.comment.id === "code-ts")!.comment.line).toBe(62);
    expect(codeComments.find((t: any) => t.comment.id === "code-yaml")!.comment.line).toBe(78);
  });

  it("should handle a document with no comments at all", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, {
      comments: {
        mrsf_version: "1.0",
        document: "empty.md",
        comments: [],
      } as MrsfDocument,
    });
    const html = md.render(complexMd);
    expect(html).not.toContain("mrsf-line-highlight");
    expect(html).not.toContain("application/mrsf+json");
    // But should still produce valid HTML
    expect(html).toContain("<h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre><code");
  });
});

// ── XSS safety in complex document ─────────────────────────

describe("complex document — XSS safety", () => {
  it("should escape < in embedded script data", () => {
    const html = renderWith("# Title\n", [
      { id: "xss1", text: '<img src=x onerror=alert(1)>', line: 1 },
    ]);
    const scriptMatch = html.match(
      /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1]).not.toContain("<");
    const data = JSON.parse(scriptMatch![1]);
    expect(data.threads[0].comment.text).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it("should handle script injection in selected_text", () => {
    const html = renderWith("Hello world\n", [
      {
        id: "xss2",
        text: "Note",
        line: 1,
        selected_text: '</script><script>alert(1)</script>',
      },
    ]);
    const scriptMatch = html.match(
      /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
    );
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1]).not.toContain("<");
  });
});

// ── Consistency between plugins ────────────────────────────

describe("complex document — cross-plugin consistency", () => {
  it("should embed the same number of threads as root comments", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    // Sidecar has 32 comments, 4 are replies → 28 root threads
    expect(data.threads.length).toBe(28);
    // Each reply should be nested
    const totalReplies = data.threads.reduce(
      (sum: number, t: any) => sum + (t.replies?.length || 0),
      0,
    );
    expect(totalReplies).toBe(4);
  });

  it("should preserve all comment IDs in thread data", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const allIds = new Set<string>();
    for (const t of data.threads) {
      allIds.add(t.comment.id);
      for (const r of t.replies || []) {
        allIds.add(r.id);
      }
    }
    // All 32 comment IDs should be present
    expect(allIds.size).toBe(32);
    expect(allIds).toContain("h1-title");
    expect(allIds).toContain("bq-note-reply");
    expect(allIds).toContain("p-migrate-reply2");
    expect(allIds).toContain("code-ts-reply");
  });
});

// ── Inline comment data (start_column / end_column) ────────

describe("complex document — inline comment data", () => {
  it("should include start_column and end_column in thread data", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const inlineComment = data.threads.find(
      (t: any) => t.comment.id === "p-intro-inline",
    );
    expect(inlineComment).toBeDefined();
    expect(inlineComment.comment.start_column).toBe(28);
    expect(inlineComment.comment.end_column).toBe(46);
  });

  it("should preserve selected_text on column-span comments", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const inlineComment = data.threads.find(
      (t: any) => t.comment.id === "p-intro-inline",
    );
    expect(inlineComment.comment.selected_text).toBe("public API surface");
  });

  it("should include column data for p-auth-header comment", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const authHeader = data.threads.find(
      (t: any) => t.comment.id === "p-auth-header",
    );
    expect(authHeader).toBeDefined();
    expect(authHeader.comment.start_column).toBe(54);
    expect(authHeader.comment.end_column).toBe(68);
    expect(authHeader.comment.selected_text).toBe("`Authorization`");
  });

  it("should include column data for p-429 comment", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const p429 = data.threads.find(
      (t: any) => t.comment.id === "p-429",
    );
    expect(p429).toBeDefined();
    expect(p429.comment.start_column).toBe(28);
    expect(p429.comment.end_column).toBe(51);
  });

  it("should have exactly 3 comments with start_column", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    const withColumns = data.threads.filter(
      (t: any) => t.comment.start_column != null,
    );
    expect(withColumns.length).toBe(3);
  });

  it("should coexist with line-level comments on the same line", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    // Line 3 has both p-intro (line-level) and p-intro-inline (column-span)
    const line3Threads = data.threads.filter(
      (t: any) => t.comment.line === 3,
    );
    expect(line3Threads.length).toBe(2);
    const ids = line3Threads.map((t: any) => t.comment.id);
    expect(ids).toContain("p-intro");
    expect(ids).toContain("p-intro-inline");
  });

  it("should support column-span comments with markdown syntax in selected_text", () => {
    const html = renderComplex();
    const data = parseDataScript(html)!;
    // p-auth-header has selected_text with backticks: "`Authorization`"
    const authHeader = data.threads.find(
      (t: any) => t.comment.id === "p-auth-header",
    );
    expect(authHeader.comment.selected_text).toContain("`");
    expect(authHeader.comment.type).toBe("issue");
    expect(authHeader.comment.severity).toBe("medium");
  });
});

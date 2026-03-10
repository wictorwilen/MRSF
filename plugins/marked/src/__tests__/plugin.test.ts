import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import { markedMrsf } from "../index.js";
import type { MrsfPluginOptions } from "../types.js";
import type { MrsfDocument } from "@mrsf/cli";

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

function render(
  markdown: string,
  comments: Partial<MrsfDocument["comments"][number]>[],
  opts?: Partial<MrsfPluginOptions>,
): string {
  const parser = new Marked();
  parser.use(markedMrsf({
    comments: makeSidecar(comments),
    ...opts,
  }));
  return parser.parse(markdown) as string;
}

function parseDataScript(html: string): { threads: any[] } | null {
  const match = html.match(/<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

describe("line annotation", () => {
  it("should annotate a heading for a line-anchored comment", () => {
    const html = render("# Hello\n\nWorld\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { lineHighlight: true });
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain("mrsf-line-highlight");
  });

  it("should annotate the correct paragraph line", () => {
    const html = render("Line one\n\nLine three\n", [
      { id: "c1", text: "Comment on line 3", line: 3 },
    ], { lineHighlight: true });
    expect(html).toContain('<p data-mrsf-line="3" data-mrsf-start-line="3" data-mrsf-end-line="3" class="mrsf-line-highlight">Line three</p>');
  });

  it("should annotate list items", () => {
    const html = render("- one\n- two\n", [
      { id: "c1", text: "Comment on second item", line: 2 },
    ], { lineHighlight: true });
    expect(html).toContain('<li data-mrsf-line="2" data-mrsf-start-line="2" data-mrsf-end-line="2" class="mrsf-line-highlight">two</li>');
  });

  it("should annotate table rows", () => {
    const html = render("| A | B |\n| - | - |\n| x | y |\n", [
      { id: "c1", text: "Comment on row", line: 3 },
    ], { lineHighlight: true });
    expect(html).toContain('<tr data-mrsf-line="3" data-mrsf-start-line="3" data-mrsf-end-line="3" class="mrsf-line-highlight">');
  });

  it("should not inject anything when no comments", () => {
    const parser = new Marked();
    parser.use(markedMrsf({ comments: makeSidecar([]) }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).not.toContain("mrsf-line-highlight");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("should load comments from a custom loader function", () => {
    const parser = new Marked();
    parser.use(markedMrsf({
      loader: () => makeSidecar([
        { id: "ldr1", text: "From loader", line: 1 },
      ]),
      lineHighlight: true,
    }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).toContain("mrsf-line-highlight");
    const data = parseDataScript(html);
    expect(data).not.toBeNull();
    expect(data!.threads[0].comment.text).toBe("From loader");
  });

  it("should prefer comments over loader", () => {
    const parser = new Marked();
    parser.use(markedMrsf({
      comments: makeSidecar([{ id: "inline1", text: "Inline", line: 1 }]),
      loader: () => makeSidecar([{ id: "ldr1", text: "Loader", line: 1 }]),
    }));
    const html = parser.parse("# Hello\n") as string;
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.text).toBe("Inline");
  });
});

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
  });

  it("should thread replies under their parent comment", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Root", line: 1 },
      { id: "r1", text: "Reply", reply_to: "c1" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads).toHaveLength(1);
    expect(data!.threads[0].replies).toHaveLength(1);
    expect(data!.threads[0].replies[0].text).toBe("Reply");
  });

  it("should include selected_text in thread data", () => {
    const html = render("Hello world\n", [
      { id: "c1", text: "Note", line: 1, selected_text: "Hello" },
    ]);
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.selected_text).toBe("Hello");
  });
});

describe("resolved comments", () => {
  it("should include resolved comments by default", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { lineHighlight: true });
    expect(html).toContain("mrsf-line-highlight");
    const data = parseDataScript(html);
    expect(data!.threads[0].comment.resolved).toBe(true);
  });

  it("should hide resolved comments when showResolved is false", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "Done", line: 1, resolved: true },
    ], { showResolved: false });
    expect(html).not.toContain("mrsf-line-highlight");
    expect(parseDataScript(html)).toBeNull();
  });
});

describe("no visual DOM injection", () => {
  it("should not contain badges, tooltips, or inline highlight markup", () => {
    const html = render("Hello world\n", [
      { id: "c1", text: "Note", line: 1, selected_text: "Hello" },
    ]);
    expect(html).not.toContain("mrsf-badge");
    expect(html).not.toContain("mrsf-tooltip");
    expect(html).not.toContain("<mark");
    expect(html).not.toContain('data-mrsf-action=');
  });
});
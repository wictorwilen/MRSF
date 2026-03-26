import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { Marked } from "marked";
import { markedMrsf } from "../index.js";
import type { MrsfPluginOptions } from "../types.js";
import type { MrsfDocument } from "@mrsf/cli";

const tempDirs: string[] = [];

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

function parseDataElement(html: string): { threads: any[] } | null {
  const match = html.match(/data-mrsf-json="([^"]+)"/);
  if (!match) return null;
  return JSON.parse(
    match[1]
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&"),
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

  it("should load comments from sidecarPath", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mrsf-marked-"));
    tempDirs.push(dir);
    const sidecarPath = path.join(dir, "doc.md.review.yaml");
    writeFileSync(sidecarPath, [
      'mrsf_version: "1.0"',
      'document: doc.md',
      'comments:',
      '  - id: from-sidecar',
      '    author: Tester',
      '    timestamp: "2026-01-01T00:00:00Z"',
      '    text: Loaded from sidecar',
      '    resolved: false',
      '    line: 1',
      '',
    ].join("\n"), "utf-8");

    const parser = new Marked();
    parser.use(markedMrsf({ sidecarPath, cwd: dir, lineHighlight: true }));
    const html = parser.parse("# Hello\n") as string;

    expect(parseDataScript(html)?.threads[0].comment.id).toBe("from-sidecar");
    expect(html).toContain("mrsf-line-highlight");
  });

  it("should load comments from documentPath auto-discovery", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mrsf-marked-"));
    tempDirs.push(dir);
    const sidecarPath = path.join(dir, "doc.md.review.yaml");
    writeFileSync(sidecarPath, [
      'mrsf_version: "1.0"',
      'document: doc.md',
      'comments:',
      '  - id: from-document',
      '    author: Tester',
      '    timestamp: "2026-01-01T00:00:00Z"',
      '    text: Loaded from document',
      '    resolved: false',
      '    line: 1',
      '',
    ].join("\n"), "utf-8");

    const parser = new Marked();
    parser.use(markedMrsf({ documentPath: "doc.md", cwd: dir }));
    const html = parser.parse("# Hello\n") as string;

    expect(parseDataScript(html)?.threads[0].comment.id).toBe("from-document");
  });

  it("should handle loader returning null", () => {
    const parser = new Marked();
    parser.use(markedMrsf({ loader: () => null }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).not.toContain("application/mrsf+json");
  });

  it("should handle loader errors gracefully", () => {
    const parser = new Marked();
    parser.use(markedMrsf({ loader: () => { throw new Error("boom"); } }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).not.toContain("application/mrsf+json");
  });

  it("should fall back to .review.json when yaml sidecar is missing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mrsf-marked-"));
    tempDirs.push(dir);
    const sidecarPath = path.join(dir, "doc.md.review.json");
    writeFileSync(sidecarPath, JSON.stringify({
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [{
        id: "from-json",
        author: "Tester",
        timestamp: "2026-01-01T00:00:00Z",
        text: "Loaded from json",
        resolved: false,
        line: 1,
      }],
    }), "utf-8");

    const parser = new Marked();
    parser.use(markedMrsf({ documentPath: "doc.md", cwd: dir }));
    const html = parser.parse("# Hello\n") as string;

    expect(parseDataScript(html)?.threads[0].comment.id).toBe("from-json");
  });

  it("should handle missing sidecarPath files gracefully", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mrsf-marked-"));
    tempDirs.push(dir);

    const parser = new Marked();
    parser.use(markedMrsf({ sidecarPath: "missing.review.yaml", cwd: dir }));
    const html = parser.parse("# Hello\n") as string;

    expect(html).not.toContain("application/mrsf+json");
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

  it("should support element data containers", () => {
    const html = render("# Title\n", [
      { id: "c1", text: "A comment", line: 1 },
    ], { dataContainer: "element", dataElementId: "custom-data" });
    expect(html).toContain('id="custom-data"');
    expect(html).not.toContain("application/mrsf+json");
    expect(parseDataElement(html)?.threads[0].comment.id).toBe("c1");
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
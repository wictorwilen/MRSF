import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { Marp } from "@marp-team/marp-core";
import { Marpit } from "@marp-team/marpit";
import { mrsfPlugin } from "../index.js";
import type { MrsfPluginOptions } from "../types.js";
import type { MrsfDocument } from "@mrsf/cli";

const tempDirs: string[] = [];

function makeSidecar(
  comments: Partial<MrsfDocument["comments"][number]>[],
): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "deck.md",
    comments: comments.map((comment, index) => ({
      id: comment.id ?? `c${index}`,
      author: comment.author ?? "Tester",
      timestamp: comment.timestamp ?? "2026-01-01T00:00:00Z",
      text: comment.text ?? `Comment ${index}`,
      resolved: comment.resolved ?? false,
      ...comment,
    })),
  } as MrsfDocument;
}

function render(
  markdown: string,
  comments: Partial<MrsfDocument["comments"][number]>[],
  opts?: Partial<MrsfPluginOptions>,
): string | string[] {
  const marpit = new Marpit();
  marpit.use(mrsfPlugin, {
    comments: makeSidecar(comments),
    ...opts,
  });
  return marpit.render(markdown).html;
}

function renderWithOptions(
  markdown: string,
  opts?: Partial<MrsfPluginOptions>,
): string | string[] {
  const marpit = new Marpit();
  marpit.use(mrsfPlugin, opts ?? {});
  return marpit.render(markdown).html;
}

function parseDataScript(html: string): { threads: any[] } | null {
  const match = html.match(
    /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

function parseDataElement(html: string): { threads: any[] } | null {
  const match = html.match(/data-mrsf-json="([^"]+)"/);
  if (!match) {
    return null;
  }

  const payload = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

  return JSON.parse(payload);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("@mrsf/marp-mrsf", () => {
  it("does not inject payloads or highlights when no comments are present", () => {
    const html = render("# First\n", []);

    expect(html).not.toContain("mrsf-line-highlight");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("does not inject payloads without sidecar data", () => {
    const html = renderWithOptions("# First\n") as string;

    expect(html).not.toContain("mrsf-line-highlight");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("adds page metadata to rendered sections", () => {
    const html = render("# First\n\n---\n\n# Second\n", [
      { id: "c1", line: 1, text: "Intro" },
      { id: "c2", line: 5, text: "Outro" },
    ]);

    expect(typeof html).toBe("string");
    expect(html as string).toContain('data-mrsf-page="1"');
    expect(html as string).toContain('data-mrsf-page="2"');
  });

  it("loads comments from a custom loader", () => {
    const html = renderWithOptions("# First\n", {
      loader: () => makeSidecar([{ id: "ldr1", line: 1, text: "From loader" }]),
      lineHighlight: true,
    }) as string;

    expect(html).toContain("mrsf-line-highlight");
    expect(parseDataScript(html)?.threads[0]?.comment?.text).toBe("From loader");
  });

  it("handles a loader returning null", () => {
    const html = renderWithOptions("# First\n", {
      loader: () => null,
    }) as string;

    expect(html).not.toContain("application/mrsf+json");
  });

  it("prefers inline comments over a custom loader", () => {
    const html = renderWithOptions("# First\n", {
      comments: makeSidecar([{ id: "inline1", line: 1, text: "Inline" }]),
      loader: () => makeSidecar([{ id: "ldr1", line: 1, text: "Loader" }]),
    }) as string;

    expect(parseDataScript(html)?.threads[0]?.comment?.text).toBe("Inline");
  });

  it("loads comments from sidecarPath", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mrsf-marp-"));
    tempDirs.push(dir);
    const sidecarPath = path.join(dir, "deck.md.review.yaml");

    writeFileSync(sidecarPath, [
      'mrsf_version: "1.0"',
      'document: deck.md',
      'comments:',
      '  - id: from-sidecar',
      '    author: Tester',
      '    timestamp: "2026-01-01T00:00:00Z"',
      '    text: Loaded from sidecar',
      '    resolved: false',
      '    line: 1',
      '',
    ].join("\n"), "utf-8");

    const html = renderWithOptions("# First\n", {
      sidecarPath,
      cwd: dir,
      lineHighlight: true,
    }) as string;

    expect(parseDataScript(html)?.threads[0]?.comment?.id).toBe("from-sidecar");
    expect(html).toContain("mrsf-line-highlight");
  });

  it("loads comments from documentPath auto-discovery", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mrsf-marp-"));
    tempDirs.push(dir);
    const sidecarPath = path.join(dir, "deck.md.review.yaml");

    writeFileSync(sidecarPath, [
      'mrsf_version: "1.0"',
      'document: deck.md',
      'comments:',
      '  - id: from-document',
      '    author: Tester',
      '    timestamp: "2026-01-01T00:00:00Z"',
      '    text: Loaded from document path',
      '    resolved: false',
      '    line: 1',
      '',
    ].join("\n"), "utf-8");

    const html = renderWithOptions("# First\n", {
      documentPath: "deck.md",
      cwd: dir,
    }) as string;

    expect(parseDataScript(html)?.threads[0]?.comment?.id).toBe("from-document");
  });

  it("annotates rendered content with MRSF line metadata", () => {
    const html = render("# First\n\nParagraph\n\n---\n\n# Second\n", [
      { id: "c1", line: 1, text: "Intro" },
      { id: "c2", line: 7, text: "Second title" },
    ], { lineHighlight: true }) as string;

    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain('data-mrsf-line="7"');
    expect(html).toContain('data-mrsf-start-line="1"');
    expect(html).toContain('data-mrsf-end-line="1"');
    expect(html).toContain("mrsf-line-highlight");
  });

  it("includes author, severity, type, selected_text, and resolved fields in thread payloads", () => {
    const html = render("# First\n", [
      {
        id: "c1",
        line: 1,
        text: "Annotated",
        author: "Alice",
        severity: "high",
        type: "suggestion",
        selected_text: "First",
        resolved: true,
      },
      {
        id: "r1",
        reply_to: "c1",
        text: "Reply",
        author: "Bob",
        selected_text: "First",
      },
    ]) as string;

    const payload = parseDataScript(html);

    expect(payload?.threads[0]?.comment?.author).toBe("Alice");
    expect(payload?.threads[0]?.comment?.severity).toBe("high");
    expect(payload?.threads[0]?.comment?.type).toBe("suggestion");
    expect(payload?.threads[0]?.comment?.selected_text).toBe("First");
    expect(payload?.threads[0]?.comment?.resolved).toBe(true);
    expect(payload?.threads[0]?.replies[0]?.author).toBe("Bob");
  });

  it("supports the element data container mode", () => {
    const html = render("# First\n", [
      { id: "c1", line: 1, text: "Inline payload" },
    ], {
      dataContainer: "element",
      dataElementId: "custom-mrsf-data",
    }) as string;

    expect(html).toContain('id="custom-mrsf-data"');
    expect(html).not.toContain("application/mrsf+json");
    expect(parseDataElement(html)?.threads[0]?.comment?.id).toBe("c1");
  });

  it("renders x_page comments on the matching Marp page", () => {
    const html = render("# First\n\n---\n\n# Second\n\nParagraph\n", [
      { id: "c1", x_page: 2, text: "Second page note" },
    ], { lineHighlight: true }) as string;

    const payload = parseDataScript(html);

    expect(html).toContain('data-mrsf-page="2"');
    expect(html).toContain("mrsf-line-highlight");
    expect(payload?.threads).toHaveLength(1);
    expect(payload?.threads[0]?.comment?.x_page).toBe(2);
    expect(payload?.threads[0]?.comment?.line).toBe(3);
  });

  it("keeps replies attached to x_page threads", () => {
    const html = render("# First\n\n---\n\n# Second\n", [
      { id: "c1", x_page: 2, text: "Second page note" },
      { id: "c2", reply_to: "c1", x_page: 2, text: "Reply" },
    ]) as string;

    const payload = parseDataScript(html);

    expect(payload?.threads[0]?.replies).toHaveLength(1);
    expect(payload?.threads[0]?.replies[0]?.x_page).toBe(2);
    expect(payload?.threads[0]?.replies[0]?.line).toBe(3);
  });

  it("keeps a single serialized payload per deck", () => {
    const html = render("# First\n\n---\n\n# Second\n", [
      { id: "c1", line: 1, text: "Intro" },
    ]) as string;

    const matches = html.match(/application\/mrsf\+json/g) || [];
    expect(matches).toHaveLength(1);
    expect(parseDataScript(html)?.threads).toHaveLength(1);
  });

  it("includes resolved comments by default and filters them when showResolved is false", () => {
    const included = render("# First\n", [
      { id: "c1", line: 1, text: "Resolved", resolved: true },
    ], { lineHighlight: true }) as string;
    expect(parseDataScript(included)?.threads).toHaveLength(1);
    expect(included).toContain("mrsf-line-highlight");

    const filtered = render("# First\n", [
      { id: "c1", line: 1, text: "Resolved", resolved: true },
    ], { showResolved: false }) as string;
    expect(parseDataScript(filtered)).toBeNull();
    expect(filtered).not.toContain("mrsf-line-highlight");
  });

  it("keeps unresolved comments when showResolved is false", () => {
    const html = render("# First\n", [
      { id: "c1", line: 1, text: "Open", resolved: false },
      { id: "c2", line: 1, text: "Done", resolved: true },
    ], { showResolved: false, lineHighlight: true }) as string;

    const payload = parseDataScript(html);
    expect(payload?.threads).toHaveLength(1);
    expect(payload?.threads[0]?.comment?.text).toBe("Open");
  });

  it("supports htmlAsArray output while tagging each page", () => {
    const marpit = new Marpit();
    marpit.use(mrsfPlugin, {
      comments: makeSidecar([{ id: "c1", line: 1, text: "Intro" }]),
    });
    const result = marpit.render("# First\n\n---\n\n# Second\n", { htmlAsArray: true });

    expect(Array.isArray(result.html)).toBe(true);
    const pages = result.html as string[];
    expect(pages[0]).toContain('data-mrsf-page="1"');
    expect(pages[1]).toContain('data-mrsf-page="2"');
    expect(pages.join("\n").match(/application\/mrsf\+json/g) || []).toHaveLength(1);
  });

  it("does not inject badges, tooltips, or inline mark elements into the rendered HTML", () => {
    const html = render("# First\n", [
      { id: "c1", line: 1, text: "Intro", selected_text: "First" },
    ]) as string;

    expect(html).not.toContain("mrsf-badge");
    expect(html).not.toContain("mrsf-tooltip");
    expect(html).not.toContain("<mark");
    expect(html).not.toContain('data-mrsf-action=');
  });

  it("tags SVG page containers in inlineSVG mode", () => {
    const marpit = new Marpit({ inlineSVG: true });
    marpit.use(mrsfPlugin, {
      comments: makeSidecar([
        { id: "c1", line: 1, text: "Intro" },
        { id: "c2", line: 5, text: "Outro" },
      ]),
    });

    const html = marpit.render("# First\n\n---\n\n# Second\n").html as string;

    expect(html).toContain('<svg data-marpit-svg="" viewBox="0 0 1280 720" data-mrsf-page="1">');
    expect(html).toContain('<svg data-marpit-svg="" viewBox="0 0 1280 720" data-mrsf-page="2">');
    expect(html).toContain('data-mrsf-line="1"');
  });

  it("works with Marp Core hosts", () => {
    const marp = new Marp();
    marp.use(mrsfPlugin, {
      comments: makeSidecar([
        { id: "c1", line: 1, text: "Intro" },
        { id: "c2", line: 5, text: "Outro" },
      ]),
      lineHighlight: true,
    });

    const html = marp.render("# First\n\n---\n\n# Second\n").html as string;

    expect(html).toContain('data-mrsf-page="1"');
    expect(html).toContain('data-mrsf-page="2"');
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain("mrsf-line-highlight");
    expect(html.match(/application\/mrsf\+json/g) || []).toHaveLength(1);
  });
});
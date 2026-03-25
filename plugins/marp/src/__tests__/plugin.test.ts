import { describe, it, expect } from "vitest";
import { Marp } from "@marp-team/marp-core";
import { Marpit } from "@marp-team/marpit";
import { mrsfPlugin } from "../index.js";
import type { MrsfPluginOptions } from "../types.js";
import type { MrsfDocument } from "@mrsf/cli";

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

function parseDataScript(html: string): { threads: any[] } | null {
  const match = html.match(
    /<script type="application\/mrsf\+json">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

describe("@mrsf/marp-mrsf", () => {
  it("adds page metadata to rendered sections", () => {
    const html = render("# First\n\n---\n\n# Second\n", [
      { id: "c1", line: 1, text: "Intro" },
      { id: "c2", line: 5, text: "Outro" },
    ]);

    expect(typeof html).toBe("string");
    expect(html as string).toContain('data-mrsf-page="1"');
    expect(html as string).toContain('data-mrsf-page="2"');
  });

  it("annotates rendered content with MRSF line metadata", () => {
    const html = render("# First\n\nParagraph\n\n---\n\n# Second\n", [
      { id: "c1", line: 1, text: "Intro" },
      { id: "c2", line: 7, text: "Second title" },
    ], { lineHighlight: true }) as string;

    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain('data-mrsf-line="7"');
    expect(html).toContain("mrsf-line-highlight");
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
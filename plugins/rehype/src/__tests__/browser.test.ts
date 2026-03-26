import { describe, it, expect, vi } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { rehypeMrsf } from "../browser.js";
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

async function renderWithPlugin(options: Record<string, unknown>): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeMrsf, options)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process("# Hello\n");
  return String(result);
}

describe("browser entry", () => {
  it("renders preloaded comments in browser-safe mode", async () => {
    const html = await renderWithPlugin({ comments: makeSidecar([{ id: "c1", line: 1, text: "Intro" }]) });
    expect(html).toContain('data-mrsf-line="1"');
  });

  it("loads comments from a browser-safe custom loader", async () => {
    const html = await renderWithPlugin({ loader: () => makeSidecar([{ id: "c1", line: 1, text: "Loader" }]) });
    expect(html).toContain("Loader");
  });

  it("prefers inline comments over a browser loader", async () => {
    const html = await renderWithPlugin({
      comments: makeSidecar([{ id: "c1", line: 1, text: "Inline" }]),
      loader: () => makeSidecar([{ id: "c2", line: 1, text: "Loader" }]),
    });
    expect(html).toContain("Inline");
    expect(html).not.toContain("Loader");
  });

  it("handles a browser loader returning null", async () => {
    const html = await renderWithPlugin({ loader: () => null });
    expect(html).not.toContain("application/mrsf+json");
  });

  it("warns when filesystem options are used in browser mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderWithPlugin({ documentPath: "doc.md" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns null when the browser loader throws", async () => {
    const html = await renderWithPlugin({ loader: () => { throw new Error("boom"); } });
    expect(html).not.toContain("application/mrsf+json");
  });
});
import { describe, it, expect, vi } from "vitest";
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "../browser.js";
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

describe("browser entry", () => {
  it("renders preloaded comments in browser-safe mode", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { comments: makeSidecar([{ id: "c1", line: 1, text: "Intro" }]) });

    const html = md.render("# Hello\n");
    expect(html).toContain('data-mrsf-line="1"');
  });

  it("loads comments from a browser-safe custom loader", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { loader: () => makeSidecar([{ id: "c1", line: 1, text: "Loader" }]) });

    const html = md.render("# Hello\n");
    expect(html).toContain("Loader");
  });

  it("prefers inline comments over a browser loader", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, {
      comments: makeSidecar([{ id: "c1", line: 1, text: "Inline" }]),
      loader: () => makeSidecar([{ id: "c2", line: 1, text: "Loader" }]),
    });

    const html = md.render("# Hello\n");
    expect(html).toContain("Inline");
    expect(html).not.toContain("Loader");
  });

  it("handles a browser loader returning null", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { loader: () => null });

    const html = md.render("# Hello\n");
    expect(html).not.toContain("application/mrsf+json");
  });

  it("warns when filesystem options are used in browser mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { documentPath: "doc.md" });

    md.render("# Hello\n");

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns null when the browser loader throws", () => {
    const md = new MarkdownIt();
    md.use(mrsfPlugin, { loader: () => { throw new Error("boom"); } });

    const html = md.render("# Hello\n");
    expect(html).not.toContain("application/mrsf+json");
  });
});
import { describe, it, expect, vi } from "vitest";
import { Marked } from "marked";
import { markedMrsf } from "../browser.js";
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
    const parser = new Marked();
    parser.use(markedMrsf({ comments: makeSidecar([{ id: "c1", line: 1, text: "Intro" }]) }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).toContain('data-mrsf-line="1"');
  });

  it("loads comments from a browser-safe custom loader", () => {
    const parser = new Marked();
    parser.use(markedMrsf({ loader: () => makeSidecar([{ id: "c1", line: 1, text: "Loader" }]) }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).toContain("Loader");
  });

  it("prefers inline comments over a browser loader", () => {
    const parser = new Marked();
    parser.use(markedMrsf({
      comments: makeSidecar([{ id: "c1", line: 1, text: "Inline" }]),
      loader: () => makeSidecar([{ id: "c2", line: 1, text: "Loader" }]),
    }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).toContain("Inline");
    expect(html).not.toContain("Loader");
  });

  it("handles a browser loader returning null", () => {
    const parser = new Marked();
    parser.use(markedMrsf({ loader: () => null }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).not.toContain("application/mrsf+json");
  });

  it("warns when filesystem options are used in browser mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parser = new Marked();
    parser.use(markedMrsf({ documentPath: "doc.md" }));
    parser.parse("# Hello\n");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("returns null when the browser loader throws", () => {
    const parser = new Marked();
    parser.use(markedMrsf({ loader: () => { throw new Error("boom"); } }));
    const html = parser.parse("# Hello\n") as string;
    expect(html).not.toContain("application/mrsf+json");
  });
});
import { describe, it, expect, vi } from "vitest";
import { Marpit } from "@marp-team/marpit";
import { mrsfPlugin } from "../browser.js";
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

describe("browser entry", () => {
  it("renders preloaded comments in browser-safe mode", () => {
    const marpit = new Marpit();
    marpit.use(mrsfPlugin, {
      comments: makeSidecar([{ id: "c1", line: 1, text: "Intro" }]),
    });

    const html = marpit.render("# First\n").html as string;
    expect(html).toContain('data-mrsf-line="1"');
    expect(html).toContain('data-mrsf-page="1"');
  });

  it("warns when filesystem options are used in browser mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const marpit = new Marpit();
    marpit.use(mrsfPlugin, { documentPath: "deck.md" });

    marpit.render("# First\n");

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
import { describe, expect, it } from "vitest";

describe("library entrypoints", () => {
  it("index re-exports the public Node API surface", async () => {
    const api = await import("../index.js");
    const discovery = await import("../lib/discovery.js");
    const parser = await import("../lib/parser.js");
    const writer = await import("../lib/writer.js");
    const validator = await import("../lib/validator.js");
    const git = await import("../lib/git.js");
    const reanchor = await import("../lib/reanchor.js");
    const comments = await import("../lib/comments.js");

    expect(api.findWorkspaceRoot).toBe(discovery.findWorkspaceRoot);
    expect(api.parseSidecar).toBe(parser.parseSidecar);
    expect(api.writeSidecar).toBe(writer.writeSidecar);
    expect(api.validateFile).toBe(validator.validateFile);
    expect(api.findRepoRoot).toBe(git.findRepoRoot);
    expect(api.reanchorFile).toBe(reanchor.reanchorFile);
    expect(api.addComment).toBe(comments.addComment);
    expect(api.summarize).toBe(comments.summarize);
  });

  it("browser re-exports the browser-safe API surface", async () => {
    const browser = await import("../browser.js");
    const fuzzy = await import("../lib/fuzzy.js");
    const reanchorCore = await import("../lib/reanchor-core.js");

    expect(browser.combinedScore).toBe(fuzzy.combinedScore);
    expect(browser.exactMatch).toBe(fuzzy.exactMatch);
    expect(browser.fuzzySearch).toBe(fuzzy.fuzzySearch);
    expect(browser.normalizedMatch).toBe(fuzzy.normalizedMatch);
    expect(browser.applyReanchorResults).toBe(reanchorCore.applyReanchorResults);
    expect(browser.reanchorComment).toBe(reanchorCore.reanchorComment);
    expect(browser.reanchorDocumentLines).toBe(reanchorCore.reanchorDocumentLines);
    expect(browser.toReanchorLines).toBe(reanchorCore.toReanchorLines);
  });
});
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
    const anchorContext = await import("../lib/anchor-context.js");
    const globalReconciliation = await import("../lib/global-reconciliation.js");
    const comments = await import("../lib/comments.js");
    const identity = await import("../lib/identity.js");
    const validateCore = await import("../lib/validate-core.js");

    expect(api.findWorkspaceRoot).toBe(discovery.findWorkspaceRoot);
    expect(api.parseSidecar).toBe(parser.parseSidecar);
    expect(api.writeSidecar).toBe(writer.writeSidecar);
    expect(api.validateFile).toBe(validator.validateFile);
    expect(api.findRepoRoot).toBe(git.findRepoRoot);
    expect(api.reanchorFile).toBe(reanchor.reanchorFile);
    expect(api.resolveAnchor).toBe(reanchor.resolveAnchor);
    expect(api.createAnchorContextIndex).toBe(
      anchorContext.createAnchorContextIndex,
    );
    expect(api.reconcileCommentAnchors).toBe(
      globalReconciliation.reconcileCommentAnchors,
    );
    expect(api.validateDocument).toBe(validateCore.validateDocument);
    expect(api.newCommentId).toBe(identity.newCommentId);
    expect(api.addComment).toBe(comments.addComment);
    expect(api.summarize).toBe(comments.summarize);
  });

  it("browser re-exports the browser-safe API surface", async () => {
    const browser = await import("../browser.js");
    const fuzzy = await import("../lib/fuzzy.js");
    const identity = await import("../lib/identity.js");
    const reanchorCore = await import("../lib/reanchor-core.js");
    const anchorContext = await import("../lib/anchor-context.js");
    const globalReconciliation = await import("../lib/global-reconciliation.js");
    const validateCore = await import("../lib/validate-core.js");

    expect(browser.combinedScore).toBe(fuzzy.combinedScore);
    expect(browser.exactMatch).toBe(fuzzy.exactMatch);
    expect(browser.fuzzySearch).toBe(fuzzy.fuzzySearch);
    expect(browser.normalizedMatch).toBe(fuzzy.normalizedMatch);
    expect(browser.applyReanchorResults).toBe(reanchorCore.applyReanchorResults);
    expect(browser.reanchorComment).toBe(reanchorCore.reanchorComment);
    expect(browser.reanchorDocumentLines).toBe(reanchorCore.reanchorDocumentLines);
    expect(browser.resolveAnchor).toBe(reanchorCore.resolveAnchor);
    expect(browser.toReanchorLines).toBe(reanchorCore.toReanchorLines);
    expect(browser.createAnchorContextIndex).toBe(
      anchorContext.createAnchorContextIndex,
    );
    expect(browser.reconcileCommentAnchors).toBe(
      globalReconciliation.reconcileCommentAnchors,
    );
    expect(browser.validateDocument).toBe(validateCore.validateDocument);
    expect(browser.newCommentId).toBe(identity.newCommentId);
  });
});

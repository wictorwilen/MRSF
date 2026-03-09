import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, Disposable, Uri } from "vscode";

import {
  registerDeleteComment,
  registerReplyToComment,
  registerResolveComment,
  registerUnresolveComment,
} from "../../commands/resolveReply.js";

function getRegisteredCommand(id: string) {
  const entry = __mock.commandRegistrations.find((command) => command.id === id);
  if (!entry) {
    throw new Error(`Command not registered: ${id}`);
  }
  return entry.callback;
}

describe("resolveReply commands", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    vi.useFakeTimers();
    __mock.configuration.set("sidemark.author", "Tester");
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("replies to a selected comment and refreshes the hover", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", text: "Original comment", author: "Alice", line: 3 }] },
      }),
      findComment: vi.fn().mockReturnValue({ id: "c1", text: "Original comment" }),
      replyToComment: vi.fn().mockResolvedValue(undefined),
    };

    registerReplyToComment(store as never);
    __mock.inputBoxResults.push("Reply text");

    await getRegisteredCommand("mrsf.replyToComment")("c1");
    vi.runAllTimers();

    expect(store.replyToComment).toHaveBeenCalledWith(uri, "c1", "Reply text", "Tester");
    expect(__mock.executedCommands).toContainEqual({ id: "editor.action.showHover", args: [] });
  });

  it("resolves a thread with cascading replies when chosen", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue({ uri, doc: { comments: [] } }),
      getCommentThreads: vi.fn().mockReturnValue(new Map([
        ["c1", [{ id: "c1" }, { id: "c2" }]],
      ])),
      resolveComment: vi.fn().mockResolvedValue(true),
    };

    registerResolveComment(store as never);
    __mock.quickPickResults.push({ label: "This comment + direct replies", cascade: true });

    await getRegisteredCommand("mrsf.resolveComment")("c1");
    vi.runAllTimers();

    expect(store.resolveComment).toHaveBeenCalledWith(uri, "c1", true);
    expect(__mock.executedCommands).toContainEqual({ id: "editor.action.showHover", args: [] });
  });

  it("unresolves a picked comment and reports missing comments", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", text: "Resolved", author: "Alice", line: 7, resolved: true }] },
      }),
      unresolveComment: vi.fn().mockResolvedValue(false),
    };

    registerUnresolveComment(store as never);
    __mock.quickPickResults.push({ commentId: "c1" });

    await getRegisteredCommand("mrsf.unresolveComment")();

    expect(store.unresolveComment).toHaveBeenCalledWith(uri, "c1");
    expect(__mock.errorMessages).toContain("Comment not found.");
  });

  it("deletes a thread with replies after confirmation", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue({ uri, doc: { comments: [] } }),
      getCommentThreads: vi.fn().mockReturnValue(new Map([
        ["c1", [{ id: "c1" }, { id: "c2" }]],
      ])),
      deleteComment: vi.fn().mockResolvedValue(true),
    };

    registerDeleteComment(store as never);
    __mock.quickPickResults.push(
      { label: "Delete with all replies", cascade: true },
    );
    __mock.warningMessageResult = "Delete";

    await getRegisteredCommand("mrsf.deleteComment")("c1");

    expect(store.deleteComment).toHaveBeenCalledWith(uri, "c1", true);
    expect(__mock.informationMessages).toContain("Comment deleted.");
  });

  it("warns when no active sidecar can be found", async () => {
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue(undefined),
    };

    registerReplyToComment(store as never);

    await getRegisteredCommand("mrsf.replyToComment")();

    expect(__mock.warningMessages).toContain("No review sidecar found.");
  });
});
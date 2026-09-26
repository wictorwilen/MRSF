import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, Disposable, Uri } from "vscode";
import * as vscode from "vscode";

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
    vscode.window.activeTextEditor = { document: { uri: Uri.file("/workspace/doc.md") } } as never;
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

    await getRegisteredCommand("mrsf.replyToComment")("c1", uri.toString());
    vi.runAllTimers();

    expect(store.getForActiveOrVisible).toHaveBeenCalledWith(uri);
    expect(store.replyToComment).toHaveBeenCalledWith(uri, "c1", "Reply text", "Tester");
    expect(__mock.executedCommands).toEqual([
      { id: "editor.action.hideHover", args: [] },
      { id: "editor.action.showHover", args: [{ focus: "noAutoFocus" }] },
    ]);
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
    expect(__mock.executedCommands).toEqual([
      { id: "editor.action.hideHover", args: [] },
      { id: "editor.action.showHover", args: [{ focus: "noAutoFocus" }] },
    ]);
  });

  it("refreshes at the hover position and restores the original selections", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const originalSelections = [new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 2))];
    const editor = {
      document: { uri, lineCount: 3, lineAt: () => ({ text: "Hello world" }) },
      selections: originalSelections,
      selection: originalSelections[0],
    };
    vscode.window.activeTextEditor = editor as never;
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue({ uri, doc: { comments: [] } }),
      unresolveComment: vi.fn().mockResolvedValue(true),
    };
    registerUnresolveComment(store as never);
    const execute = vi.spyOn(vscode.commands, "executeCommand").mockImplementation(async (command) => {
      if (command === "editor.action.showHover") {
        expect(editor.selection.active).toEqual(new vscode.Position(2, 1));
      }
      return undefined;
    });
    try {
      await getRegisteredCommand("mrsf.unresolveComment")("c1", uri.toString(), [2, 1]);
      expect(editor.selections).toBe(originalSelections);
      expect(execute).toHaveBeenCalledWith("editor.action.showHover", { focus: "noAutoFocus" });
    } finally {
      execute.mockRestore();
    }
  });

  it.each([true, false])("refreshes Unresolve only in the target editor (same editor: %s)", async (sameEditor) => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      getForActiveOrVisible: vi.fn().mockResolvedValue({ uri, doc: { comments: [] } }),
      unresolveComment: vi.fn().mockImplementation(async () => {
        if (!sameEditor) {
          vscode.window.activeTextEditor = { document: { uri: Uri.file("/workspace/other.md") } } as never;
        }
        return true;
      }),
    };
    registerUnresolveComment(store as never);

    await getRegisteredCommand("mrsf.unresolveComment")("c1", uri.toString());

    expect(__mock.executedCommands).toEqual(sameEditor ? [
      { id: "editor.action.hideHover", args: [] },
      { id: "editor.action.showHover", args: [{ focus: "noAutoFocus" }] },
    ] : []);
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
    expect(store.getForActiveOrVisible).toHaveBeenCalledTimes(1);
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
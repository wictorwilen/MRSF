import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, EventEmitter, Selection, Position, Uri } from "vscode";

const mockBuildReviewSnapshot = vi.fn();
const mockToCommentMap = vi.fn();

vi.mock("../../util/reviewSnapshot.js", () => ({
  buildReviewSnapshot: (...args: unknown[]) => mockBuildReviewSnapshot(...args),
  toCommentMap: (...args: unknown[]) => mockToCommentMap(...args),
}));

import { GutterDecorationProvider } from "../../decorations/GutterDecorationProvider.js";

function makeEditor(uri: Uri, lines = ["alpha", "beta text", "gamma", "delta"]) {
  return {
    document: {
      uri,
      languageId: "markdown",
      lineCount: lines.length,
      lineAt: (line: number) => ({ text: lines[line] ?? "" }),
    },
    selection: new Selection(new Position(0, 0), new Position(0, 0)),
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
  };
}

describe("GutterDecorationProvider", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    __mock.configuration.set("sidemark.gutterIcons", true);
    __mock.configuration.set("sidemark.showResolved", true);
  });

  it("creates the expected decoration types from extension media icons", () => {
    const store = { onDidChange: vi.fn().mockReturnValue(new vscode.Disposable()) };

    new GutterDecorationProvider(store as never, Uri.file("/ext"));

    expect(__mock.decorations).toHaveLength(4);
    expect(__mock.decorations[0]?.options).toMatchObject({
      gutterIconPath: expect.objectContaining({ fsPath: "/ext/media/icons/comment-open.svg" }),
      gutterIconSize: "contain",
    });
    expect(__mock.decorations[3]?.options).toMatchObject({
      gutterIconPath: expect.objectContaining({ fsPath: "/ext/media/icons/comment-multiple.svg" }),
    });
  });

  it("applies open, resolved, orphaned, and multiple gutter decorations with previews", () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeEditor(uri);
    const doc = { comments: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" }] };
    const comments = new Map([
      ["c1", { id: "c1", author: "Alice Example", text: "Open comment" }],
      ["c2", { id: "c2", author: "Bob Example", text: "Resolved comment", resolved: true }],
      ["c3", { id: "c3", author: "Carol Example", text: "Orphaned comment", x_reanchor_status: "orphaned" }],
      ["c4", { id: "c4", author: "Dan Example", text: "One" }],
      ["c5", { id: "c5", author: "Eve Example", text: "Two", resolved: true }],
    ]);
    const storeChange = new EventEmitter<Uri>();
    const store = {
      onDidChange: vi.fn().mockImplementation(storeChange.event),
      get: vi.fn().mockReturnValue(doc),
    };
    mockBuildReviewSnapshot.mockReturnValue({
      gutterMarks: [
        { line: 1, threadCount: 1, resolvedState: "open" },
        { line: 2, threadCount: 1, resolvedState: "resolved" },
        { line: 3, threadCount: 1, resolvedState: "open" },
        { line: 4, threadCount: 2, resolvedState: "mixed" },
      ],
      threadsByLine: [
        { line: 1, threads: [{ rootCommentId: "c1", commentIds: ["c1"] }] },
        { line: 2, threads: [{ rootCommentId: "c2", commentIds: ["c2"] }] },
        { line: 3, threads: [{ rootCommentId: "c3", commentIds: ["c3"] }] },
        { line: 4, threads: [{ rootCommentId: "c4", commentIds: ["c4", "c5"] }, { rootCommentId: "c5", commentIds: ["c5"] }] },
      ],
    });
    mockToCommentMap.mockReturnValue(comments);

    const provider = new GutterDecorationProvider(store as never, Uri.file("/ext"));
    provider.update(editor as never);

    expect(mockBuildReviewSnapshot).toHaveBeenCalledWith(editor.document, doc, true);
    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(editor.setDecorations).mock.calls;
    expect(calls[0]?.[1][0]).toMatchObject({
      renderOptions: { after: { contentText: "  💬 Alice: Open comment" } },
    });
    expect(calls[1]?.[1][0]).toMatchObject({
      renderOptions: { after: { contentText: "  ✅ Bob: Resolved comment" } },
    });
    expect(calls[2]?.[1][0]).toMatchObject({
      renderOptions: { after: { contentText: "  ⚠️ orphaned — Carol: Orphaned comment" } },
    });
    expect(calls[3]?.[1][0]).toMatchObject({
      renderOptions: { after: { contentText: "  💬 3 comments (1 open)" } },
    });

    vscode.window.activeTextEditor = editor as never;
    storeChange.fire(uri);
    expect(editor.setDecorations).toHaveBeenCalledTimes(8);
  });

  it("clears decorations when disabled or when there is no cached document", () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeEditor(uri);
    const store = {
      onDidChange: vi.fn().mockReturnValue(new vscode.Disposable()),
      get: vi.fn().mockReturnValue(null),
    };

    const provider = new GutterDecorationProvider(store as never, Uri.file("/ext"));

    __mock.configuration.set("sidemark.gutterIcons", false);
    provider.update(editor as never);
    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
    for (const [, ranges] of vi.mocked(editor.setDecorations).mock.calls) {
      expect(ranges).toEqual([]);
    }

    vi.mocked(editor.setDecorations).mockClear();
    __mock.configuration.set("sidemark.gutterIcons", true);
    provider.update(editor as never);
    expect(editor.setDecorations).toHaveBeenCalledTimes(4);
    for (const [, ranges] of vi.mocked(editor.setDecorations).mock.calls) {
      expect(ranges).toEqual([]);
    }
  });

  it("updates only for active markdown editors and disposes all decorations", () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeEditor(uri);
    const nonMarkdownEditor = {
      ...editor,
      document: { ...editor.document, languageId: "plaintext" },
    };
    const store = {
      onDidChange: vi.fn().mockReturnValue(new vscode.Disposable()),
      get: vi.fn().mockReturnValue(null),
    };

    const provider = new GutterDecorationProvider(store as never, Uri.file("/ext"));
    vscode.window.activeTextEditor = nonMarkdownEditor as never;
    provider.updateActiveEditor();
    expect(editor.setDecorations).not.toHaveBeenCalled();

    vscode.window.activeTextEditor = editor as never;
    provider.updateActiveEditor();
    expect(editor.setDecorations).toHaveBeenCalledTimes(4);

    const disposeSpies = __mock.decorations.map((deco) => vi.spyOn(deco, "dispose"));
    provider.dispose();
    for (const spy of disposeSpies) {
      expect(spy).toHaveBeenCalled();
    }
  });
});
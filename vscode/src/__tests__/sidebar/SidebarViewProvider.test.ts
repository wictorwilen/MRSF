import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, EventEmitter, Position, Selection, Uri } from "vscode";

const mockRelativeTime = vi.fn();
const mockMrsfToVscodeRange = vi.fn();
const mockSetPreviewScrollTarget = vi.fn();

vi.mock("../../util/positions.js", () => ({
  relativeTime: (...args: unknown[]) => mockRelativeTime(...args),
  mrsfToVscodeRange: (...args: unknown[]) => mockMrsfToVscodeRange(...args),
}));

vi.mock("../../extension.js", () => ({
  setPreviewScrollTarget: (...args: unknown[]) => mockSetPreviewScrollTarget(...args),
}));

import { SidebarViewProvider } from "../../sidebar/SidebarViewProvider.js";

type MessageHandler = (message: unknown) => unknown;

function createWebviewView() {
  const receiveMessageEmitter = new EventEmitter<unknown>();
  const messages: unknown[] = [];

  let handler: MessageHandler | undefined;

  const webview = {
    options: undefined as unknown,
    html: "",
    onDidReceiveMessage: (callback: MessageHandler) => {
      handler = callback;
      return receiveMessageEmitter.event(callback);
    },
    postMessage: vi.fn(async (message: unknown) => {
      messages.push(message);
      return true;
    }),
  };

  return {
    webviewView: { webview },
    emitMessage: async (message: unknown) => {
      if (handler) {
        await handler(message);
      }
    },
    postedMessages: messages,
  };
}

function makeMarkdownEditor(uri: Uri, selection?: vscode.Selection) {
  return {
    document: {
      uri,
      languageId: "markdown",
      lineCount: 20,
      lineAt: (line: number) => ({ text: `line ${line}` }),
    },
    selection: selection ?? new Selection(new Position(0, 0), new Position(0, 0)),
    viewColumn: 2,
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
  };
}

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    onDidChange: vi.fn().mockImplementation(() => new vscode.Disposable()),
    get: vi.fn(),
    load: vi.fn(),
    replyToComment: vi.fn(),
    deleteComment: vi.fn(),
    resolveComment: vi.fn(),
    unresolveComment: vi.fn(),
    findComment: vi.fn(),
    ...overrides,
  };
}

describe("SidebarViewProvider", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    mockRelativeTime.mockReturnValue("just now");
    mockMrsfToVscodeRange.mockReturnValue(new vscode.Range(3, 0, 3, 5));
    __mock.configuration.set("sidemark.showResolved", true);
    __mock.configuration.set("sidemark.author", "Tester");
  });

  it("renders comments for the active markdown document and persists the doc uri", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeMarkdownEditor(uri);
    vscode.window.activeTextEditor = editor as never;

    const workspaceState = {
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn(),
    };
    const store = {
      onDidChange: vi.fn().mockImplementation(() => new vscode.Disposable()),
      get: vi.fn().mockReturnValue({
        comments: [
          {
            id: "c1",
            author: "Alice",
            text: "Root <comment>",
            timestamp: "2026-03-09T12:00:00Z",
            line: 3,
          },
          {
            id: "c2",
            reply_to: "c1",
            author: "Bob",
            text: "Reply",
            timestamp: "2026-03-09T12:01:00Z",
          },
        ],
      }),
      load: vi.fn(),
    };

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"), workspaceState as never);
    const view = createWebviewView();

    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);
    await Promise.resolve();

    expect(view.webviewView.webview.html).toContain("Root &lt;comment&gt;");
    expect(view.webviewView.webview.html).toContain("Reply");
    expect(view.webviewView.webview.html).toContain("1 open");
    expect(workspaceState.update).toHaveBeenCalledWith("mrsf.lastDocUri", uri.toString());
  });

  it("handles sidebar messages for reply, delete, sorting, and resolved visibility", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeMarkdownEditor(uri);
    vscode.window.activeTextEditor = editor as never;

    const store = {
      onDidChange: vi.fn().mockImplementation(() => new vscode.Disposable()),
      get: vi.fn().mockReturnValue({
        comments: [
          {
            id: "c1",
            author: "Alice",
            text: "First",
            timestamp: "2026-03-09T12:00:00Z",
            line: 8,
          },
          {
            id: "c2",
            author: "Bob",
            text: "Second",
            timestamp: "2026-03-09T13:00:00Z",
            line: 2,
            resolved: true,
          },
        ],
      }),
      load: vi.fn(),
      replyToComment: vi.fn(),
      deleteComment: vi.fn(),
      resolveComment: vi.fn(),
      unresolveComment: vi.fn(),
      findComment: vi.fn(),
    };

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();

    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);
    __mock.warningMessageResult = "Delete";

    await view.emitMessage({ type: "reply", parentId: "c1", text: "New reply" });
    await view.emitMessage({ type: "delete", commentId: "c1" });
    await view.emitMessage({ type: "sort", sortMode: "date" });
    await view.emitMessage({ type: "toggleResolved" });

    expect(store.replyToComment).toHaveBeenCalledWith(uri, "c1", "New reply", "Tester");
    expect(store.deleteComment).toHaveBeenCalledWith(uri, "c1");
    expect(__mock.warningMessages).toContain("Delete this comment?");
    expect(__mock.configuration.get("sidemark.showResolved")).toBe(false);

    const html = view.webviewView.webview.html;
    expect(html).toContain("sort-btn active");
    expect(html).not.toContain("Second");
  });

  it("reveals and highlights a comment in the sidebar", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeMarkdownEditor(uri);
    vscode.window.activeTextEditor = editor as never;

    const store = {
      onDidChange: vi.fn().mockImplementation(() => new vscode.Disposable()),
      get: vi.fn().mockReturnValue({
        comments: [
          {
            id: "c1",
            author: "Alice",
            text: "Target",
            timestamp: "2026-03-09T12:00:00Z",
            line: 4,
          },
        ],
      }),
      load: vi.fn(),
    };

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();
    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);

    await provider.revealComment(uri, "c1");
    await provider.highlightComment("c1");

    expect(__mock.executedCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mrsf.commentsView.focus" }),
      ]),
    );
    expect(view.webviewView.webview.html).toContain('data-highlight-comment-id="c1"');
    expect(view.postedMessages).toContainEqual({ type: "highlightComment", commentId: "c1" });
  });

  it("navigates in the source editor when one is visible", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const visibleEditor = makeMarkdownEditor(uri);
    vscode.window.visibleTextEditors = [visibleEditor as never];

    const store = {
      onDidChange: vi.fn().mockImplementation(() => new vscode.Disposable()),
      get: vi.fn().mockReturnValue({ comments: [] }),
      load: vi.fn(),
      findComment: vi.fn().mockReturnValue({ id: "c1", line: 4, text: "Target" }),
    };

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    (provider as any).currentDocUri = uri;

    await (provider as any).navigateToComment("c1");

    expect(__mock.showTextDocumentCalls[0]?.documentOrUri).toEqual(uri);
    expect(__mock.revealCalls).toHaveLength(1);
    expect(mockMrsfToVscodeRange).toHaveBeenCalled();
    expect(mockSetPreviewScrollTarget).not.toHaveBeenCalled();
  });

  it("refreshes the markdown preview when no source editor is visible", async () => {
    const uri = Uri.file("/workspace/doc.md");
    vscode.window.visibleTextEditors = [];
    vscode.window.tabGroups.all = [
      { tabs: [{ isActive: true, input: new vscode.TabInputWebview() }] },
    ] as never;

    const store = {
      onDidChange: vi.fn().mockImplementation(() => new vscode.Disposable()),
      get: vi.fn().mockReturnValue({ comments: [] }),
      load: vi.fn(),
      findComment: vi.fn().mockReturnValue({ id: "c1", line: 9, text: "Target" }),
    };

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    (provider as any).currentDocUri = uri;

    await (provider as any).navigateToComment("c1");

    expect(mockSetPreviewScrollTarget).toHaveBeenCalledWith(9);
    expect(__mock.executedCommands).toContainEqual({ id: "markdown.preview.refresh", args: [] });
  });

  it("restores the saved document uri and falls back to open markdown documents", async () => {
    const uri = Uri.file("/workspace/restored.md");
    const workspaceState = {
      get: vi.fn().mockReturnValue(uri.toString()),
      update: vi.fn(),
    };
    const store = createStore({
      get: vi.fn().mockReturnValue(undefined),
      load: vi.fn().mockResolvedValue(undefined),
    });

    vscode.window.activeTextEditor = undefined as never;
    vscode.window.visibleTextEditors = [];
    vscode.workspace.textDocuments = [
      {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: (line: number) => ({ text: `line ${line}` }),
      },
    ] as never;

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"), workspaceState as never);
    const view = createWebviewView();

    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);
    await Promise.resolve();

    expect(store.get).toHaveBeenCalledWith(uri);
    expect(store.load).toHaveBeenCalledWith(uri);
    expect(view.webviewView.webview.html).toContain("No MRSF sidecar found for this file.");
    expect(workspaceState.get).toHaveBeenCalledWith("mrsf.lastDocUri");
  });

  it("shows an empty state when no markdown document can be resolved", () => {
    const store = createStore();
    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();

    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);

    expect(view.webviewView.webview.html).toContain("No Markdown file open");
  });

  it("routes init, reanchor, resolve, unresolve and navigate messages", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeMarkdownEditor(uri);
    vscode.window.activeTextEditor = editor as never;

    const store = createStore({
      get: vi.fn().mockReturnValue({
        comments: [
          {
            id: "c1",
            author: "Alice",
            text: "First",
            timestamp: "2026-03-09T12:00:00Z",
            line: 3,
          },
        ],
      }),
    });

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();

    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);

    await view.emitMessage({ type: "init" });
    await view.emitMessage({ type: "reanchor" });
    await view.emitMessage({ type: "resolve", commentId: "c1" });
    await view.emitMessage({ type: "unresolve", commentId: "c1" });
    await view.emitMessage({ type: "navigate", commentId: "c1" });

    expect(__mock.executedCommands).toEqual(
      expect.arrayContaining([
        { id: "mrsf.addLineComment", args: [undefined, uri] },
        { id: "mrsf.reanchor", args: [uri] },
      ]),
    );
    expect(store.resolveComment).toHaveBeenCalledWith(uri, "c1");
    expect(store.unresolveComment).toHaveBeenCalledWith(uri, "c1");
    expect(store.findComment).toHaveBeenCalledWith(uri, "c1");
  });

  it("adds inline comments when a non-empty selection exists in the current markdown editor", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const selectedEditor = makeMarkdownEditor(
      uri,
      new Selection(new Position(2, 1), new Position(2, 4)),
    );
    vscode.window.activeTextEditor = selectedEditor as never;
    vscode.window.visibleTextEditors = [selectedEditor as never];

    const store = createStore({
      get: vi.fn().mockReturnValue({ comments: [] }),
    });

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();
    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);

    await view.emitMessage({ type: "addComment" });

    expect(__mock.showTextDocumentCalls).toContainEqual({
      documentOrUri: selectedEditor.document,
      options: { viewColumn: 2, preserveFocus: false },
    });
    expect(__mock.executedCommands).toContainEqual({ id: "mrsf.addInlineComment", args: [uri] });
  });

  it("falls back to line comments when there is no visible selection", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeMarkdownEditor(uri);
    vscode.window.activeTextEditor = editor as never;
    vscode.window.visibleTextEditors = [editor as never];

    const store = createStore({
      get: vi.fn().mockReturnValue({ comments: [] }),
    });

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();
    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);

    await view.emitMessage({ type: "addComment" });

    expect(__mock.executedCommands).toContainEqual({ id: "mrsf.addLineComment", args: [undefined, uri] });
  });

  it("renders orphaned, typed, and severity-tagged comments in the summary", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeMarkdownEditor(uri);
    editor.document.lineCount = 3;
    vscode.window.activeTextEditor = editor as never;

    const store = createStore({
      get: vi.fn().mockReturnValue({
        comments: [
          {
            id: "c1",
            author: "Alice",
            text: "Anchored",
            timestamp: "2026-03-09T12:00:00Z",
            line: 8,
            type: "nit",
            severity: "high",
          },
          {
            id: "c2",
            author: "Bob",
            text: "Resolved",
            timestamp: "2026-03-09T12:01:00Z",
            line: 2,
            resolved: true,
          },
          {
            id: "c3",
            author: "Cara",
            text: "Open",
            timestamp: "2026-03-09T12:02:00Z",
            line: 1,
          },
        ],
      }),
    });

    const provider = new SidebarViewProvider(store as never, Uri.file("/workspace/ext"));
    const view = createWebviewView();

    provider.resolveWebviewView(view.webviewView as never, {} as never, {} as never);
    await Promise.resolve();

    const html = view.webviewView.webview.html;
    expect(html).toContain("1 open · 1 resolved · <span class=\"orphan-count\">1 orphaned</span>");
    expect(html).toContain("badge orphaned");
    expect(html).toContain("badge type\">nit</span>");
    expect(html).toContain("severity-high\">high</span>");
    expect(html).toContain("title=\"Reanchor to fix orphaned anchor\"");
  });
});
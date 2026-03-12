import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, EventEmitter, Uri } from "vscode";
import * as fs from "node:fs";

const mockParseSidecarContent = vi.fn();

const mockStore = {
  load: vi.fn(),
  get: vi.fn(),
  checkStaleness: vi.fn(),
  clearPendingShifts: vi.fn(),
  applyLiveEdits: vi.fn(),
  reloadFromDisk: vi.fn(),
  reanchorComments: vi.fn(),
  applyReanchors: vi.fn(),
  getForActiveEditor: vi.fn(),
  findComment: vi.fn(),
  onDidChange: vi.fn(),
};
const mockStoreChangeEmitter = new EventEmitter<Uri>();
const mockStatusBar = {
  setCommentCount: vi.fn(),
  setStaleCount: vi.fn(),
  setDirtyAnchors: vi.fn(),
  withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
};
const mockSidebarProvider = {
  refresh: vi.fn(),
  revealComment: vi.fn(),
};
const mockGutterProvider = {
  update: vi.fn(),
  updateActiveEditor: vi.fn(),
};
const mockInlineProvider = {
  update: vi.fn(),
  updateActiveEditor: vi.fn(),
};
const mockSelectionCommentCodeLensProvider = {
  dispose: vi.fn(),
};
const mockReanchorController = {
  onReanchorComplete: undefined as undefined | ((uri: Uri) => void),
  register: vi.fn().mockReturnValue({ dispose: () => {} }),
};

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

vi.mock("@mrsf/cli", () => ({
  parseSidecarContent: (...args: unknown[]) => mockParseSidecarContent(...args),
}));

vi.mock("../store/SidecarStore.js", () => ({
  SidecarStore: class {
    constructor() {
      mockStore.onDidChange.mockImplementation(mockStoreChangeEmitter.event);
      return mockStore;
    }
  },
}));

vi.mock("../store/FileWatcher.js", () => ({
  FileWatcher: class {
    dispose(): void {}
  },
}));

vi.mock("../decorations/GutterDecorationProvider.js", () => ({
  GutterDecorationProvider: class {
    constructor() {
      return mockGutterProvider;
    }
  },
}));

vi.mock("../decorations/InlineDecorationProvider.js", () => ({
  InlineDecorationProvider: class {
    constructor() {
      return mockInlineProvider;
    }
  },
}));

vi.mock("../providers/HoverProvider.js", () => ({
  MrsfHoverProvider: class {
    dispose(): void {}
  },
}));

vi.mock("../providers/SelectionCommentCodeLensProvider.js", () => ({
  SelectionCommentCodeLensProvider: class {
    constructor() {
      return mockSelectionCommentCodeLensProvider;
    }
  },
}));

vi.mock("../sidebar/SidebarViewProvider.js", () => ({
  SidebarViewProvider: class {
    static readonly viewType = "mrsf.commentsView";
    constructor() {
      return mockSidebarProvider;
    }
  },
}));

vi.mock("../commands/addComment.js", () => ({
  registerAddLineComment: vi.fn().mockReturnValue({ dispose: () => {} }),
  registerAddInlineComment: vi.fn().mockReturnValue({ dispose: () => {} }),
}));

vi.mock("../commands/resolveReply.js", () => ({
  registerReplyToComment: vi.fn().mockReturnValue({ dispose: () => {} }),
  registerResolveComment: vi.fn().mockReturnValue({ dispose: () => {} }),
  registerUnresolveComment: vi.fn().mockReturnValue({ dispose: () => {} }),
  registerDeleteComment: vi.fn().mockReturnValue({ dispose: () => {} }),
}));

vi.mock("../reanchor/ReanchorController.js", () => ({
  ReanchorController: class {
    onReanchorComplete?: (uri: Uri) => void;

    constructor() {
      return mockReanchorController;
    }
  },
}));

vi.mock("../statusBar.js", () => ({
  MrsfStatusBar: class {
    constructor() {
      return mockStatusBar;
    }
  },
}));

import { activate, setPreviewScrollTarget } from "../extension.js";

function getRegisteredCommand(id: string) {
  const command = __mock.commandRegistrations.find((entry) => entry.id === id);
  if (!command) {
    throw new Error(`Missing command: ${id}`);
  }
  return command.callback;
}

describe("extension activate", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    mockStore.load.mockResolvedValue({ comments: [{ id: "c1" }] });
    mockStore.get.mockReturnValue({ comments: [{ id: "c1" }] });
    mockStore.getForActiveEditor.mockResolvedValue({
      uri: Uri.file("/workspace/doc.md"),
      doc: { comments: [{ id: "c1", line: 2 }] },
    });
    mockStore.checkStaleness.mockResolvedValue(0);
    mockStore.applyLiveEdits.mockReturnValue(true);
    mockStore.reloadFromDisk.mockResolvedValue(undefined);
    mockStore.reanchorComments.mockResolvedValue([
      { commentId: "c1", status: "anchored", score: 1 },
      { commentId: "c2", status: "orphaned", score: 0.2 },
    ]);
    mockStore.applyReanchors.mockResolvedValue(1);
    mockStore.findComment.mockReturnValue({ id: "c1", line: 2 });
    mockStoreChangeEmitter.dispose();
    __mock.configuration.set("sidemark.commentsEnabled", true);
    __mock.configuration.set("sidemark.previewComments", true);
    __mock.configuration.set("sidemark.previewGutterPosition", "left");
    __mock.configuration.set("sidemark.previewGutterForInline", true);
    __mock.configuration.set("sidemark.previewInlineHighlights", true);
    __mock.configuration.set("sidemark.previewLineHighlight", true);
    __mock.configuration.set("sidemark.reanchorOnSave", true);
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
  });

  it("registers core extension components and loads the active markdown file", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.emitActiveTextEditor({
      document: {
        uri,
        languageId: "markdown",
        lineCount: 3,
        lineAt: () => ({ text: "line" }),
      },
      selection: { isEmpty: true },
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never);

    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    const result = activate(context as never);
    await Promise.resolve();

    expect(mockStore.load).toHaveBeenCalledWith(uri);
    expect(__mock.commandRegistrations.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "mrsf.revealCommentInSidebar",
        "mrsf.navigateToComment",
        "mrsf.refreshComments",
      ]),
    );
    expect(__mock.webviewRegistrations[0]?.viewType).toBe("mrsf.commentsView");
    expect(__mock.uriHandlerRegistrations).toHaveLength(1);
    expect(result).toEqual(expect.objectContaining({ extendMarkdownIt: expect.any(Function) }));
  });

  it("renders preview payload from cached sidecar comments and preview meta scroll target", () => {
    const uri = Uri.file("/workspace/doc.md");
    mockStore.get.mockReturnValue({
      comments: [{ id: "c1", text: "hello" }],
    });

    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    const result = activate(context as never);
    const md = {
      core: { ruler: { push: vi.fn() } },
      renderer: { rules: {} as Record<string, (...args: unknown[]) => string> },
    };

    result.extendMarkdownIt(md);
    setPreviewScrollTarget(12);

    const html = md.renderer.rules["mrsf_comment_data"]([], 0, {}, { currentDocument: uri }) as string;
    const meta = md.renderer.rules["mrsf_preview_meta"]([], 0, {}, {}) as string;

    expect(html).toContain("mrsf-comment-data");
    expect(html).toContain("data-document-uri");
    expect(html).toContain("c1");
    expect(meta).toContain('data-scroll-to-line="12"');
  });

  it("handles extension URIs for revealing comments and opening add-line-comment targets", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    __mock.emitActiveTextEditor({
      document: {
        uri,
        languageId: "markdown",
        lineCount: 5,
        lineAt: () => ({ text: "line" }),
      },
      selection: { isEmpty: true },
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never);
    __mock.executedCommands.length = 0;
    const openDoc = {
      uri,
      languageId: "markdown",
      lineCount: 5,
      lineAt: () => ({ text: "line" }),
    };
    __mock.warningMessages.length = 0;
    activate(context as never);
    const handler = __mock.uriHandlerRegistrations[0]?.handler;
    __mock.executedCommands.length = 0;
    __mock.showTextDocumentCalls.length = 0;
    __mock.revealCalls.length = 0;
    __mock.lastShownEditor = undefined;
    __mock.configuration.set("sidemark.previewComments", true);
    (globalThis as any).structuredClone ??= (value: unknown) => value;
    const textDocument = {
      ...openDoc,
      getText: vi.fn(),
    };
    const workspace = await import("vscode");
    workspace.workspace.textDocuments = [textDocument as never];

    await handler?.handleUri(Uri.parse(`file://revealComment?documentUri=${encodeURIComponent(uri.toString())}&commentId=c1`));
    expect(mockSidebarProvider.revealComment).toHaveBeenCalledWith(uri, "c1");

    await handler?.handleUri(Uri.parse(`file://addLineComment?documentUri=${encodeURIComponent(uri.toString())}&line=3`));
    expect(__mock.showTextDocumentCalls).toHaveLength(1);
    expect(__mock.executedCommands).toContainEqual({
      id: "mrsf.addLineComment",
      args: [3, uri],
    });
    expect(__mock.revealCalls).toHaveLength(1);
  });

  it("refreshes comments from visible markdown editors and reacts to store changes", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    __mock.emitActiveTextEditor(undefined);
    __mock.emitVisibleTextEditors([
      {
        document: {
          uri,
          languageId: "markdown",
          lineCount: 3,
          lineAt: () => ({ text: "line" }),
        },
        selection: { isEmpty: true },
        setDecorations: vi.fn(),
        revealRange: vi.fn(),
      } as never,
    ]);

    activate(context as never);
    __mock.informationMessages.length = 0;
    __mock.executedCommands.length = 0;

    await getRegisteredCommand("mrsf.refreshComments")();

    expect(mockStore.load).toHaveBeenCalledWith(uri);
    expect(mockGutterProvider.updateActiveEditor).toHaveBeenCalled();
    expect(mockInlineProvider.updateActiveEditor).toHaveBeenCalled();
    expect(mockSidebarProvider.refresh).toHaveBeenCalled();
    expect(__mock.informationMessages).toContain("Sidemark comments refreshed.");

    mockStoreChangeEmitter.fire(uri);
    await Promise.resolve();

    expect(__mock.executedCommands).toContainEqual({ id: "markdown.preview.refresh", args: [] });
    expect(mockStatusBar.setCommentCount).toHaveBeenCalledWith(1);
  });

  it("refreshes editor and preview surfaces when sidemark settings change", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    __mock.emitActiveTextEditor({
      document: {
        uri,
        languageId: "markdown",
        lineCount: 3,
        lineAt: () => ({ text: "line" }),
      },
      selection: { isEmpty: true },
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never);

    activate(context as never);
    __mock.executedCommands.length = 0;

    __mock.emitDidChangeConfiguration("sidemark.commentsEnabled");

    expect(mockGutterProvider.updateActiveEditor).toHaveBeenCalled();
    expect(mockInlineProvider.updateActiveEditor).toHaveBeenCalled();
    expect(mockSidebarProvider.refresh).toHaveBeenCalled();
    expect(__mock.executedCommands).toContainEqual({ id: "markdown.preview.refresh", args: [] });
  });

  it("tracks live edits, reanchors on save, and clears markdown state when leaving markdown", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    activate(context as never);

    __mock.emitDidChangeTextDocument({
      document: { uri, languageId: "markdown" },
      contentChanges: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "abc" }],
    });

    expect(mockStore.applyLiveEdits).toHaveBeenCalledWith(uri, expect.any(Array));
    expect(mockStatusBar.setDirtyAnchors).toHaveBeenCalledWith(true);

    __mock.emitDidSaveTextDocument({ uri, languageId: "markdown" });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockStore.reloadFromDisk).toHaveBeenCalledWith(uri);
    expect(mockStore.reanchorComments).toHaveBeenCalledWith(uri, { threshold: 0.6 });
    expect(mockStore.applyReanchors).toHaveBeenCalledWith(uri, [
      { commentId: "c1", status: "anchored", score: 1 },
    ]);
    expect(mockStore.clearPendingShifts).toHaveBeenCalledWith(uri);
    expect(mockStatusBar.setDirtyAnchors).toHaveBeenLastCalledWith(false);

    __mock.emitActiveTextEditor({
      document: { uri: Uri.file("/workspace/file.txt"), languageId: "plaintext", lineCount: 1, lineAt: () => ({ text: "x" }) },
      selection: { isEmpty: true },
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never);

    expect(mockStatusBar.setStaleCount).toHaveBeenCalledWith(0);
  });

  it("renders preview data from disk fallbacks and skips invalid preview cases", () => {
    const uri = Uri.file("/workspace/doc.md");
    const context = {
      extensionUri: Uri.file("/workspace/ext"),
      subscriptions: [] as Array<{ dispose?: () => void }>,
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
    };

    mockStore.get.mockReturnValue(null);
    mockParseSidecarContent.mockReturnValue({ comments: [{ id: "disk" }] });
    vi.mocked(fs.existsSync).mockImplementation((candidate: any) => String(candidate).endsWith(".review.yaml"));
    vi.mocked(fs.readFileSync).mockReturnValue("comments: []" as never);

    const result = activate(context as never);
    const md = {
      core: { ruler: { push: vi.fn() } },
      renderer: { rules: {} as Record<string, (...args: unknown[]) => string> },
    };

    result.extendMarkdownIt(md);

    const fromStringUri = md.renderer.rules["mrsf_comment_data"]([], 0, {}, { currentDocument: uri.toString() }) as string;
    const fromObjectUri = md.renderer.rules["mrsf_comment_data"]([], 0, {}, { currentDocument: { fsPath: "/workspace/doc.md" } }) as string;

    expect(fromStringUri).toContain("data-comments");
    expect(fromObjectUri).toContain("disk");

    __mock.configuration.set("sidemark.commentsEnabled", false);
    expect(md.renderer.rules["mrsf_comment_data"]([], 0, {}, { currentDocument: uri }) as string).toBe("");
    __mock.configuration.set("sidemark.commentsEnabled", true);
    __mock.configuration.set("sidemark.previewComments", false);
    expect(md.renderer.rules["mrsf_comment_data"]([], 0, {}, { currentDocument: uri }) as string).toBe("");
    __mock.configuration.set("sidemark.previewComments", true);
    expect(md.renderer.rules["mrsf_comment_data"]([], 0, {}, { currentDocument: "relative.md" }) as string).toBe("");
  });
});
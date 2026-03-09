import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, Uri } from "vscode";
import { ReanchorController } from "../../reanchor/ReanchorController.js";

function getRegisteredCommand(id: string) {
  const command = __mock.commandRegistrations.find((entry) => entry.id === id);
  if (!command) {
    throw new Error(`Missing command: ${id}`);
  }
  return command.callback;
}

describe("ReanchorController", () => {
  beforeEach(() => {
    __mock.reset();
  });

  it("warns when no markdown review target can be resolved", async () => {
    const store = {
      get: vi.fn().mockReturnValue(null),
      load: vi.fn().mockResolvedValue(null),
      getForActiveEditor: vi.fn().mockResolvedValue(null),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);

    await (controller as any).runReanchor();

    expect(__mock.warningMessages).toContain(
      "No review sidecar found for the active Markdown file.",
    );
  });

  it("auto-applies anchored results and reports orphaned comments", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
    __mock.configuration.set("sidemark.reanchorAutoAcceptScore", 1);

    const store = {
      getForActiveEditor: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", line: 2, text: "hello" }] },
      }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }] }),
      reanchorComments: vi.fn().mockResolvedValue([
        { commentId: "c1", status: "anchored", score: 1, newLine: 3 },
        { commentId: "c2", status: "orphaned", score: 0, reason: "missing" },
      ]),
      applyReanchors: vi.fn().mockResolvedValue(1),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };
    const onComplete = vi.fn();

    const controller = new ReanchorController(store as never, statusBar as never);
    controller.onReanchorComplete = onComplete;

    await (controller as any).runReanchor();

    expect(store.applyReanchors).toHaveBeenCalledWith(uri, [
      expect.objectContaining({ commentId: "c1", status: "anchored" }),
    ]);
    expect(__mock.warningMessages).toContain(
      "1 comment(s) are orphaned — their anchored text could not be found.",
    );
    expect(__mock.informationMessages).toContain(
      "1 comment(s) reanchored successfully. 1 orphaned.",
    );
    expect(onComplete).toHaveBeenCalledWith(uri);
  });

  it("reviews uncertain results and accepts all remaining items", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
    __mock.configuration.set("sidemark.reanchorAutoAcceptScore", 1);
    __mock.quickPickResult = {
      label: "$(check-all) Accept All Remaining",
      description: "Accept all remaining",
      action: "acceptAll",
    };
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: () => ({ text: "example line" }),
      },
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      getForActiveEditor: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", line: 2, text: "hello" }] },
      }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }] }),
      reanchorComments: vi.fn().mockResolvedValue([
        {
          commentId: "c1",
          status: "shifted",
          score: 0.7,
          newLine: 4,
          reason: "shifted by edits",
        },
      ]),
      applyReanchors: vi.fn().mockResolvedValue(1),
      findComment: vi.fn().mockReturnValue({ id: "c1", line: 2, text: "hello" }),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);

    await (controller as any).runReanchor();

    expect(__mock.quickPickCalls).toHaveLength(1);
    expect(__mock.lastShownEditor).toBeDefined();
    expect(store.applyReanchors).toHaveBeenCalledWith(uri, [
      expect.objectContaining({ commentId: "c1", status: "shifted" }),
    ]);
    expect(__mock.informationMessages).toContain(
      "0 auto-accepted. 1 need(s) review.",
    );
    expect(__mock.informationMessages).toContain(
      "Reanchor complete: 1 comment(s) updated.",
    );
  });

  it("uses an explicit uri and reports when no comments need reanchoring", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
    const store = {
      get: vi.fn().mockReturnValue({ comments: [{ id: "c1" }] }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }] }),
      reanchorComments: vi.fn().mockResolvedValue([]),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };
    const onComplete = vi.fn();

    const controller = new ReanchorController(store as never, statusBar as never);
    controller.onReanchorComplete = onComplete;

    await (controller as any).runReanchor(uri);

    expect(store.load).toHaveBeenCalledWith(uri);
    expect(store.reanchorComments).toHaveBeenCalledWith(uri, { threshold: 0.6 });
    expect(__mock.informationMessages).toContain("No comments need reanchoring.");
    expect(onComplete).toHaveBeenCalledWith(uri);
  });

  it("falls back to visible and open markdown documents when there is no active editor", async () => {
    const visibleUri = Uri.file("/workspace/visible.md");
    const openUri = Uri.file("/workspace/open.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);

    const store = {
      getForActiveEditor: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockReturnValue(null),
      load: vi.fn()
        .mockResolvedValueOnce({ comments: [{ id: "c1" }] })
        .mockResolvedValueOnce({ comments: [{ id: "c2" }] }),
      reanchorComments: vi.fn().mockResolvedValue([]),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);

    vscode.window.visibleTextEditors = [
      {
        document: {
          uri: visibleUri,
          languageId: "markdown",
          lineCount: 5,
          lineAt: () => ({ text: "line" }),
        },
        selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        setDecorations: vi.fn(),
        revealRange: vi.fn(),
      } as never,
    ];

    await (controller as any).runReanchor();
    expect(store.load).toHaveBeenCalledWith(visibleUri);

    vscode.window.visibleTextEditors = [];
    vscode.workspace.textDocuments = [
      {
        uri: openUri,
        languageId: "markdown",
      } as never,
    ];
    store.load.mockClear();

    await (controller as any).runReanchor();
    expect(store.load).toHaveBeenCalledWith(openUri);
  });

  it("registers the command and routes it through runReanchor", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      get: vi.fn().mockReturnValue({ comments: [{ id: "c1" }] }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }] }),
      reanchorComments: vi.fn().mockResolvedValue([]),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);
    controller.register();

    await getRegisteredCommand("mrsf.reanchor")(uri);

    expect(store.load).toHaveBeenCalledWith(uri);
  });

  it("allows rejecting all remaining review items without applying changes", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
    __mock.configuration.set("sidemark.reanchorAutoAcceptScore", 1);
    __mock.quickPickResult = {
      label: "$(close-all) Reject All Remaining",
      description: "Keep all original positions",
      action: "rejectAll",
    };
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: () => ({ text: "example line" }),
      },
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      getForActiveEditor: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", line: 2, text: "hello" }] },
      }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }] }),
      reanchorComments: vi.fn().mockResolvedValue([
        { commentId: "c1", status: "shifted", score: 0.7, newLine: 4, reason: "shifted" },
      ]),
      applyReanchors: vi.fn(),
      findComment: vi.fn().mockReturnValue({ id: "c1", line: 2, text: "hello" }),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);
    await (controller as any).runReanchor();

    expect(store.applyReanchors).not.toHaveBeenCalled();
    expect(__mock.informationMessages).toContain("Reanchor review complete. No changes applied.");
  });

  it("finishes early without applying changes when review is cancelled", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
    __mock.configuration.set("sidemark.reanchorAutoAcceptScore", 1);
    __mock.quickPickResult = undefined;
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: () => ({ text: "example line" }),
      },
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      getForActiveEditor: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", line: 2, text: "hello" }] },
      }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }] }),
      reanchorComments: vi.fn().mockResolvedValue([
        { commentId: "c1", status: "shifted", score: 0.7, newLine: 4, reason: "shifted" },
      ]),
      applyReanchors: vi.fn(),
      findComment: vi.fn().mockReturnValue({ id: "c1", line: 2, text: "hello" }),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);
    await (controller as any).runReanchor();

    expect(store.applyReanchors).not.toHaveBeenCalled();
    expect(__mock.informationMessages).toContain("Reanchor review complete. No changes applied.");
  });

  it("reviews individual accept and skip decisions and cleans up decorations on dispose", async () => {
    const uri = Uri.file("/workspace/doc.md");
    __mock.configuration.set("sidemark.reanchorThreshold", 0.6);
    __mock.configuration.set("sidemark.reanchorAutoAcceptScore", 1);
    __mock.quickPickResults.push(
      {
        label: "$(check) Accept",
        description: "Move to line 4",
        action: "accept",
      },
      {
        label: "$(arrow-right) Skip",
        description: "Leave unchanged for now",
        action: "skip",
      },
    );
    const activeEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: () => ({ text: "example line" }),
      },
      selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    };
    vscode.window.activeTextEditor = activeEditor as never;

    const store = {
      getForActiveEditor: vi.fn().mockResolvedValue({
        uri,
        doc: { comments: [{ id: "c1", line: 2, text: "hello" }, { id: "c2", line: 5, text: "skip me" }] },
      }),
      load: vi.fn().mockResolvedValue({ comments: [{ id: "c1" }, { id: "c2" }] }),
      reanchorComments: vi.fn().mockResolvedValue([
        {
          commentId: "c1",
          status: "shifted",
          score: 0.7,
          newLine: 4,
          reason: "shifted by edits",
        },
        {
          commentId: "c2",
          status: "ambiguous",
          score: 0.65,
          newLine: 6,
          reason: "multiple candidates",
        },
      ]),
      applyReanchors: vi.fn().mockResolvedValue(1),
      findComment: vi.fn()
        .mockReturnValueOnce({ id: "c1", line: 2, text: "hello", start_column: 1, end_column: 4 })
        .mockReturnValueOnce({ id: "c2", line: 5, text: "skip me" }),
    };
    const statusBar = {
      withProgress: vi.fn().mockImplementation(async (_label, fn) => fn()),
    };

    const controller = new ReanchorController(store as never, statusBar as never);
    await (controller as any).runReanchor();

    expect(store.applyReanchors).toHaveBeenCalledWith(uri, [
      expect.objectContaining({ commentId: "c1" }),
    ]);
    expect(activeEditor.setDecorations).toHaveBeenCalled();
    expect(__mock.informationMessages).toContain("Reanchor complete: 1 comment(s) updated.");

    const pendingQuickPick = new Promise<undefined>(() => {});
    const originalShowQuickPick = vscode.window.showQuickPick;
    (vscode.window.showQuickPick as any) = vi.fn().mockReturnValue(pendingQuickPick);

    const secondController = new ReanchorController(store as never, statusBar as never);
    const runPromise = (secondController as any).runReanchor();
    await Promise.resolve();
    await Promise.resolve();
    secondController.dispose();

    const decorations = __mock.decorations;
    expect(decorations.length).toBeGreaterThan(0);
    (vscode.window.showQuickPick as any) = originalShowQuickPick;
    void runPromise;
  });
});
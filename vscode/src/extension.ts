/**
 * Extension entry point — activates and wires all MRSF components.
 */
import * as vscode from "vscode";
import { SidecarStore } from "./store/SidecarStore.js";
import { FileWatcher } from "./store/FileWatcher.js";
import { GutterDecorationProvider } from "./decorations/GutterDecorationProvider.js";
import { InlineDecorationProvider } from "./decorations/InlineDecorationProvider.js";
import { MrsfHoverProvider } from "./providers/HoverProvider.js";
import { SidebarViewProvider } from "./sidebar/SidebarViewProvider.js";
import {
  registerAddLineComment,
  registerAddInlineComment,
} from "./commands/addComment.js";
import {
  registerReplyToComment,
  registerResolveComment,
  registerUnresolveComment,
  registerDeleteComment,
} from "./commands/resolveReply.js";
import { ReanchorController } from "./reanchor/ReanchorController.js";
import { MrsfStatusBar } from "./statusBar.js";

export function activate(context: vscode.ExtensionContext): void {
  // ── Status bar ────────────────────────────────────────────
  const statusBar = new MrsfStatusBar();
  context.subscriptions.push(statusBar);

  // ── Core store ────────────────────────────────────────────
  const store = new SidecarStore();
  context.subscriptions.push(store);

  // ── File watcher ──────────────────────────────────────────
  const fileWatcher = new FileWatcher(store);
  context.subscriptions.push(fileWatcher);

  // ── Decoration providers ──────────────────────────────────
  const gutterProvider = new GutterDecorationProvider(
    store,
    context.extensionUri,
  );
  context.subscriptions.push(gutterProvider);

  const inlineProvider = new InlineDecorationProvider(store);
  context.subscriptions.push(inlineProvider);

  // ── Hover provider ────────────────────────────────────────
  const hoverProvider = new MrsfHoverProvider(store);
  context.subscriptions.push(hoverProvider);

  // ── Sidebar webview ───────────────────────────────────────
  const sidebarProvider = new SidebarViewProvider(store, context.extensionUri);
  context.subscriptions.push(sidebarProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider,
    ),
  );

  // ── Commands ──────────────────────────────────────────────
  context.subscriptions.push(registerAddLineComment(store));
  context.subscriptions.push(registerAddInlineComment(store));
  context.subscriptions.push(registerReplyToComment(store));
  context.subscriptions.push(registerResolveComment(store));
  context.subscriptions.push(registerUnresolveComment(store));
  context.subscriptions.push(registerDeleteComment(store));

  // Reanchor
  const reanchorController = new ReanchorController(store, statusBar);
  reanchorController.onReanchorComplete = (uri) => {
    dirtyDocs.delete(uri.fsPath);
    statusBar.setDirtyAnchors(dirtyDocs.size > 0);
  };
  context.subscriptions.push(reanchorController);
  context.subscriptions.push(reanchorController.register());

  // Navigate to comment
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mrsf.navigateToComment",
      async (commentId?: string) => {
        const active = await store.getForActiveEditor();
        if (!active) return;
        if (!commentId) return;
        const comment = store.findComment(active.uri, commentId);
        if (!comment || comment.line == null) return;

        const editor = await vscode.window.showTextDocument(active.uri);
        const line = Math.max(0, Math.min(comment.line - 1, editor.document.lineCount - 1));
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter,
        );
      },
    ),
  );

  // Refresh comments
  context.subscriptions.push(
    vscode.commands.registerCommand("mrsf.refreshComments", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") return;
      await statusBar.withProgress("Refreshing...", () =>
        store.load(editor.document.uri),
      );
      gutterProvider.updateActiveEditor();
      inlineProvider.updateActiveEditor();
      sidebarProvider.refresh();
      updateStatusCount(editor.document.uri);
      checkStaleness(editor.document.uri);
      vscode.window.showInformationMessage("Sidemark comments refreshed.");
    }),
  );

  // Helper: update status bar comment count
  function updateStatusCount(uri: vscode.Uri): void {
    const doc = store.get(uri);
    statusBar.setCommentCount(doc ? doc.comments.length : 0);
  }

  // Helper: run background staleness check and update status bar
  async function checkStaleness(uri: vscode.Uri): Promise<void> {
    try {
      const stale = await store.checkStaleness(uri);
      statusBar.setStaleCount(stale);
    } catch {
      // Best effort — don't fail the extension on git errors
      statusBar.setStaleCount(0);
    }
  }

  // Update count whenever store changes
  context.subscriptions.push(
    store.onDidChange((uri) => {
      updateStatusCount(uri);
      checkStaleness(uri);
    }),
  );

  // ── Reanchor on save ─────────────────────────────────────
  // Track documents with unsaved line changes — anchors may be drifted
  const dirtyDocs = new Set<string>();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== "markdown") return;
      const doc = store.get(e.document.uri);
      if (!doc || doc.comments.length === 0) return;

      // Detect line insertions / deletions
      for (const change of e.contentChanges) {
        const linesAdded =
          change.text.split("\n").length - 1;
        const linesRemoved =
          change.range.end.line - change.range.start.line;
        if (linesAdded !== linesRemoved) {
          dirtyDocs.add(e.document.uri.fsPath);
          statusBar.setDirtyAnchors(true);
          return;
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId !== "markdown") return;
      const config = vscode.workspace.getConfiguration("sidemark");
      if (!config.get<boolean>("reanchorOnSave", true)) return;

      const uri = document.uri;
      const doc = store.get(uri);
      if (!doc || doc.comments.length === 0) return;

      try {
        const threshold = config.get<number>("reanchorThreshold", 0.6);
        const results = await store.reanchorComments(uri, { threshold });
        if (results.length > 0) {
          // Auto-apply all anchored/shifted results silently
          const autoApply = results.filter(
            (r) => r.status === "anchored" || r.score >= 0.8,
          );
          if (autoApply.length > 0) {
            await store.applyReanchors(uri, autoApply);
          }
        }
      } catch {
        // Best effort — don't interrupt the user's save flow
      }

      // Clear dirty state after reanchor
      dirtyDocs.delete(document.uri.fsPath);
      statusBar.setDirtyAnchors(dirtyDocs.size > 0);
    }),
  );

  // ── Initial load ──────────────────────────────────────────
  // Load sidecar for current active editor if it's Markdown
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.languageId === "markdown") {
    statusBar.withProgress("Loading...", () =>
      store.load(activeEditor.document.uri),
    ).then(() => {
      gutterProvider.updateActiveEditor();
      inlineProvider.updateActiveEditor();
      updateStatusCount(activeEditor.document.uri);
      checkStaleness(activeEditor.document.uri);
    });
  }

  // Auto-load when switching editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && editor.document.languageId === "markdown") {
        await statusBar.withProgress("Loading...", () =>
          store.load(editor.document.uri),
        );
        gutterProvider.update(editor);
        inlineProvider.update(editor);
        updateStatusCount(editor.document.uri);
        checkStaleness(editor.document.uri);
      } else {
        // Clear stale warning when leaving markdown files
        statusBar.setStaleCount(0);
      }
    }),
  );
}

export function deactivate(): void {
  // All disposables auto-cleaned via context.subscriptions
}

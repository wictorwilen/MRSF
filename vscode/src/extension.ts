/**
 * Extension entry point — activates and wires all MRSF components.
 */
import * as vscode from "vscode";
import * as path from "node:path";
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
import { getPreviewScrollTarget } from "./util/previewNavigation.js";
import { onDidChangeDocumentContext, resolveDocumentUri } from "./util/documentContext.js";
export { setPreviewScrollTarget } from "./util/previewNavigation.js";

function resolvePreviewDocumentUri(env: unknown): vscode.Uri | null {
  if (!env || typeof env !== "object") return null;
  const currentDocument = (env as { currentDocument?: unknown }).currentDocument;
  if (!currentDocument) return null;

  if (typeof currentDocument === "string") {
    const uri = path.isAbsolute(currentDocument)
      ? vscode.Uri.file(currentDocument)
      : vscode.Uri.parse(currentDocument);
    return uri.scheme === "file" && path.isAbsolute(uri.fsPath) ? uri : null;
  }

  if (typeof currentDocument === "object" && "fsPath" in currentDocument) {
    const uri = currentDocument as vscode.Uri;
    return (!uri.scheme || uri.scheme === "file") && typeof uri.fsPath === "string" && path.isAbsolute(uri.fsPath)
      ? vscode.Uri.file(uri.fsPath) : null;
  }

  return null;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getPreviewOptions(uri?: vscode.Uri): {
  gutterPosition: "left" | "right";
  gutterForInline: boolean;
  inlineHighlights: boolean;
  lineHighlight: boolean;
} {
  const config = vscode.workspace.getConfiguration("sidemark", uri);
  const gutterPosition = config.get<"left" | "right">("previewGutterPosition", "left");

  return {
    gutterPosition,
    gutterForInline: config.get<boolean>("previewGutterForInline", true),
    inlineHighlights: config.get<boolean>("previewInlineHighlights", true),
    lineHighlight: config.get<boolean>("previewLineHighlight", true),
  };
}

async function handleExtensionUri(uri: vscode.Uri): Promise<void> {
  const action = uri.path.replace(/^\/+/, "");
  const params = new URLSearchParams(uri.query);
  const documentUriRaw = params.get("documentUri");
  if (!documentUriRaw) return;

  let documentUri: vscode.Uri;
  try {
    documentUri = vscode.Uri.parse(documentUriRaw);
    if (documentUri.scheme !== "file") return;
  } catch {
    return;
  }

  if (action === "revealComment") {
    const commentId = params.get("commentId");
    if (!commentId) return;
    await vscode.commands.executeCommand("mrsf.revealCommentInSidebar", documentUri, commentId);
    return;
  }

  if (action !== "addLineComment") return;

  const lineRaw = params.get("line");
  const line = Number(lineRaw);
  if (!Number.isSafeInteger(line) || line < 1) return;
  await vscode.commands.executeCommand("mrsf.addLineComment", line, documentUri);
}

export function activate(context: vscode.ExtensionContext) {
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
  const sidebarProvider = new SidebarViewProvider(store, context.extensionUri, context.workspaceState);
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
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mrsf.revealCommentInSidebar",
      async (documentUri: vscode.Uri, commentId: string) => {
        await sidebarProvider.revealComment(documentUri, commentId);
      },
    ),
  );
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: handleExtensionUri,
    }),
  );

  // Reanchor
  const reanchorController = new ReanchorController(store, statusBar);
  reanchorController.onReanchorComplete = (uri) => {
    dirtyDocs.delete(uri.fsPath);
    store.clearPendingShifts(uri);
    statusBar.setDirtyAnchors(dirtyDocs.size > 0);
  };
  context.subscriptions.push(reanchorController);
  context.subscriptions.push(reanchorController.register());

  // Navigate to comment
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mrsf.navigateToComment",
      async (commentId?: string, documentUri?: string | vscode.Uri) => {
        const explicitUri = typeof documentUri === "string" ? vscode.Uri.parse(documentUri) : documentUri;
        const active = await store.getForActiveOrVisible(explicitUri);
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
    vscode.commands.registerCommand("mrsf.refreshComments", async (explicitUri?: vscode.Uri) => {
      const docUri = explicitUri ?? resolveDocumentUri();
      if (!docUri) return;

      await statusBar.withProgress("Refreshing...", () =>
        store.load(docUri),
      );
      gutterProvider.updateActiveEditor();
      inlineProvider.updateActiveEditor();
      sidebarProvider.refresh();
      updateStatusCount(docUri);
      checkStaleness(docUri);
      vscode.window.showInformationMessage("Sidemark comments refreshed.");
    }),
  );

  // Helper: update status bar comment count
  function updateStatusCount(uri: vscode.Uri): void {
    if (resolveDocumentUri()?.toString() !== uri.toString()) return;
    const doc = store.get(uri);
    statusBar.setCommentCount(doc ? doc.comments.length : 0);
  }

  // Helper: run background staleness check and update status bar
  async function checkStaleness(uri: vscode.Uri): Promise<void> {
    try {
      const stale = await store.checkStaleness(uri);
      if (resolveDocumentUri()?.toString() === uri.toString()) statusBar.setStaleCount(stale);
    } catch {
      // Best effort — don't fail the extension on git errors
      if (resolveDocumentUri()?.toString() === uri.toString()) statusBar.setStaleCount(0);
    }
  }

  // Update count whenever store changes
  context.subscriptions.push(
    store.onDidChange((uri) => {
      updateStatusCount(uri);
      checkStaleness(uri);
      // Refresh Markdown preview so the markdown-it plugin re-reads the
      // sidecar and the preview script can update badges/tooltips.
      vscode.commands.executeCommand("markdown.preview.refresh");
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("sidemark")) {
        return;
      }

      gutterProvider.updateActiveEditor();
      inlineProvider.updateActiveEditor();
      sidebarProvider.refresh();
      vscode.commands.executeCommand("markdown.preview.refresh");
    }),
  );

  // ── Live line tracking + reanchor on save ──────────────────
  // Track documents with unsaved line changes — anchors may be drifted.
  // Comment positions are adjusted in memory immediately so decorations
  // stay aligned.  The real reanchor (fuzzy match) + persist happens on save.
  const dirtyDocs = new Set<string>();

  /**
   * Run the full reanchor cycle for a document: reload sidecar from disk,
   * run the reanchor algorithm against the current file content, auto-apply
   * high-confidence results, and clear the dirty-anchor indicator.
   *
   * Called both on explicit save (onDidSaveTextDocument) and when the
   * file is reloaded after an external write (e.g. by an AI agent writing
   * directly to disk via the MCP server).
   */
  async function runReanchor(uri: vscode.Uri): Promise<void> {
    const config = vscode.workspace.getConfiguration("sidemark");

    // Reload the sidecar from disk (original positions) before running
    // the full reanchor.  This ensures we anchor against the on-disk
    // state rather than the in-memory shifted positions.
    await store.reloadFromDisk(uri);

    const doc = store.get(uri);
    if (!doc || doc.comments.length === 0) {
      dirtyDocs.delete(uri.fsPath);
      statusBar.setDirtyAnchors(dirtyDocs.size > 0);
      return;
    }

    try {
      const threshold = config.get<number>("reanchorThreshold", 0.6);
      const results = await statusBar.withProgress("Reanchoring...", () =>
        store.reanchorComments(uri, { threshold }),
      );
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
      // Best effort — don't interrupt the user's flow
    }

    // Clear dirty state after reanchor
    store.clearPendingShifts(uri);
    dirtyDocs.delete(uri.fsPath);
    statusBar.setDirtyAnchors(dirtyDocs.size > 0);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (e.document.languageId !== "markdown") return;
      const doc = store.get(e.document.uri);
      if (!doc || doc.comments.length === 0) return;

      // Detect when the document has been reloaded from disk without the
      // user saving — for example, when an AI agent (MCP server or Copilot)
      // writes to the file directly on disk.  After such a reload the
      // document is clean (isDirty === false) and carries real content
      // changes, but there is no corresponding onDidSaveTextDocument event.
      // The live-tracker heuristic is unreliable for large replacements, so
      // we run a full reanchor instead.
      // Undo/redo operations can also leave the document clean, but they set
      // e.reason (1 = Undo, 2 = Redo) so we exclude them here.
      if (e.document.isDirty === false && e.contentChanges.length > 0 && !e.reason) {
        const config = vscode.workspace.getConfiguration("sidemark");
        if (config.get<boolean>("reanchorOnSave", true)) {
          await runReanchor(e.document.uri);
        }
        return;
      }

      // Apply line-shift adjustments to in-memory comments so
      // decorations track the edits in real-time.
      const moved = store.applyLiveEdits(e.document.uri, e.contentChanges);

      if (moved) {
        dirtyDocs.add(e.document.uri.fsPath);
        statusBar.setDirtyAnchors(true);
        // Decorations auto-update via store.onDidChange → providers
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId !== "markdown") return;
      const config = vscode.workspace.getConfiguration("sidemark");
      if (!config.get<boolean>("reanchorOnSave", true)) return;

      await runReanchor(document.uri);
    }),
  );

  async function loadCurrentDocument(): Promise<void> {
    const uri = resolveDocumentUri();
    if (!uri) {
      statusBar.setCommentCount(0);
      statusBar.setStaleCount(0);
      return;
    }
    await statusBar.withProgress("Loading...", () => store.ensureLoaded(uri));
    gutterProvider.updateActiveEditor();
    inlineProvider.updateActiveEditor();
    updateStatusCount(uri);
    void checkStaleness(uri);
  }

  async function loadVisibleDocuments(editors: readonly vscode.TextEditor[]): Promise<void> {
    for (const editor of editors) {
      if (editor.document.languageId !== "markdown") continue;
      await store.ensureLoaded(editor.document.uri);
      gutterProvider.update(editor);
      inlineProvider.update(editor);
    }
  }

  void loadCurrentDocument();
  void loadVisibleDocuments(vscode.window.visibleTextEditors);
  context.subscriptions.push(
    onDidChangeDocumentContext(() => { void loadCurrentDocument(); }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => { void loadVisibleDocuments(editors); }),
  );

  // ── Markdown preview integration ──────────────────────────
  // Return the markdown-it plugin interface so VS Code's Markdown
  // preview can embed comment data into rendered HTML.
  //
  // VS Code internally calls `engine.parse()` then
  // `engine.renderer.render()` — it does NOT call `md.render()`.
  // Therefore we use a core rule (token injection) + a custom
  // renderer rule that fires during the render pass where
  // `env.currentDocument` is a vscode.Uri.
  return {
    extendMarkdownIt(md: any) {
      md.core.ruler.push("mrsf_comment_data", (state: any) => {
        const token = new state.Token("mrsf_comment_data", "", 0);
        state.tokens.push(token);
      });

      md.renderer.rules["mrsf_comment_data"] = (
        _tokens: any,
        _idx: number,
        _options: any,
        env: any,
      ) => {
        const uri = resolvePreviewDocumentUri(env);
        if (!uri) return "";
        const config = vscode.workspace.getConfiguration("sidemark", uri);
        if (!config.get<boolean>("commentsEnabled", true) || !config.get<boolean>("previewComments", true)) {
          return "";
        }

        const review = store.get(uri);
        if (store.getLoadState(uri) === "unloaded") void store.ensureLoaded(uri);

        const previewOptions = getPreviewOptions(uri);
        const comments = review?.comments ?? [];
        const payload = escapeAttribute(JSON.stringify(comments));
        const documentUri = escapeAttribute(uri.toString());
        return `<div id="mrsf-comment-data"
          data-version="1"
          data-load-state="${store.getLoadState(uri)}"
          data-uri-scheme="${escapeAttribute(vscode.env.uriScheme)}"
          data-show-resolved="${config.get<boolean>("showResolved", true)}"
          data-comments="${payload}"
          data-document-uri="${documentUri}"
          data-gutter-position="${previewOptions.gutterPosition}"
          data-gutter-for-inline="${previewOptions.gutterForInline}"
          data-inline-highlights="${previewOptions.inlineHighlights}"
          data-line-highlight="${previewOptions.lineHighlight}"
          aria-hidden="true"></div>`;
      };

      md.core.ruler.push("mrsf_preview_meta", (state: any) => {
        const token = new state.Token("mrsf_preview_meta", "", 0);
        state.tokens.push(token);
      });

      md.renderer.rules["mrsf_preview_meta"] = (
        _tokens: any,
        _idx: number,
        _options: any,
        env: any,
      ) => {
        const uri = resolvePreviewDocumentUri(env);
        const config = vscode.workspace.getConfiguration("sidemark", uri ?? undefined);
        const target = uri ? getPreviewScrollTarget(uri) : undefined;
        let scrollAttr = "";
        if (target) {
          scrollAttr = ` data-scroll-to-line="${target.line}" data-scroll-request-id="${target.id}"`;
        }

        return `<div id="mrsf-preview-meta"
          data-document-uri="${escapeAttribute(uri?.toString() ?? "")}"
          data-comments-enabled="${config.get<boolean>("commentsEnabled", true)}"
          data-preview-comments="${config.get<boolean>("previewComments", true)}"
          ${scrollAttr}
          aria-hidden="true"></div>`;
      };

      return md;
    },
  };
}

export function deactivate(): void {
  // All disposables auto-cleaned via context.subscriptions
}

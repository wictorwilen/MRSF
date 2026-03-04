/**
 * Extension entry point — activates and wires all MRSF components.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
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

// ── Markdown-it plugin helpers (for preview integration) ─────────

interface SlimComment {
  id: string;
  author: string;
  text: string;
  line: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
  selected_text?: string | null;
  resolved: boolean;
  reply_to: string | null;
  severity: string | null;
  type: string | null;
  timestamp: string | null;
}

/**
 * Load sidecar comments from disk for a given Markdown document path.
 * Returns a slim comment array for embedding in the preview, or null.
 */
function loadSidecarComments(docPath: string): SlimComment[] | null {
  if (!docPath) return null;

  const yamlPath = docPath + ".review.yaml";
  const jsonPath = docPath + ".review.json";

  let raw: string | null = null;
  let format: "yaml" | "json" | null = null;

  try {
    if (fs.existsSync(yamlPath)) {
      raw = fs.readFileSync(yamlPath, "utf-8");
      format = "yaml";
    } else if (fs.existsSync(jsonPath)) {
      raw = fs.readFileSync(jsonPath, "utf-8");
      format = "json";
    }
  } catch {
    return null;
  }

  if (!raw) return null;

  try {
    let doc: any;
    if (format === "json") {
      doc = JSON.parse(raw);
    } else {
      doc = yaml.load(raw);
    }

    if (!doc || !Array.isArray(doc.comments)) return null;

    return doc.comments.map((c: any) => ({
      id: c.id,
      author: c.author || "Unknown",
      text: c.text || "",
      line: c.line ?? null,
      end_line: c.end_line ?? null,
      start_column: c.start_column ?? null,
      end_column: c.end_column ?? null,
      selected_text: c.selected_text || null,
      resolved: !!c.resolved,
      reply_to: c.reply_to || null,
      severity: c.severity || null,
      type: c.type || null,
      timestamp: c.timestamp || null,
    }));
  } catch {
    return null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Preview scroll-target (sidebar → preview navigation) ─────────
// When the sidebar needs to scroll the fullscreen preview to a
// specific line, it sets this value and triggers a preview refresh.
// The markdown-it renderer reads & clears it, embedding it in the
// data div so the preview script can scroll to it.
let _previewScrollTargetLine: number | null = null;

/**
 * Set a line number that the preview should scroll to on next render.
 * Call `markdown.preview.refresh` after this to trigger the render.
 */
export function setPreviewScrollTarget(line: number): void {
  _previewScrollTargetLine = line;
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
      // Try active editor first, then fall back to visible/open markdown docs
      // (preview mode has no activeTextEditor).
      let docUri: vscode.Uri | undefined;
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "markdown") {
        docUri = editor.document.uri;
      } else {
        const mdEditor = vscode.window.visibleTextEditors.find(
          (e) => e.document.languageId === "markdown",
        );
        if (mdEditor) {
          docUri = mdEditor.document.uri;
        } else {
          const mdDoc = vscode.workspace.textDocuments.find(
            (d) => d.languageId === "markdown",
          );
          if (mdDoc) docUri = mdDoc.uri;
        }
      }
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
      // Refresh Markdown preview so the markdown-it plugin re-reads the
      // sidecar and the preview script can update badges/tooltips.
      vscode.commands.executeCommand("markdown.preview.refresh");
    }),
  );

  // ── Live line tracking + reanchor on save ──────────────────
  // Track documents with unsaved line changes — anchors may be drifted.
  // Comment positions are adjusted in memory immediately so decorations
  // stay aligned.  The real reanchor (fuzzy match) + persist happens on save.
  const dirtyDocs = new Set<string>();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== "markdown") return;
      const doc = store.get(e.document.uri);
      if (!doc || doc.comments.length === 0) return;

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

      const uri = document.uri;

      // Reload the sidecar from disk (original positions) before running
      // the full reanchor.  This ensures we anchor against the on-disk
      // state rather than the in-memory shifted positions.
      await store.reloadFromDisk(uri);

      const doc = store.get(uri);
      if (!doc || doc.comments.length === 0) {
        dirtyDocs.delete(document.uri.fsPath);
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
        // Best effort — don't interrupt the user's save flow
      }

      // Clear dirty state after reanchor
      store.clearPendingShifts(uri);
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
      // 1. Core rule: push a placeholder token at the end of every
      //    token stream.  This runs during parse() — env is minimal.
      md.core.ruler.push("mrsf_comment_data", (state: any) => {
        const token = new state.Token("mrsf_comment_data", "", 0);
        state.tokens.push(token);
      });

      // 2. Renderer rule: called during renderer.render() where the
      //    env object contains `currentDocument` as a vscode.Uri.
      md.renderer.rules["mrsf_comment_data"] = (
        _tokens: any,
        _idx: number,
        _options: any,
        env: any,
      ) => {
        // Check if preview comments are enabled
        const config = vscode.workspace.getConfiguration("sidemark");
        if (!config.get<boolean>("previewComments", true)) {
          return "";
        }

        // Resolve the document path from env.currentDocument (vscode.Uri)
        let docPath: string | null = null;
        if (env?.currentDocument) {
          const cd = env.currentDocument;
          if (cd.fsPath) {
            docPath = cd.fsPath;
          } else if (typeof cd === "string") {
            docPath = cd.startsWith("file://")
              ? decodeURIComponent(cd.replace(/^file:\/\//, ""))
              : cd;
          } else if (typeof cd.toString === "function") {
            const s = cd.toString();
            docPath = s.startsWith("file://")
              ? decodeURIComponent(s.replace(/^file:\/\//, ""))
              : s;
          }
        }

        if (!docPath || !path.isAbsolute(docPath)) return "";

        const comments = loadSidecarComments(docPath);
        if (!comments || comments.length === 0) return "";

        const json = JSON.stringify(comments);
        // Use a hidden <div> with a data-attribute. Webview CSP strips
        // <script> tags, so a div is the only reliable container.
        const safeJson = json.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

        // If a scroll target was requested (sidebar "Go to" in fullscreen
        // preview), embed it and clear the one-shot value.
        let scrollAttr = "";
        if (_previewScrollTargetLine != null) {
          scrollAttr = ` data-scroll-to-line="${_previewScrollTargetLine}"`;
          _previewScrollTargetLine = null;
        }

        return `<div id="mrsf-comment-data" data-comments="${safeJson}"${scrollAttr} aria-hidden="true"></div>`;
      };

      return md;
    },
  };
}

export function deactivate(): void {
  // All disposables auto-cleaned via context.subscriptions
}

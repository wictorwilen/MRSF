/**
 * SidebarViewProvider — webview-based sidebar showing threaded MRSF comments
 * for the active Markdown document.
 */
import * as vscode from "vscode";
import type { Comment, CommentSummary } from "@mrsf/cli";
import type { SidecarStore } from "../store/SidecarStore.js";
import { relativeTime, mrsfToVscodeRange } from "../util/positions.js";

interface WebviewMessage {
  type: string;
  commentId?: string;
  parentId?: string;
  text?: string;
  line?: number;
  sortMode?: "line" | "date";
  showResolved?: boolean;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "mrsf.commentsView";

  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];
  private currentDocUri?: vscode.Uri;
  private sortMode: "line" | "date" = "line";

  constructor(
    private store: SidecarStore,
    private extensionUri: vscode.Uri,
  ) {
    this.disposables.push(
      this.store.onDidChange(() => this.refresh()),
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === "markdown") {
          this.currentDocUri = editor.document.uri;
          this.refresh();
        }
      }),
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    // Set current doc from active editor
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === "markdown") {
      this.currentDocUri = editor.document.uri;
    }

    this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;

    if (!this.currentDocUri) {
      this.view.webview.html = this.getEmptyHtml("No Markdown file open");
      return;
    }

    let doc = this.store.get(this.currentDocUri);
    if (!doc) {
      doc = await this.store.load(this.currentDocUri);
    }

    if (!doc) {
      this.view.webview.html = this.getNoSidecarHtml();
      return;
    }

    // Get document line count to detect structurally orphaned comments
    let docLineCount: number | undefined;
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.toString() === this.currentDocUri.toString()) {
      docLineCount = editor.document.lineCount;
    }

    this.view.webview.html = this.getCommentsHtml(doc.comments, docLineCount);
  }

  /**
   * Reveal the sidebar and highlight a specific comment by ID.
   * Used during reanchor review to draw attention to the comment under review.
   */
  async highlightComment(commentId: string): Promise<void> {
    // Ensure the sidebar is visible
    await vscode.commands.executeCommand("mrsf.commentsView.focus");

    // Give the webview a moment to render, then send highlight message
    setTimeout(() => {
      this.view?.webview.postMessage({
        type: "highlightComment",
        commentId,
      });
    }, 100);
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    if (!this.currentDocUri) return;

    switch (msg.type) {
      case "resolve":
        if (msg.commentId) {
          await this.store.resolveComment(this.currentDocUri, msg.commentId);
        }
        break;
      case "unresolve":
        if (msg.commentId) {
          await this.store.unresolveComment(this.currentDocUri, msg.commentId);
        }
        break;
      case "delete":
        if (msg.commentId) {
          const confirmed = await vscode.window.showWarningMessage(
            "Delete this comment?",
            { modal: true },
            "Delete",
          );
          if (confirmed === "Delete") {
            await this.store.deleteComment(this.currentDocUri, msg.commentId);
          }
        }
        break;
      case "reply":
        if (msg.parentId && msg.text) {
          const config = vscode.workspace.getConfiguration("sidemark");
          const author = config.get<string>("author") || "Anonymous";
          await this.store.replyToComment(
            this.currentDocUri,
            msg.parentId,
            msg.text,
            author,
          );
        }
        break;
      case "navigate":
        if (msg.commentId) {
          await this.navigateToComment(msg.commentId);
        }
        break;
      case "init":
        await vscode.commands.executeCommand("mrsf.addLineComment");
        break;
      case "addComment":
        await vscode.commands.executeCommand("mrsf.addLineComment");
        break;
      case "reanchor":
        await vscode.commands.executeCommand("mrsf.reanchor");
        break;
      case "sort":
        if (msg.sortMode === "line" || msg.sortMode === "date") {
          this.sortMode = msg.sortMode;
          this.refresh();
        }
        break;
      case "toggleResolved": {
        const config = vscode.workspace.getConfiguration("sidemark");
        const current = config.get<boolean>("showResolved", true);
        await config.update("showResolved", !current, vscode.ConfigurationTarget.Workspace);
        this.refresh();
        break;
      }
    }
  }

  private async navigateToComment(commentId: string): Promise<void> {
    if (!this.currentDocUri) return;
    const comment = this.store.findComment(this.currentDocUri, commentId);
    if (!comment || comment.line == null) return;

    const editor = await vscode.window.showTextDocument(this.currentDocUri);
    const range = mrsfToVscodeRange(comment, editor.document);
    if (range) {
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
  }

  // ── HTML generation ─────────────────────────────────────────

  /**
   * Check whether a comment should be considered orphaned.
   * Either explicitly flagged via x_reanchor_status or structurally
   * orphaned (line beyond document bounds).
   */
  private isOrphaned(comment: Comment, docLineCount?: number): boolean {
    if ((comment as Record<string, unknown>).x_reanchor_status === "orphaned") {
      return true;
    }
    if (docLineCount != null && comment.line != null && comment.line > docLineCount) {
      return true;
    }
    return false;
  }

  private getCommentsHtml(comments: Comment[], docLineCount?: number): string {
    const config = vscode.workspace.getConfiguration("sidemark");
    const showResolved = config.get<boolean>("showResolved", true);

    const threads = this.buildThreads(comments);
    const summary = this.computeSummary(comments, docLineCount);

    // Filter threads based on showResolved setting
    const visibleThreads = showResolved
      ? threads
      : threads.filter((thread) => !thread[0].resolved);

    // Sort threads by current mode
    if (this.sortMode === "line") {
      visibleThreads.sort((a, b) => {
        const aLine = a[0].line ?? Number.MAX_SAFE_INTEGER;
        const bLine = b[0].line ?? Number.MAX_SAFE_INTEGER;
        return aLine - bLine;
      });
    } else {
      visibleThreads.sort((a, b) => {
        const aTime = new Date(a[0].timestamp).getTime();
        const bTime = new Date(b[0].timestamp).getTime();
        return bTime - aTime; // newest first
      });
    }

    const threadHtml = visibleThreads
      .map((thread) => this.renderThread(thread, docLineCount))
      .join("");

    const lineActive = this.sortMode === "line" ? " active" : "";
    const dateActive = this.sortMode === "date" ? " active" : "";
    const filterIcon = showResolved ? "👁" : "👁‍🗨";
    const filterTitle = showResolved ? "Hide resolved" : "Show resolved";

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="header">
    <span class="summary">${summary.open} open · ${summary.resolved} resolved${summary.orphaned > 0 ? ` · <span class="orphan-count">${summary.orphaned} orphaned</span>` : ""}</span>
    <div class="header-actions">
      <button class="btn-icon" onclick="postMessage({type:'toggleResolved'})" title="${filterTitle}">${filterIcon}</button>
      <button class="btn-icon" onclick="postMessage({type:'reanchor'})" title="Reanchor Comments">⚓</button>
      <button class="btn-icon" onclick="postMessage({type:'addComment'})" title="Add Comment">+</button>
    </div>
  </div>
  <div class="sort-bar">
    <span class="sort-label">Sort:</span>
    <button class="sort-btn${lineActive}" onclick="postMessage({type:'sort',sortMode:'line'})" title="Sort by line number">Line</button>
    <button class="sort-btn${dateActive}" onclick="postMessage({type:'sort',sortMode:'date'})" title="Sort by date (newest first)">Date</button>
  </div>
  <div class="comments">
    ${threadHtml || '<div class="empty">No comments yet</div>'}
  </div>
  <script>${this.getScript()}</script>
</body>
</html>`;
  }

  private getNoSidecarHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="empty-state">
    <p>No MRSF sidecar found for this file.</p>
    <button class="btn-primary" onclick="postMessage({type:'init'})">Initialize Review</button>
  </div>
  <script>${this.getScript()}</script>
</body>
</html>`;
  }

  private getEmptyHtml(message: string): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="empty-state"><p>${message}</p></div>
</body>
</html>`;
  }

  private renderThread(thread: Comment[], docLineCount?: number): string {
    const root = thread[0];
    const replies = thread.slice(1);
    const isOrphaned = this.isOrphaned(root, docLineCount);

    const statusClass = isOrphaned
      ? "orphaned"
      : root.resolved
        ? "resolved"
        : "open";

    const statusIcon = isOrphaned ? "⚠️" : root.resolved ? "✅" : "💬";
    const badges = this.renderBadges(root, isOrphaned);
    const lineInfo = root.line != null ? `L${root.line}` : "doc";
    const time = relativeTime(root.timestamp);

    let html = /* html */ `
<div class="thread ${statusClass}">
  <div class="comment root" data-id="${root.id}">
    <div class="comment-header">
      <span class="status-icon">${statusIcon}</span>
      <strong class="author">${this.esc(root.author)}</strong>
      <span class="meta">${time} · ${lineInfo}${badges}</span>
    </div>
    <div class="comment-text">${this.esc(root.text)}</div>
    <div class="comment-actions">
      <button onclick="postMessage({type:'navigate',commentId:'${root.id}'})" title="Go to">📍</button>
      ${!root.resolved ? `<button onclick="postMessage({type:'resolve',commentId:'${root.id}'})" title="Resolve">✅</button>` : `<button onclick="postMessage({type:'unresolve',commentId:'${root.id}'})" title="Unresolve">🔄</button>`}
      <button onclick="toggleReply('${root.id}')" title="Reply">💬</button>
      <button onclick="postMessage({type:'delete',commentId:'${root.id}'})" title="Delete">🗑️</button>
      ${isOrphaned ? `<button onclick="postMessage({type:'reanchor'})" title="Reanchor to fix orphaned anchor">⚓</button>` : ""}
    </div>
    <div class="reply-input" id="reply-${root.id}" style="display:none;">
      <textarea placeholder="Reply..." rows="2"></textarea>
      <button onclick="sendReply('${root.id}')">Send</button>
    </div>
  </div>`;

    for (const reply of replies) {
      const rTime = relativeTime(reply.timestamp);
      html += /* html */ `
  <div class="comment reply" data-id="${reply.id}">
    <div class="comment-header">
      <strong class="author">${this.esc(reply.author)}</strong>
      <span class="meta">${rTime}</span>
    </div>
    <div class="comment-text">${this.esc(reply.text)}</div>
    <div class="comment-actions">
      <button onclick="postMessage({type:'delete',commentId:'${reply.id}'})" title="Delete">🗑️</button>
    </div>
  </div>`;
    }

    html += `</div>`;
    return html;
  }

  private renderBadges(comment: Comment, isOrphaned = false): string {
    const parts: string[] = [];
    if (isOrphaned) parts.push(`<span class="badge orphaned">orphaned</span>`);
    if (comment.type) parts.push(`<span class="badge type">${this.esc(comment.type)}</span>`);
    if (comment.severity)
      parts.push(`<span class="badge severity-${comment.severity}">${this.esc(comment.severity)}</span>`);
    return parts.length > 0 ? " " + parts.join(" ") : "";
  }

  private buildThreads(comments: Comment[]): Comment[][] {
    const roots = comments.filter((c) => !c.reply_to);
    const replyMap = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.reply_to) {
        const list = replyMap.get(c.reply_to) || [];
        list.push(c);
        replyMap.set(c.reply_to, list);
      }
    }

    return roots.map((root) => {
      const replies = (replyMap.get(root.id) || []).sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      return [root, ...replies];
    });
  }

  private computeSummary(comments: Comment[], docLineCount?: number): { open: number; resolved: number; orphaned: number } {
    let open = 0;
    let resolved = 0;
    let orphaned = 0;
    for (const c of comments) {
      if (!c.reply_to) {
        if (this.isOrphaned(c, docLineCount)) orphaned++;
        else if (c.resolved) resolved++;
        else open++;
      }
    }
    return { open, resolved, orphaned };
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private getStyles(): string {
    return /* css */ `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        padding: 8px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0 8px;
        border-bottom: 1px solid var(--vscode-panel-border);
        margin-bottom: 8px;
      }
      .summary {
        font-size: 0.85em;
        opacity: 0.8;
      }
      .header-actions {
        display: flex;
        gap: 4px;
      }
      .btn-icon {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        width: 24px;
        height: 24px;
        cursor: pointer;
        font-size: 16px;
        line-height: 24px;
        text-align: center;
      }
      .btn-icon:hover { background: var(--vscode-button-hoverBackground); }
      .sort-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 0 6px;
        margin-bottom: 4px;
      }
      .sort-label {
        font-size: 0.8em;
        opacity: 0.6;
        margin-right: 2px;
      }
      .sort-btn {
        background: transparent;
        color: var(--vscode-foreground);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 3px;
        padding: 1px 8px;
        cursor: pointer;
        font-size: 0.8em;
        opacity: 0.7;
      }
      .sort-btn:hover { opacity: 1; }
      .sort-btn.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-color: var(--vscode-button-background);
        opacity: 1;
      }
      .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        padding: 6px 14px;
        cursor: pointer;
        font-size: 13px;
      }
      .btn-primary:hover { background: var(--vscode-button-hoverBackground); }

      .thread {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        margin-bottom: 8px;
        overflow: hidden;
      }
      .thread.open { border-left: 3px solid var(--vscode-editorInfo-foreground); }
      .thread.resolved { border-left: 3px solid #28a745; }
      .thread.orphaned { border-left: 3px solid #ff9800; }

      .comment { padding: 8px; }
      .comment.reply {
        background: var(--vscode-editor-background);
        border-top: 1px solid var(--vscode-panel-border);
        padding-left: 20px;
      }
      .comment-header {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 4px;
      }
      .author { font-size: 0.9em; }
      .meta { font-size: 0.8em; opacity: 0.7; }
      .status-icon { font-size: 14px; }
      .comment-text {
        font-size: 0.9em;
        line-height: 1.4;
        white-space: pre-wrap;
        word-break: break-word;
        margin-bottom: 4px;
      }
      .comment-actions {
        display: flex;
        gap: 4px;
      }
      .comment-actions button {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 3px;
        opacity: 0.6;
      }
      .comment-actions button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

      .badge {
        display: inline-block;
        font-size: 0.75em;
        padding: 1px 5px;
        border-radius: 3px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
      }
      .severity-high { background: #d32f2f; color: #fff; }
      .severity-medium { background: #f57c00; color: #fff; }
      .severity-low { background: #616161; color: #fff; }
      .badge.orphaned { background: #ff9800; color: #fff; }
      .orphan-count { color: #ff9800; font-weight: bold; }

      .reply-input {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .reply-input textarea {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        padding: 4px 6px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        resize: vertical;
      }
      .reply-input button {
        align-self: flex-end;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 3px;
        padding: 3px 10px;
        cursor: pointer;
        font-size: 12px;
      }

      .empty, .empty-state {
        text-align: center;
        padding: 20px;
        opacity: 0.6;
      }
      .empty-state button { margin-top: 10px; }
      @keyframes highlight-pulse {
        0% { background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(255, 200, 0, 0.4)); }
        100% { background-color: transparent; }
      }
      .thread.highlighted {
        animation: highlight-pulse 2s ease-out;
        border-left-color: var(--vscode-editorWarning-foreground, #ff9800) !important;
        border-left-width: 3px !important;
      }
    `;
  }

  private getScript(): string {
    return /* js */ `
      const vscode = acquireVsCodeApi();

      function postMessage(msg) {
        vscode.postMessage(msg);
      }

      function toggleReply(parentId) {
        const el = document.getElementById('reply-' + parentId);
        if (el) {
          el.style.display = el.style.display === 'none' ? 'flex' : 'none';
          if (el.style.display === 'flex') {
            el.querySelector('textarea').focus();
          }
        }
      }

      function sendReply(parentId) {
        const el = document.getElementById('reply-' + parentId);
        const textarea = el?.querySelector('textarea');
        if (textarea && textarea.value.trim()) {
          postMessage({
            type: 'reply',
            parentId: parentId,
            text: textarea.value.trim(),
          });
          textarea.value = '';
          el.style.display = 'none';
        }
      }

      // Listen for messages from the extension (e.g., highlight)
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'highlightComment' && msg.commentId) {
          // Remove any existing highlights
          document.querySelectorAll('.thread.highlighted').forEach(el => {
            el.classList.remove('highlighted');
          });
          // Find the comment element and highlight its thread
          const commentEl = document.querySelector('[data-id="' + msg.commentId + '"]');
          if (commentEl) {
            const threadEl = commentEl.closest('.thread');
            if (threadEl) {
              threadEl.classList.add('highlighted');
              threadEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      });
    `;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

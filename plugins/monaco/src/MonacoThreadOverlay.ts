import type * as monaco from "monaco-editor";
import type { ReviewState, ReviewThread } from "./types.js";
import { renderReviewThreadHtml } from "./ui/threadHtml.js";

export interface MonacoThreadOverlayActionRequest {
  action: "reply" | "edit" | "resolve" | "unresolve" | "delete";
  commentId: string;
  line: number;
}

export interface MonacoThreadOverlayOptions {
  targetDocument?: Document;
  interactive?: boolean;
  getState: () => ReviewState | null;
  getThreadsAtLine: (line: number) => ReviewThread[];
  onAction?: (request: MonacoThreadOverlayActionRequest) => void | Promise<void>;
  onAddLine?: (line: number) => void | Promise<void>;
}

let overlayStylesInjected = false;

function injectOverlayStyles(targetDocument: Document): void {
  if (overlayStylesInjected || targetDocument.getElementById("mrsf-monaco-overlay-styles")) {
    overlayStylesInjected = true;
    return;
  }

  const style = targetDocument.createElement("style");
  style.id = "mrsf-monaco-overlay-styles";
  style.textContent = `
.mrsf-monaco-overlay-root { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 8; }
.mrsf-monaco-overlay-gutter { position: absolute; inset: 0 auto 0 0; width: 88px; pointer-events: none; }
.mrsf-monaco-gutter-item { position: absolute; left: 0; display: flex; align-items: center; pointer-events: auto; }
.mrsf-monaco-badge { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 22px; padding: 3px 9px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mrsf-badge-bg, #2563eb) 22%, white); font-family: var(--mrsf-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); font-size: 11px; font-weight: 700; line-height: 1; color: var(--mrsf-badge-fg, #f8fbff); background: linear-gradient(180deg, color-mix(in srgb, var(--mrsf-badge-bg, #2563eb) 88%, white), var(--mrsf-badge-bg-strong, #1d4ed8)); white-space: nowrap; cursor: pointer; box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12); }
.mrsf-monaco-gutter-add { display: inline-flex; align-items: center; justify-content: center; min-height: 20px; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--mrsf-add-border, rgba(0, 122, 204, 0.28)); font-family: var(--mrsf-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); font-size: 11px; font-weight: 600; line-height: 1; color: var(--mrsf-add-fg, #007acc); background: var(--mrsf-add-bg, rgba(0, 122, 204, 0.12)); cursor: pointer; opacity: 0; transform: translateX(-4px); transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease, border-color 0.15s ease; }
.mrsf-monaco-overlay-root:hover .mrsf-monaco-gutter-add,
.mrsf-monaco-gutter-item:hover .mrsf-monaco-gutter-add,
.mrsf-monaco-gutter-add:focus-visible { opacity: 0.88; transform: translateX(0); }
.mrsf-monaco-gutter-add:hover,
.mrsf-monaco-gutter-add:focus-visible { opacity: 1; background: rgba(0, 122, 204, 0.18); border-color: rgba(0, 122, 204, 0.38); }
.mrsf-monaco-badge.mrsf-badge-resolved { background: var(--mrsf-badge-resolved-bg, #388a34); opacity: 0.74; }
.mrsf-monaco-badge.mrsf-badge-severity-high { border-left: 3px solid var(--mrsf-severity-high, #e74c3c); }
.mrsf-monaco-badge.mrsf-badge-severity-medium { border-left: 3px solid var(--mrsf-severity-medium, #f39c12); }
.mrsf-monaco-panel { position: absolute; width: min(420px, calc(100% - 112px)); max-height: min(420px, calc(100% - 16px)); overflow: auto; pointer-events: auto; background: var(--mrsf-tooltip-bg, #252526); color: var(--mrsf-tooltip-fg, #cccccc); border: 1px solid var(--mrsf-tooltip-border, #454545); border-radius: 8px; box-shadow: 0 18px 44px rgba(15, 23, 42, 0.24); padding: 8px; }
.mrsf-monaco-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid color-mix(in srgb, var(--mrsf-tooltip-border, #454545) 84%, transparent); }
.mrsf-monaco-panel-title { display: flex; flex-direction: column; gap: 2px; }
.mrsf-monaco-panel-title strong { font-size: 12px; }
.mrsf-monaco-panel-meta { font-size: 11px; opacity: 0.72; }
.mrsf-monaco-panel-actions { display: flex; align-items: center; gap: 6px; }
.mrsf-monaco-panel-btn { padding: 4px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mrsf-tooltip-border, #454545) 76%, transparent); background: color-mix(in srgb, var(--mrsf-tooltip-bg, #252526) 86%, white); color: inherit; cursor: pointer; font: inherit; font-size: 11px; }
.mrsf-monaco-thread-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.mrsf-monaco-thread-tab { padding: 4px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mrsf-tooltip-border, #454545) 76%, transparent); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 11px; opacity: 0.82; }
.mrsf-monaco-thread-tab.is-active { background: color-mix(in srgb, var(--mrsf-badge-bg, #2563eb) 22%, transparent); border-color: color-mix(in srgb, var(--mrsf-badge-bg, #2563eb) 48%, transparent); opacity: 1; }
.mrsf-monaco-thread-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.16); font-size: 10px; }
.mrsf-thread + .mrsf-thread { border-top: 1px solid var(--mrsf-tooltip-border, #454545); margin-top: 6px; padding-top: 8px; }
.mrsf-comment { padding: 4px 0; }
.mrsf-comment.mrsf-resolved { border-left: 2px solid var(--mrsf-badge-resolved-bg, #388a34); padding-left: 6px; }
.mrsf-replies { margin-left: 16px; padding-left: 8px; border-left: 2px solid var(--mrsf-tooltip-border, #454545); }
.mrsf-reply { font-size: 12px; }
.mrsf-comment-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 2px; }
.mrsf-author { font-weight: 600; }
.mrsf-date { font-size: 11px; opacity: 0.6; }
.mrsf-severity { font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.3px; }
.mrsf-severity-high { background: rgba(231, 76, 60, 0.2); color: var(--mrsf-severity-high, #e74c3c); }
.mrsf-severity-medium { background: rgba(243, 156, 18, 0.2); color: var(--mrsf-severity-medium, #f39c12); }
.mrsf-severity-low { background: rgba(52, 152, 219, 0.2); color: var(--mrsf-severity-low, #3498db); }
.mrsf-type { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: rgba(127, 127, 127, 0.15); opacity: 0.8; }
.mrsf-resolved-badge { font-size: 10px; color: var(--mrsf-badge-resolved-bg, #388a34); font-weight: 600; }
.mrsf-comment-body { white-space: pre-wrap; word-break: break-word; }
.mrsf-selected-text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85em; background: rgba(127, 127, 127, 0.1); border-left: 3px solid rgba(127, 127, 127, 0.3); margin: 4px 0; border-radius: 2px; }
.mrsf-selected-text-summary { padding: 4px 8px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; list-style: none; color: inherit; opacity: 0.7; }
.mrsf-selected-text-summary::-webkit-details-marker { display: none; }
.mrsf-selected-text-summary::before { content: "▶ "; font-size: 0.7em; vertical-align: middle; margin-right: 2px; }
.mrsf-selected-text[open] > .mrsf-selected-text-summary { display: none; }
.mrsf-selected-text-full { display: block; padding: 4px 8px; white-space: pre-wrap; word-break: break-word; }
.mrsf-actions { display: flex; gap: 4px; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--mrsf-tooltip-border, #454545); }
.mrsf-action-btn { padding: 4px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--mrsf-tooltip-border, #454545) 72%, transparent); background: color-mix(in srgb, var(--mrsf-tooltip-bg, #252526) 88%, white); color: inherit; cursor: pointer; font: inherit; font-size: 11px; }
.mrsf-action-danger { color: var(--mrsf-severity-high, #e74c3c); }
`;

  targetDocument.head.appendChild(style);
  overlayStylesInjected = true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function collectVisibleLines(editor: monaco.editor.IStandaloneCodeEditor): number[] {
  const model = editor.getModel();
  if (!model) return [];

  const visible = new Set<number>();
  for (const range of editor.getVisibleRanges()) {
    const start = Math.max(1, range.startLineNumber);
    const end = Math.min(model.getLineCount(), range.endLineNumber);
    for (let line = start; line <= end; line += 1) {
      visible.add(line);
    }
  }

  return [...visible].sort((left, right) => left - right);
}

function positionInRange(
  range: NonNullable<ReviewState["snapshot"]["inlineRanges"][number]["range"]>,
  lineNumber: number,
  column: number,
): boolean {
  const lineIndex = lineNumber - 1;
  const columnIndex = column - 1;

  if (lineIndex < range.start.lineIndex || lineIndex > range.end.lineIndex) {
    return false;
  }

  if (lineIndex === range.start.lineIndex && columnIndex < range.start.column) {
    return false;
  }

  if (lineIndex === range.end.lineIndex && columnIndex > range.end.column) {
    return false;
  }

  return true;
}

export class MonacoThreadOverlay {
  private readonly targetDocument: Document | null;
  private readonly root: HTMLDivElement | null;
  private readonly gutter: HTMLDivElement | null;
  private readonly panel: HTMLDivElement | null;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private activeLine: number | null = null;
  private activeCommentId: string | null = null;
  private activeThreadId: string | null = null;
  private preferredPanelPosition: { top: number; left: number } | null = null;

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly options: MonacoThreadOverlayOptions,
  ) {
    const domNode = editor.getContainerDomNode?.() ?? null;
    this.targetDocument = options.targetDocument ?? domNode?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
    if (!domNode || !this.targetDocument) {
      this.root = null;
      this.gutter = null;
      this.panel = null;
      return;
    }

    injectOverlayStyles(this.targetDocument);

    this.root = this.targetDocument.createElement("div");
    this.root.className = "mrsf-monaco-overlay-root";
    this.gutter = this.targetDocument.createElement("div");
    this.gutter.className = "mrsf-monaco-overlay-gutter";
    this.panel = this.targetDocument.createElement("div");
    this.panel.className = "mrsf-monaco-panel";
    this.panel.hidden = true;

    this.root.appendChild(this.gutter);
    this.root.appendChild(this.panel);
    domNode.style.position ||= "relative";
    domNode.appendChild(this.root);

    this.gutter.addEventListener("click", this.handleGutterClick);
    this.panel.addEventListener("click", this.handlePanelClick);

    this.disposables.push(editor.onDidScrollChange(() => this.render()));
    this.disposables.push(editor.onDidLayoutChange(() => this.render()));
    this.disposables.push(editor.onDidChangeModel(() => this.hidePanel()));
    this.disposables.push(editor.onMouseDown(() => this.hidePanel()));
    this.disposables.push(editor.onMouseMove((event) => {
      const inlineCommentId = this.findInlineCommentId(event);
      if (!inlineCommentId || !event.target.position) {
        return;
      }

      const domNode = editor.getContainerDomNode?.();
      const rootRect = domNode?.getBoundingClientRect();
      const browserEvent = event.event.browserEvent;
      this.preferredPanelPosition = rootRect
        ? {
            top: browserEvent.clientY - rootRect.top + 14,
            left: browserEvent.clientX - rootRect.left + 14,
          }
        : null;
      this.showLine(event.target.position.lineNumber, inlineCommentId);
    }));
  }

  update(state: ReviewState | null): void {
    if (!this.root || !this.gutter || !state) {
      this.clear();
      return;
    }

    const layout = this.editor.getLayoutInfo();
    const marks = state.snapshot.gutterMarks;
    const marksByLine = new Map(marks.map((mark) => [mark.line, mark]));
    const visibleLines = collectVisibleLines(this.editor);
    this.gutter.innerHTML = "";
    this.gutter.style.width = `${Math.max(layout.contentLeft, 72)}px`;

    for (const line of visibleLines) {
      const top = this.editor.getTopForLineNumber(line) - this.editor.getScrollTop() + 2;
      const item = this.targetDocument!.createElement("div");
      item.className = "mrsf-monaco-gutter-item";
      item.style.top = `${top}px`;
      item.style.left = `${Math.max(4, layout.glyphMarginLeft + 4)}px`;

      const mark = marksByLine.get(line);

      if (!mark) {
        const addButton = this.targetDocument!.createElement("button");
        addButton.type = "button";
        addButton.className = "mrsf-monaco-gutter-add";
        addButton.dataset.line = String(line);
        addButton.dataset.addLine = "true";
        addButton.textContent = "Add";
        item.appendChild(addButton);
        this.gutter.appendChild(item);
        continue;
      }

      const badge = this.targetDocument!.createElement("button");
      badge.type = "button";
      badge.className = [
        "mrsf-monaco-badge",
        mark.resolvedState === "resolved" ? "mrsf-badge-resolved" : "",
        mark.highestSeverity === "high" ? "mrsf-badge-severity-high" : "",
        mark.highestSeverity === "medium" ? "mrsf-badge-severity-medium" : "",
      ].filter(Boolean).join(" ");
      badge.dataset.line = String(mark.line);
      const threadCount = this.options.getThreadsAtLine(line).length;
      badge.innerHTML = `<span>${mark.commentCount}</span><span class="mrsf-monaco-thread-count">${threadCount}T</span>`;
      item.appendChild(badge);
      this.gutter.appendChild(item);
    }

    if (this.activeLine != null) {
      this.showLine(this.activeLine, this.activeCommentId ?? undefined);
    }
  }

  dispose(): void {
    this.gutter?.removeEventListener("click", this.handleGutterClick);
    this.panel?.removeEventListener("click", this.handlePanelClick);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.root?.remove();
  }

  private readonly handleGutterClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const line = Number(target?.dataset.line ?? "");
    if (!target || Number.isNaN(line)) return;

    event.preventDefault();
    event.stopPropagation();

    if (target.dataset.addLine === "true") {
      void this.options.onAddLine?.(line);
      return;
    }

    if (this.activeLine === line && this.panel && !this.panel.hidden) {
      this.hidePanel();
      return;
    }

    this.showLine(line);
  };

  private readonly handlePanelClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const button = target.closest<HTMLElement>("[data-mrsf-action], [data-mrsf-thread-filter], [data-mrsf-panel-add-line]");
    if (!button) return;

    const action = button.dataset.mrsfAction as MonacoThreadOverlayActionRequest["action"] | undefined;
    const threadFilter = button.dataset.mrsfThreadFilter;
    const addLine = button.dataset.mrsfPanelAddLine;

    if (threadFilter) {
      event.preventDefault();
      event.stopPropagation();
      this.activeThreadId = threadFilter === "all" ? null : threadFilter;
      if (this.activeLine != null) {
        this.showLine(this.activeLine, this.activeCommentId ?? undefined);
      }
      return;
    }

    if (addLine === "true") {
      event.preventDefault();
      event.stopPropagation();
      if (this.activeLine != null) {
        void this.options.onAddLine?.(this.activeLine);
      }
      return;
    }

    const commentId = button.dataset.mrsfCommentId;
    const line = Number(button.dataset.mrsfLine ?? "");
    if (!action || !commentId || Number.isNaN(line)) return;

    event.preventDefault();
    event.stopPropagation();
    void this.options.onAction?.({ action, commentId, line });
  };

  private showLine(line: number, commentId?: string): void {
    if (!this.panel || !this.root || !this.targetDocument) return;

    const allThreads = this.options.getThreadsAtLine(line);
    const matchingThread = commentId
      ? allThreads.find((thread) =>
          thread.rootComment.id === commentId || thread.replies.some((reply) => reply.id === commentId),
        )
      : null;

    if (this.activeLine !== line) {
      this.activeThreadId = null;
    }
    if (matchingThread) {
      this.activeThreadId = matchingThread.rootComment.id;
    }

    const threads = this.getThreadsForDisplay(line, commentId);
    if (threads.length === 0) {
      this.hidePanel();
      return;
    }

    this.activeLine = line;
    this.activeCommentId = commentId ?? null;
    this.panel.innerHTML = this.renderPanel(line, allThreads, threads);
    this.panel.hidden = false;

    const layout = this.editor.getLayoutInfo();
    const top = this.editor.getTopForLineNumber(line) - this.editor.getScrollTop();
    const rootRect = this.root.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const panelHeight = panelRect.height || 220;
    const panelWidth = panelRect.width || Math.min(420, Math.max(220, rootRect.width - 24));
    const fallbackTop = clamp(top - 24, 8, Math.max(8, rootRect.height - panelHeight - 8));
    const fallbackLeft = clamp(layout.contentLeft + 12, 12, Math.max(12, rootRect.width - panelWidth - 12));
    const panelTop = this.preferredPanelPosition
      ? clamp(this.preferredPanelPosition.top, 8, Math.max(8, rootRect.height - panelHeight - 8))
      : fallbackTop;
    const panelLeft = this.preferredPanelPosition
      ? clamp(this.preferredPanelPosition.left, 12, Math.max(12, rootRect.width - panelWidth - 12))
      : fallbackLeft;

    this.panel.style.top = `${panelTop}px`;
    this.panel.style.left = `${panelLeft}px`;
  }

  private hidePanel(): void {
    this.activeLine = null;
    this.activeCommentId = null;
    this.activeThreadId = null;
    this.preferredPanelPosition = null;
    if (this.panel) {
      this.panel.hidden = true;
      this.panel.innerHTML = "";
    }
  }

  private clear(): void {
    this.gutter?.replaceChildren();
    this.hidePanel();
  }

  private render(): void {
    this.update(this.options.getState());
  }

  private getThreadsForDisplay(line: number, commentId?: string): ReviewThread[] {
    const threads = this.options.getThreadsAtLine(line);
    if (!commentId) {
      if (!this.activeThreadId) {
        return threads;
      }

      return threads.filter((thread) => thread.rootComment.id === this.activeThreadId);
    }

    return threads.filter((thread) =>
      thread.rootComment.id === commentId || thread.replies.some((reply) => reply.id === commentId),
    );
  }

  private renderPanel(line: number, allThreads: ReviewThread[], visibleThreads: ReviewThread[]): string {
    const totalComments = allThreads.reduce((count, thread) => count + 1 + thread.replies.length, 0);
    const header = `
      <div class="mrsf-monaco-panel-header">
        <div class="mrsf-monaco-panel-title">
          <strong>Line ${line}</strong>
          <span class="mrsf-monaco-panel-meta">${allThreads.length} thread${allThreads.length === 1 ? "" : "s"} · ${totalComments} comment${totalComments === 1 ? "" : "s"}</span>
        </div>
        <div class="mrsf-monaco-panel-actions">
          ${this.options.interactive !== false && this.options.onAddLine ? `<button type="button" class="mrsf-monaco-panel-btn" data-mrsf-panel-add-line="true">Add thread</button>` : ""}
        </div>
      </div>
    `;

    const tabs = allThreads.length > 1
      ? `<div class="mrsf-monaco-thread-tabs">
          <button type="button" class="mrsf-monaco-thread-tab ${this.activeThreadId == null ? "is-active" : ""}" data-mrsf-thread-filter="all">All threads</button>
          ${allThreads.map((thread, index) => {
            const threadComments = 1 + thread.replies.length;
            const label = thread.rootComment.type ?? `Thread ${index + 1}`;
            const active = this.activeThreadId === thread.rootComment.id;
            return `<button type="button" class="mrsf-monaco-thread-tab ${active ? "is-active" : ""}" data-mrsf-thread-filter="${thread.rootComment.id}">${label} · ${threadComments}</button>`;
          }).join("")}
        </div>`
      : "";

    const body = visibleThreads
      .map((thread) => renderReviewThreadHtml(thread, this.options.interactive !== false))
      .join("");

    return `${header}${tabs}${body}`;
  }

  private findInlineCommentId(event: monaco.editor.IEditorMouseEvent): string | null {
    const position = event.target.position;
    const state = this.options.getState();
    if (!position || !state) {
      return null;
    }

    const match = state.snapshot.inlineRanges.find((inlineRange) =>
      positionInRange(inlineRange.range, position.lineNumber, position.column),
    );

    return match?.commentId ?? null;
  }
}
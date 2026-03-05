/* ---------------------------------------------------------------
 * AUTO-GENERATED — DO NOT EDIT
 *
 * Source: plugins/shared/src/controller.ts
 * Run `node plugins/sync-types.mjs` to regenerate.
 * --------------------------------------------------------------- */

/**
 * Sidemark — MrsfController: overlay gutter architecture.
 *
 * The controller is the runtime engine for interactive MRSF rendering.
 * It reads comment data from the DOM (embedded `<script type="application/mrsf+json">`)
 * or constructor options, creates gutter overlay columns, positions
 * badges/buttons at the correct vertical offsets, and handles all
 * user interactions (tooltips, selection, action buttons).
 *
 * Usage:
 *   import { MrsfController } from "@mrsf/plugin-shared/controller";
 *
 *   const ctrl = new MrsfController(document.querySelector(".my-content")!, {
 *     interactive: true,
 *     gutterPosition: "left",
 *   });
 *   // ctrl.destroy() to clean up
 *
 * Events dispatched on document:
 *   - mrsf:resolve   { commentId, line, ... }
 *   - mrsf:unresolve { commentId, line, ... }
 *   - mrsf:reply     { commentId, line, ... }
 *   - mrsf:edit      { commentId, line, ... }
 *   - mrsf:delete    { commentId, line, ... }
 *   - mrsf:navigate  { commentId, line, ... }
 *   - mrsf:add       { commentId: null, line, selectionText?, ... }
 *   - mrsf:submit    { action, commentId, text?, line?, ... }
 */

import type { CommentThread, SlimComment } from "./types.js";
import { renderThreadHtml, escapeHtml } from "./html.js";

// ── Types ───────────────────────────────────────────────────

export type MrsfAction = "resolve" | "unresolve" | "reply" | "edit" | "delete" | "navigate" | "add";

export interface MrsfActionDetail {
  commentId: string | null;
  line: number | null;
  action: MrsfAction;
  selectionText?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
}

export interface MrsfSubmitDetail {
  action: "add" | "edit" | "reply" | "resolve" | "unresolve" | "delete";
  commentId: string | null;
  text: string;
  type?: string | null;
  severity?: "low" | "medium" | "high" | null;
  line?: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
  selection_text?: string | null;
}

export interface MrsfControllerOptions {
  /** Show gutter on left, right, or both sides. Default: "right". */
  gutterPosition?: "left" | "right" | "both";
  /** Enable interactive actions (add, resolve, reply, etc.). Default: false. */
  interactive?: boolean;
  /** Comment data passed directly (overrides embedded script). */
  comments?: CommentThread[];
}

// ── MrsfController ──────────────────────────────────────────

export class MrsfController {
  private container: HTMLElement;
  private opts: Required<MrsfControllerOptions>;
  private threads: Map<number, CommentThread[]> = new Map();
  private gutterLeft: HTMLDivElement | null = null;
  private gutterRight: HTMLDivElement | null = null;
  private activeTooltip: HTMLElement | null = null;
  private floatingAddButton: HTMLButtonElement | null = null;
  private overlayEl: HTMLDivElement | null = null;
  private lastSelectionText: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private styleInjected = false;

  private handleResizeBound = this.positionGutterItems.bind(this);
  private handleClickBound = this.handleClick.bind(this);
  private handleSelectionBound = this.handleSelectionChange.bind(this);

  constructor(container: HTMLElement, options: MrsfControllerOptions = {}) {
    this.container = container;
    this.opts = {
      gutterPosition: options.gutterPosition ?? "right",
      interactive: options.interactive ?? false,
      comments: options.comments ?? [],
    };

    this.loadCommentData();
    this.setupOverlayStructure();
    this.renderGutterItems();
    this.positionGutterItems();

    // Listeners
    this.resizeObserver = new ResizeObserver(this.handleResizeBound);
    this.resizeObserver.observe(this.container);
    document.addEventListener("click", this.handleClickBound);
    if (this.opts.interactive) {
      document.addEventListener("selectionchange", this.handleSelectionBound);
    }
  }

  /** Remove all controller DOM and listeners. */
  destroy(): void {
    this.resizeObserver?.disconnect();
    document.removeEventListener("click", this.handleClickBound);
    document.removeEventListener("selectionchange", this.handleSelectionBound);
    this.gutterLeft?.remove();
    this.gutterRight?.remove();
    this.floatingAddButton?.remove();
    this.closeOverlay();
    this.container.classList.remove("mrsf-overlay-root");
  }

  // ── Data loading ────────────────────────────────────────

  private loadCommentData(): void {
    // Priority: constructor options > embedded script
    if (this.opts.comments.length > 0) {
      this.buildThreadMap(this.opts.comments);
      return;
    }

    const script = this.container.querySelector('script[type="application/mrsf+json"]');
    if (!script?.textContent) return;

    try {
      const data = JSON.parse(script.textContent) as { threads?: CommentThread[] };
      if (data.threads) {
        this.buildThreadMap(data.threads);
      }
    } catch {
      // silently ignore malformed data
    }
  }

  private buildThreadMap(threads: CommentThread[]): void {
    this.threads.clear();
    for (const t of threads) {
      const line = t.comment.line;
      if (line == null) continue;
      const arr = this.threads.get(line) ?? [];
      arr.push(t);
      this.threads.set(line, arr);
    }
  }

  // ── Overlay structure ───────────────────────────────────

  private setupOverlayStructure(): void {
    this.container.classList.add("mrsf-overlay-root");

    const pos = this.opts.gutterPosition;
    if (pos === "left" || pos === "both") {
      this.gutterLeft = this.createGutter("mrsf-gutter-left");
    }
    if (pos === "right" || pos === "both") {
      this.gutterRight = this.createGutter("mrsf-gutter-right");
    }
  }

  private createGutter(cls: string): HTMLDivElement {
    const gutter = document.createElement("div");
    gutter.className = `mrsf-gutter ${cls}`;
    this.container.appendChild(gutter);
    return gutter;
  }

  // ── Gutter rendering ───────────────────────────────────

  /** Build badge/add-button elements for each line in the gutter(s). */
  private renderGutterItems(): void {
    const lines = this.collectLines();
    const gutter = this.primaryGutter();
    if (!gutter) return;

    for (const line of lines) {
      const threads = this.threads.get(line);
      if (threads && threads.length > 0) {
        const item = this.createBadgeItem(line, threads);
        gutter.appendChild(item);
      } else if (this.opts.interactive) {
        const item = this.createAddItem(line);
        gutter.appendChild(item);
      }
    }
  }

  private primaryGutter(): HTMLDivElement | null {
    return this.gutterLeft ?? this.gutterRight;
  }

  /** Collect all unique line numbers from data-mrsf-line elements. */
  private collectLines(): number[] {
    const els = this.container.querySelectorAll<HTMLElement>("[data-mrsf-line]");
    const seen = new Set<number>();
    for (const el of els) {
      if (el.tagName === "SCRIPT") continue;
      const line = parseInt(el.dataset.mrsfLine!, 10);
      if (!isNaN(line)) seen.add(line);
    }
    return [...seen].sort((a, b) => a - b);
  }

  private createBadgeItem(line: number, threads: CommentThread[]): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "mrsf-gutter-item";
    item.dataset.mrsfGutterLine = String(line);

    const total = threads.reduce((n, t) => n + 1 + t.replies.length, 0);
    const allResolved = threads.every((t) => t.comment.resolved);
    const highestSeverity = threads.reduce<string | null>((sev, t) => {
      if (t.comment.severity === "high" || sev === "high") return "high";
      if (t.comment.severity === "medium" || sev === "medium") return "medium";
      if (t.comment.severity === "low" || sev === "low") return "low";
      return sev;
    }, null);

    const classes = ["mrsf-badge"];
    if (allResolved) classes.push("mrsf-badge-resolved");
    if (highestSeverity === "high" || highestSeverity === "medium") {
      classes.push(`mrsf-badge-severity-${highestSeverity}`);
    }

    const icon = allResolved ? "✓" : "💬";
    const badge = document.createElement("span");
    badge.className = classes.join(" ");
    badge.dataset.mrsfLine = String(line);
    badge.dataset.mrsfAction = "navigate";
    badge.dataset.mrsfCommentId = threads[0].comment.id;
    badge.tabIndex = 0;
    badge.textContent = `${icon} ${total}`;
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleTooltip(item, line, threads);
    });

    item.appendChild(badge);

    if (this.opts.interactive) {
      const addBtn = this.createAddButton(line);
      item.appendChild(addBtn);
    }

    return item;
  }

  private createAddItem(line: number): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "mrsf-gutter-item";
    item.dataset.mrsfGutterLine = String(line);

    const addBtn = this.createAddButton(line);
    item.appendChild(addBtn);
    return item;
  }

  private createAddButton(line: number): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "mrsf-gutter-add";
    btn.dataset.mrsfAction = "add";
    btn.dataset.mrsfLine = String(line);
    btn.dataset.mrsfStartLine = String(line);
    btn.dataset.mrsfEndLine = String(line);
    btn.setAttribute("aria-label", "Add comment");
    btn.textContent = "+";
    return btn;
  }

  // ── Positioning ─────────────────────────────────────────

  /** Measure [data-mrsf-line] elements and set gutter item Y offsets. */
  positionGutterItems(): void {
    const containerRect = this.container.getBoundingClientRect();

    const gutters = [this.gutterLeft, this.gutterRight].filter(Boolean) as HTMLDivElement[];
    for (const gutter of gutters) {
      const items = gutter.querySelectorAll<HTMLDivElement>(".mrsf-gutter-item");
      for (const item of items) {
        const line = parseInt(item.dataset.mrsfGutterLine!, 10);
        const target = this.container.querySelector<HTMLElement>(
          `[data-mrsf-line="${line}"]:not(script):not(.mrsf-gutter-item)`,
        );
        if (!target) {
          item.style.display = "none";
          continue;
        }
        const targetRect = target.getBoundingClientRect();
        const top = targetRect.top - containerRect.top;
        item.style.top = `${top}px`;
        item.style.display = "";
      }
    }
  }

  // ── Tooltip ─────────────────────────────────────────────

  private toggleTooltip(anchor: HTMLElement, line: number, threads: CommentThread[]): void {
    // If already visible on this anchor, hide it
    if (this.activeTooltip && this.activeTooltip.parentElement === anchor) {
      this.hideTooltip();
      return;
    }
    this.hideTooltip();
    this.showTooltip(anchor, line, threads);
  }

  private showTooltip(anchor: HTMLElement, line: number, threads: CommentThread[]): void {
    const tooltip = document.createElement("div");
    const interactive = this.opts.interactive;
    tooltip.className = interactive
      ? "mrsf-tooltip mrsf-interactive mrsf-tooltip-visible"
      : "mrsf-tooltip mrsf-tooltip-visible";
    tooltip.dataset.mrsfLine = String(line);

    let html = "";
    for (const thread of threads) {
      html += renderThreadHtml(thread, interactive);
    }
    if (interactive) {
      html += `<div class="mrsf-tooltip-actions"><button class="mrsf-action-btn" data-mrsf-action="add" data-mrsf-line="${line}" data-mrsf-start-line="${line}" data-mrsf-end-line="${line}">Add comment</button></div>`;
    }
    tooltip.innerHTML = html;

    anchor.appendChild(tooltip);
    this.activeTooltip = tooltip;
  }

  private hideTooltip(): void {
    if (this.activeTooltip) {
      this.activeTooltip.remove();
      this.activeTooltip = null;
    }
  }

  // ── Click handling ──────────────────────────────────────

  private handleClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-mrsf-action]");

    // Close tooltip when clicking outside
    if (!target && this.activeTooltip) {
      const tooltipClick = (e.target as HTMLElement).closest(".mrsf-tooltip");
      if (!tooltipClick) {
        this.hideTooltip();
      }
      return;
    }
    if (!target) return;

    const action = target.dataset.mrsfAction as MrsfAction | undefined;
    if (!action) return;

    const commentId = target.dataset.mrsfCommentId ?? null;
    const lineStr = target.dataset.mrsfLine;
    const line = lineStr ? parseInt(lineStr, 10) : null;
    const selectionText = target.dataset.mrsfSelection ?? this.lastSelectionText ?? null;

    const startLineStr = target.dataset.mrsfStartLine;
    const endLineStr = target.dataset.mrsfEndLine;
    const startColStr = target.dataset.mrsfStartColumn;
    const endColStr = target.dataset.mrsfEndColumn;
    const startLine = startLineStr ? parseInt(startLineStr, 10) : (line ?? null);
    const endLine = endLineStr ? parseInt(endLineStr, 10) : (line ?? null);
    const startColumn = startColStr ? parseInt(startColStr, 10) : null;
    const endColumn = endColStr ? parseInt(endColStr, 10) : null;

    e.preventDefault();
    e.stopPropagation();

    const detail: MrsfActionDetail = {
      commentId,
      line,
      action,
      selectionText,
      start_line: startLine,
      end_line: endLine,
      start_column: startColumn,
      end_column: endColumn,
    };

    if (action === "add" || action === "edit" || action === "reply") {
      if (action === "add") {
        this.hideFloatingAddButton();
      }
      this.openForm(action, detail);
      return;
    }

    if (action === "resolve" || action === "unresolve" || action === "delete") {
      this.openConfirm(action, detail);
      return;
    }

    document.dispatchEvent(
      new CustomEvent(`mrsf:${action}`, { detail, bubbles: true }),
    );
  }

  // ── Selection handling ──────────────────────────────────

  private handleSelectionChange(): void {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.hideFloatingAddButton();
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      this.hideFloatingAddButton();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      this.hideFloatingAddButton();
      return;
    }

    const startAnchor = (range.startContainer as Node).parentElement?.closest<HTMLElement>(
      "[data-mrsf-line]",
    );
    const endAnchor = (range.endContainer as Node).parentElement?.closest<HTMLElement>(
      "[data-mrsf-line]",
    );
    const startLineStr = startAnchor?.dataset.mrsfStartLine ?? startAnchor?.dataset.mrsfLine;
    const endLineStr = endAnchor?.dataset.mrsfEndLine ?? endAnchor?.dataset.mrsfLine ?? startLineStr;
    const startLine = startLineStr ? parseInt(startLineStr, 10) : null;
    const endLine = endLineStr ? parseInt(endLineStr, 10) : startLine;

    const startColumn = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startOffset : null;
    const endColumn = range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endOffset : null;

    this.showFloatingAddButton(startLine, endLine, startColumn, endColumn, rect, text);
  }

  private ensureFloatingAddButton(): HTMLButtonElement {
    if (this.floatingAddButton) return this.floatingAddButton;
    const btn = document.createElement("button");
    btn.textContent = "Add comment";
    btn.className = "mrsf-add-inline-button";
    btn.dataset.mrsfAction = "add";
    btn.style.display = "none";
    btn.style.position = "absolute";
    btn.style.zIndex = "1200";
    document.body.appendChild(btn);
    this.floatingAddButton = btn;
    return btn;
  }

  private hideFloatingAddButton(): void {
    if (!this.floatingAddButton) return;
    this.floatingAddButton.style.display = "none";
    this.floatingAddButton.dataset.mrsfLine = "";
    this.floatingAddButton.dataset.mrsfStartLine = "";
    this.floatingAddButton.dataset.mrsfEndLine = "";
    this.lastSelectionText = null;
  }

  private showFloatingAddButton(
    startLine: number | null,
    endLine: number | null,
    startColumn: number | null,
    endColumn: number | null,
    rect: DOMRect,
    selectionText: string,
  ): void {
    const btn = this.ensureFloatingAddButton();
    if (startLine != null) {
      btn.dataset.mrsfLine = String(startLine);
      btn.dataset.mrsfStartLine = String(startLine);
      btn.dataset.mrsfEndLine = String(endLine ?? startLine);
    } else {
      delete btn.dataset.mrsfLine;
      delete btn.dataset.mrsfStartLine;
      delete btn.dataset.mrsfEndLine;
    }
    if (startColumn != null) {
      btn.dataset.mrsfStartColumn = String(startColumn);
    } else {
      delete btn.dataset.mrsfStartColumn;
    }
    if (endColumn != null) {
      btn.dataset.mrsfEndColumn = String(endColumn);
    } else {
      delete btn.dataset.mrsfEndColumn;
    }
    this.lastSelectionText = selectionText;

    const margin = 6;
    btn.style.visibility = "hidden";
    btn.style.display = "block";
    const height = btn.offsetHeight || 0;
    const top = window.scrollY + rect.top - height - margin;
    const left = window.scrollX + rect.left;
    btn.style.top = `${Math.max(0, top)}px`;
    btn.style.left = `${Math.max(0, left)}px`;
    btn.style.visibility = "visible";
  }

  // ── Dialog: form (add/edit/reply) ───────────────────────

  private injectStyles(): void {
    if (this.styleInjected) return;
    const css = `
.mrsf-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 2000; display: flex; align-items: center; justify-content: center; }
.mrsf-dialog { background: var(--mrsf-dialog-bg, var(--vp-c-bg, #1e1e1e)); color: var(--mrsf-dialog-fg, var(--vp-c-text-1, #f3f3f3)); border: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #444)); border-radius: 8px; width: min(520px, 90vw); box-shadow: 0 10px 40px rgba(0,0,0,0.35); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.mrsf-dialog header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #333)); }
.mrsf-dialog form { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.mrsf-field { display: flex; flex-direction: column; gap: 6px; }
.mrsf-field label { font-size: 13px; color: var(--mrsf-dialog-muted, var(--vp-c-text-2, #ccc)); }
.mrsf-field input, .mrsf-field select, .mrsf-field textarea { background: var(--mrsf-field-bg, var(--vp-c-bg-soft, #252526)); color: var(--mrsf-dialog-fg, var(--vp-c-text-1, #f3f3f3)); border: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #3c3c3c)); border-radius: 4px; padding: 6px 8px; font-size: 13px; }
.mrsf-field textarea { min-height: 100px; resize: vertical; }
.mrsf-actions-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 0; padding: 12px 16px 16px; border-top: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #333)); }
.mrsf-btn { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #3c3c3c)); background: var(--mrsf-button-bg, var(--vp-c-bg-soft, #2d2d30)); color: var(--mrsf-dialog-fg, var(--vp-c-text-1, #f3f3f3)); cursor: pointer; }
.mrsf-btn-primary { background: var(--mrsf-button-primary-bg, #0e639c); border-color: var(--mrsf-button-primary-bg, #0e639c); color: #fff; }
.mrsf-helper { font-size: 12px; color: var(--mrsf-dialog-muted, var(--vp-c-text-2, #aaa)); }
`;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    this.styleInjected = true;
  }

  private closeOverlay(): void {
    if (this.overlayEl?.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
  }

  private openForm(action: "add" | "edit" | "reply", detail: MrsfActionDetail): void {
    if ((window as any).mrsfDisableBuiltinUi) return;
    this.injectStyles();
    this.closeOverlay();

    const selText = detail.selectionText ?? "";
    const line = detail.line ?? detail.start_line ?? null;
    const endLine = detail.end_line ?? detail.line ?? null;
    const startCol = detail.start_column ?? null;
    const endCol = detail.end_column ?? null;

    const overlay = document.createElement("div");
    overlay.className = "mrsf-overlay";

    const dialog = document.createElement("div");
    dialog.className = "mrsf-dialog";

    const header = document.createElement("header");
    header.textContent =
      action === "add" ? "Add comment" : action === "edit" ? "Edit comment" : "Reply";
    dialog.appendChild(header);

    const form = document.createElement("form");

    const field = (labelText: string, inputEl: HTMLElement, helper?: string) => {
      const wrap = document.createElement("div");
      wrap.className = "mrsf-field";
      const label = document.createElement("label");
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      if (helper) {
        const h = document.createElement("div");
        h.className = "mrsf-helper";
        h.textContent = helper;
        wrap.appendChild(h);
      }
      form.appendChild(wrap);
    };

    const textArea = document.createElement("textarea");
    textArea.name = "text";
    textArea.required = true;
    field("Comment text", textArea);

    const typeSelect = document.createElement("select");
    typeSelect.name = "type";
    ["", "suggestion", "issue", "question", "accuracy", "style", "clarity"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t || "(none)";
      typeSelect.appendChild(opt);
    });
    field("Type", typeSelect, "Optional");

    const severitySelect = document.createElement("select");
    severitySelect.name = "severity";
    ["", "low", "medium", "high"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s || "(none)";
      severitySelect.appendChild(opt);
    });
    field("Severity", severitySelect, "Optional");

    if (selText) {
      const pre = document.createElement("pre");
      pre.textContent = selText;
      pre.style.margin = "0";
      pre.style.whiteSpace = "pre-wrap";
      field("Selected text", pre as unknown as HTMLElement, "Captured automatically");
    }

    const actions = document.createElement("div");
    actions.className = "mrsf-actions-row";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "mrsf-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.closeOverlay());
    actions.appendChild(cancelBtn);

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "mrsf-btn mrsf-btn-primary";
    submitBtn.textContent = action === "add" ? "Add" : action === "reply" ? "Reply" : "Save";
    actions.appendChild(submitBtn);

    form.appendChild(actions);

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const detailOut: MrsfSubmitDetail = {
        action,
        commentId: detail.commentId,
        text: textArea.value.trim(),
        type: typeSelect.value || null,
        severity: (severitySelect.value as MrsfSubmitDetail["severity"]) || null,
        line,
        end_line: endLine,
        start_column: startCol,
        end_column: endCol,
        selection_text: selText || null,
      };
      document.dispatchEvent(new CustomEvent("mrsf:submit", { detail: detailOut, bubbles: true }));
      this.closeOverlay();
    });

    dialog.appendChild(form);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closeOverlay();
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;
  }

  // ── Dialog: confirm (resolve / unresolve / delete) ──────

  private openConfirm(action: "resolve" | "unresolve" | "delete", detail: MrsfActionDetail): void {
    if ((window as any).mrsfDisableBuiltinUi) return;
    this.injectStyles();
    this.closeOverlay();

    const overlay = document.createElement("div");
    overlay.className = "mrsf-overlay";

    const dialog = document.createElement("div");
    dialog.className = "mrsf-dialog";

    const header = document.createElement("header");
    header.textContent = action === "delete" ? "Delete comment" : "Change status";
    dialog.appendChild(header);

    const body = document.createElement("div");
    body.style.padding = "16px";
    body.textContent =
      action === "delete"
        ? "Delete this comment?"
        : action === "resolve"
          ? "Mark this comment as resolved?"
          : "Mark this comment as unresolved?";
    dialog.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "mrsf-actions-row";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "mrsf-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.closeOverlay());
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "mrsf-btn mrsf-btn-primary";
    confirmBtn.textContent = action === "delete" ? "Delete" : "Confirm";
    confirmBtn.addEventListener("click", () => {
      const detailOut: MrsfSubmitDetail = {
        action,
        commentId: detail.commentId,
        text: "",
        type: null,
        severity: null,
        line: detail.line,
        end_line: detail.end_line ?? detail.line ?? null,
        start_column: detail.start_column ?? null,
        end_column: detail.end_column ?? null,
        selection_text: detail.selectionText ?? null,
      };
      document.dispatchEvent(new CustomEvent("mrsf:submit", { detail: detailOut, bubbles: true }));
      this.closeOverlay();
    });
    actions.appendChild(confirmBtn);

    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.closeOverlay();
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;
  }
}

// ── Auto-init convenience ─────────────────────────────────
// Scan for containers with [data-mrsf-controller] and auto-init.

let autoInitDone = false;

export function autoInit(): void {
  if (autoInitDone) return;
  autoInitDone = true;

  const containers = document.querySelectorAll<HTMLElement>("[data-mrsf-controller]");
  for (const container of containers) {
    const pos = container.dataset.mrsfGutterPosition as MrsfControllerOptions["gutterPosition"] | undefined;
    const interactive = container.dataset.mrsfInteractive === "true";
    new MrsfController(container, { gutterPosition: pos ?? "right", interactive });
  }
}

// Auto-init on DOMContentLoaded if in browser context
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }
}

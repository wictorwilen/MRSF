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
  /** Show gutter on left or right side. Default: "right". */
  gutterPosition?: "left" | "right";
  /** Enable interactive actions (add, resolve, reply, etc.). Default: false. */
  interactive?: boolean;
  /** Comment data passed directly (overrides embedded script). */
  comments?: CommentThread[];
  /**
   * Render inline text highlights for comments that have `selected_text`.
   * Wraps matching text in `<mark>` elements with hover tooltips.
   * Default: true.
   */
  inlineHighlights?: boolean;
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
  private mutationObserver: MutationObserver | null = null;
  private styleInjected = false;
  private inlineMarks: HTMLElement[] = [];
  private inlineTooltipEl: HTMLElement | null = null;
  private orphanedSection: HTMLDivElement | null = null;
  private refreshQueued = false;

  private handleResizeBound = this.positionGutterItems.bind(this);
  private handleMutationBound = this.handleMutations.bind(this);
  private handleClickBound = this.handleClick.bind(this);
  private handleSelectionBound = this.handleSelectionChange.bind(this);

  constructor(container: HTMLElement, options: MrsfControllerOptions = {}) {
    this.container = container;
    this.opts = {
      gutterPosition: options.gutterPosition ?? "right",
      interactive: options.interactive ?? false,
      comments: options.comments ?? [],
      inlineHighlights: options.inlineHighlights ?? true,
    };

    this.loadCommentData();
    this.setupOverlayStructure();
    this.renderGutterItems();
    this.positionGutterItems();
    this.renderInlineHighlights();
    this.renderOrphanedSection();

    controllerRegistry.add(this);

    // Listeners
    this.resizeObserver = new ResizeObserver(this.handleResizeBound);
    this.resizeObserver.observe(this.container);
    if (typeof MutationObserver !== "undefined") {
      this.mutationObserver = new MutationObserver(this.handleMutationBound);
      this.mutationObserver.observe(this.container, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    document.addEventListener("click", this.handleClickBound);
    if (this.opts.interactive) {
      document.addEventListener("selectionchange", this.handleSelectionBound);
    }
  }

  /** Remove all controller DOM and listeners. */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    controllerRegistry.delete(this);
    document.removeEventListener("click", this.handleClickBound);
    document.removeEventListener("selectionchange", this.handleSelectionBound);
    this.removeInlineHighlights();
    this.orphanedSection?.remove();
    this.gutterLeft?.remove();
    this.gutterRight?.remove();
    this.floatingAddButton?.remove();
    this.closeOverlay();
    this.container.classList.remove("mrsf-overlay-root");
  }

  /** Recalculate gutter positions after async layout changes such as Mermaid renders. */
  refresh(): void {
    this.positionGutterItems();
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

  private findCommentById(commentId: string | null): SlimComment | null {
    if (!commentId) return null;

    for (const threadList of this.threads.values()) {
      for (const thread of threadList) {
        if (thread.comment.id === commentId) {
          return thread.comment;
        }
        const reply = thread.replies.find((item) => item.id === commentId);
        if (reply) {
          return reply;
        }
      }
    }

    return null;
  }

  private orderThreadsForDisplay(threads: CommentThread[]): CommentThread[] {
    return [...threads].sort((left, right) => {
      if (left.comment.resolved === right.comment.resolved) return 0;
      return left.comment.resolved ? 1 : -1;
    });
  }

  // ── Overlay structure ───────────────────────────────────

  private setupOverlayStructure(): void {
    this.container.classList.add("mrsf-overlay-root");

    const pos = this.opts.gutterPosition;
    if (pos === "left") {
      this.gutterLeft = this.createGutter("mrsf-gutter-left");
    } else {
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

  private shouldExpandRange(el: HTMLElement): boolean {
    return el.tagName === "BLOCKQUOTE" || el.tagName === "PRE";
  }

  private addVisibleLinesForElement(el: HTMLElement, seen: Set<number>): void {
    const line = parseInt(el.dataset.mrsfLine ?? "", 10);
    const startLine = parseInt(el.dataset.mrsfStartLine ?? "", 10);
    const endLine = parseInt(el.dataset.mrsfEndLine ?? "", 10);

    if (el.tagName === "PRE" && !isNaN(startLine) && !isNaN(endLine) && endLine > startLine) {
      const visibleStart = startLine + 1;
      const visibleEnd = endLine - 1;
      for (let currentLine = visibleStart; currentLine <= visibleEnd; currentLine++) {
        seen.add(currentLine);
      }
      return;
    }

    if (!isNaN(line)) {
      seen.add(line);
    }

    if (
      this.shouldExpandRange(el) &&
      !isNaN(startLine) &&
      !isNaN(endLine) &&
      endLine > startLine
    ) {
      for (let currentLine = startLine; currentLine <= endLine; currentLine++) {
        seen.add(currentLine);
      }
    }
  }

  /** Collect all unique line numbers from data-mrsf-line elements, expanding multi-line ranges. */
  private collectLines(): number[] {
    const els = this.container.querySelectorAll<HTMLElement>("[data-mrsf-line]");
    const seen = new Set<number>();
    for (const el of els) {
      if (el.tagName === "SCRIPT") continue;
      this.addVisibleLinesForElement(el, seen);
    }

    return [...seen].sort((a, b) => a - b);
  }

  private createBadgeItem(line: number, threads: CommentThread[]): HTMLDivElement {
    const item = document.createElement("div");
    item.className = "mrsf-gutter-item";
    item.dataset.mrsfGutterLine = String(line);

    const displayThreads = this.orderThreadsForDisplay(threads);

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
    badge.dataset.mrsfCommentId = displayThreads[0].comment.id;
    badge.tabIndex = 0;
    badge.textContent = `${icon} ${total}`;
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleTooltip(item, line, displayThreads);
    });

    item.appendChild(badge);

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
    btn.type = "button";
    btn.dataset.mrsfAction = "add";
    btn.dataset.mrsfLine = String(line);
    btn.dataset.mrsfStartLine = String(line);
    btn.dataset.mrsfEndLine = String(line);
    btn.setAttribute("aria-label", "Add comment");
    btn.textContent = "Add";
    return btn;
  }

  // ── Positioning ─────────────────────────────────────────

  /** Measure [data-mrsf-line] elements and set gutter item Y offsets. */
  positionGutterItems(): void {
    const containerRect = this.container.getBoundingClientRect();

    const gutters = [this.gutterLeft, this.gutterRight].filter(Boolean) as HTMLDivElement[];
    for (const gutter of gutters) {
      const items = gutter.querySelectorAll<HTMLDivElement>(".mrsf-gutter-item");
      const positioned: Array<{ item: HTMLDivElement; target: HTMLElement; kind: "badge" | "add" }> = [];
      for (const item of items) {
        const line = parseInt(item.dataset.mrsfGutterLine!, 10);
        // For expanded multi-line elements, find the rendered content element whose line data contains this line.
        let target = this.findDirectElementForLine(line);
        if (!target) {
          target = this.findElementForLine(line);
        }
        if (!target) {
          item.style.display = "none";
          continue;
        }
        const top = this.calculateItemTop(target, line, containerRect);
        item.style.top = `${top}px`;
        item.style.display = "";
        positioned.push({
          item,
          target,
          kind: item.querySelector(".mrsf-badge") ? "badge" : "add",
        });
      }

      this.suppressAddItemsThatShareBadgeTargets(positioned);
    }
  }

  private suppressAddItemsThatShareBadgeTargets(
    positioned: Array<{ item: HTMLDivElement; target: HTMLElement; kind: "badge" | "add" }>,
  ): void {
    const badgeTargets = new Set(
      positioned
        .filter((entry) => entry.kind === "badge")
        .map((entry) => entry.target),
    );

    for (const entry of positioned) {
      if (entry.kind === "add" && badgeTargets.has(entry.target)) {
        entry.item.style.display = "none";
      }
    }
  }

  private handleMutations(records: MutationRecord[]): void {
    if (!records.some((record) => this.isExternalContentMutation(record))) {
      return;
    }
    this.queueRefresh();
  }

  private isExternalContentMutation(record: MutationRecord): boolean {
    const target = record.target instanceof Node ? record.target : null;
    if (target && this.isControllerOwnedNode(target)) {
      return false;
    }

    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (!this.isControllerOwnedNode(node)) {
        return true;
      }
    }

    return record.type === "characterData";
  }

  private isControllerOwnedNode(node: Node): boolean {
    if (!(node instanceof Element)) {
      return false;
    }
    return Boolean(
      node.closest(".mrsf-gutter") ||
      node.closest(".mrsf-orphaned-section") ||
      node.closest("script[type=\"application/mrsf+json\"]"),
    );
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  private findDirectElementForLine(line: number): HTMLElement | null {
    const els = this.container.querySelectorAll<HTMLElement>(`[data-mrsf-line="${line}"]`);
    for (const el of els) {
      if (el.tagName === "SCRIPT") continue;
      if (el.closest(".mrsf-gutter")) continue;
      if (el.classList.contains("mrsf-gutter-item")) continue;
      return el;
    }
    return null;
  }

  private calculateItemTop(target: HTMLElement, line: number, containerRect: DOMRect): number {
    const targetRect = target.getBoundingClientRect();
    const rangeTop = targetRect.top - containerRect.top + this.container.scrollTop;

    if (target.tagName !== "PRE") {
      return rangeTop;
    }

    const startLine = parseInt(target.dataset.mrsfStartLine ?? "", 10);
    const endLine = parseInt(target.dataset.mrsfEndLine ?? "", 10);
    const visibleStart = startLine + 1;
    const visibleEnd = endLine - 1;
    const visibleLineCount = visibleEnd - visibleStart + 1;

    if (
      isNaN(startLine) ||
      isNaN(endLine) ||
      visibleLineCount <= 0 ||
      line < visibleStart ||
      line > visibleEnd
    ) {
      return rangeTop;
    }

    const styles = window.getComputedStyle(target);
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const paddingBottom = parseFloat(styles.paddingBottom) || 0;
    const contentHeight = Math.max(targetRect.height - paddingTop - paddingBottom, 0);

    let lineHeight = parseFloat(styles.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      lineHeight = visibleLineCount > 0 ? contentHeight / visibleLineCount : 0;
    }

    return rangeTop + paddingTop + (line - visibleStart) * lineHeight;
  }

  /**
   * Find the element whose start-line/end-line range contains the given line.
   * Used for positioning gutter items on expanded multi-line elements.
   */
  private findElementForLine(line: number): HTMLElement | null {
    const els = this.container.querySelectorAll<HTMLElement>("[data-mrsf-start-line][data-mrsf-end-line]");
    for (const el of els) {
      if (el.tagName === "SCRIPT") continue;
      const start = parseInt(el.dataset.mrsfStartLine!, 10);
      const end = parseInt(el.dataset.mrsfEndLine!, 10);
      if (!isNaN(start) && !isNaN(end) && line >= start && line <= end) {
        return el;
      }
    }
    return null;
  }

  // ── Orphaned comments section ────────────────────────────

  /**
   * Render orphaned comments (whose line doesn't match any DOM element)
   * in a dedicated section at the bottom of the container.
   */
  private renderOrphanedSection(): void {
    const lines = this.collectLines();
    const lineSet = new Set(lines);
    const orphanedThreads: CommentThread[] = [];

    for (const [line, threads] of this.threads) {
      if (!lineSet.has(line)) {
        orphanedThreads.push(...threads);
      }
    }

    if (orphanedThreads.length === 0) return;

    const section = document.createElement("div");
    section.className = "mrsf-orphaned-section";

    const heading = document.createElement("div");
    heading.className = "mrsf-orphaned-heading";
    heading.textContent = `Orphaned Comments (${orphanedThreads.length})`;
    section.appendChild(heading);

    const interactive = this.opts.interactive;
    for (const thread of this.orderThreadsForDisplay(orphanedThreads)) {
      const wrapper = document.createElement("div");
      wrapper.className = interactive
        ? "mrsf-orphaned-thread mrsf-interactive"
        : "mrsf-orphaned-thread";
      wrapper.innerHTML = renderThreadHtml(thread, interactive);
      section.appendChild(wrapper);
    }

    this.container.appendChild(section);
    this.orphanedSection = section;
  }

  // ── Inline text highlights ──────────────────────────────

  /**
   * For comments with `selected_text`, find the matching text in the DOM
   * and wrap it in a `<mark class="mrsf-inline-highlight">` element with
   * hover/click behaviour to show the comment tooltip.
   */
  private renderInlineHighlights(): void {
    if (!this.opts.inlineHighlights) return;

    for (const [line, threads] of this.threads) {
      for (const thread of threads) {
        const comment = thread.comment;
        if (!comment.selected_text) continue;

        const el = this.container.querySelector<HTMLElement>(
          `[data-mrsf-line="${line}"]:not(script):not(.mrsf-gutter):not(.mrsf-gutter-item)`,
        );
        if (!el) continue;

        this.wrapSelectedText(el, comment.selected_text, thread);
      }
    }
  }

  /**
   * Strip common inline markdown syntax so `selected_text` from source
   * can be matched against rendered text content.
   */
  private static stripInlineMarkdown(text: string): string {
    let s = text;
    // Backtick code spans: `code` → code
    s = s.replace(/`([^`]+)`/g, "$1");
    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, "$1");
    s = s.replace(/__(.+?)__/g, "$1");
    // Italic: *text* or _text_
    s = s.replace(/\*(.+?)\*/g, "$1");
    s = s.replace(/_(.+?)_/g, "$1");
    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, "$1");
    return s;
  }

  /**
   * Walk text nodes inside `root` to find `text`, then wrap the matching
   * range in a `<mark>` element. Falls back to markdown-stripped matching.
   */
  private wrapSelectedText(
    root: HTMLElement,
    selectedText: string,
    thread: CommentThread,
  ): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let accumulated = "";
    const textNodes: { node: Text; start: number; end: number }[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const start = accumulated.length;
      accumulated += node.textContent || "";
      textNodes.push({ node, start, end: accumulated.length });
    }

    // Try exact match first, then stripped markdown
    let matchStart = accumulated.indexOf(selectedText);
    let matchLen = selectedText.length;
    if (matchStart === -1) {
      const stripped = MrsfController.stripInlineMarkdown(selectedText);
      if (stripped !== selectedText) {
        matchStart = accumulated.indexOf(stripped);
        matchLen = stripped.length;
      }
    }
    if (matchStart === -1) return;

    const matchEnd = matchStart + matchLen;

    // Build a Range spanning the matched text nodes
    const range = document.createRange();
    let startSet = false;

    for (const tn of textNodes) {
      if (!startSet && tn.end > matchStart) {
        range.setStart(tn.node, matchStart - tn.start);
        startSet = true;
      }
      if (startSet && tn.end >= matchEnd) {
        range.setEnd(tn.node, matchEnd - tn.start);
        break;
      }
    }

    if (!startSet) return;

    const mark = document.createElement("mark");
    mark.className = "mrsf-inline-highlight";
    mark.dataset.mrsfCommentId = thread.comment.id;
    mark.dataset.mrsfLine = String(thread.comment.line);

    try {
      range.surroundContents(mark);
    } catch {
      // Range crosses element boundaries — extract and re-insert
      const fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
    }

    this.inlineMarks.push(mark);

    // Hover shows tooltip inline
    mark.addEventListener("mouseenter", () => {
      this.showInlineTooltip(mark, thread);
    });
    mark.addEventListener("mouseleave", (e) => {
      // Don't hide if moving into the tooltip itself
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related && this.inlineTooltipEl?.contains(related)) return;
      this.scheduleHideInlineTooltip();
    });

    // Click toggles tooltip (for touch / accessibility)
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.inlineTooltipEl && this.inlineTooltipEl.dataset.mrsfForMark === thread.comment.id) {
        this.hideInlineTooltip();
      } else {
        this.showInlineTooltip(mark, thread);
      }
    });
  }

  private showInlineTooltip(mark: HTMLElement, thread: CommentThread): void {
    this.hideInlineTooltip();

    const tooltip = document.createElement("div");
    tooltip.className = this.opts.interactive
      ? "mrsf-inline-tooltip mrsf-interactive mrsf-tooltip-visible"
      : "mrsf-inline-tooltip mrsf-tooltip-visible";
    tooltip.dataset.mrsfForMark = thread.comment.id;
    tooltip.innerHTML = renderThreadHtml(thread, this.opts.interactive);
    this.applyThemeVariables(tooltip);

    // Let user mouse into tooltip without it disappearing
    tooltip.addEventListener("mouseenter", () => {
      this.cancelHideInlineTooltip();
    });
    tooltip.addEventListener("mouseleave", () => {
      this.hideInlineTooltip();
    });

    // Append to body with fixed positioning to avoid clipping
    document.body.appendChild(tooltip);
    this.inlineTooltipEl = tooltip;

    // Position relative to the mark element
    const rect = mark.getBoundingClientRect();
    const margin = 4;
    const tooltipH = tooltip.offsetHeight;

    // Prefer below; flip above if not enough space at bottom
    if (rect.bottom + margin + tooltipH > window.innerHeight) {
      tooltip.style.top = `${rect.top - tooltipH - margin}px`;
    } else {
      tooltip.style.top = `${rect.bottom + margin}px`;
    }
    tooltip.style.left = `${Math.max(0, rect.left)}px`;
  }

  private applyThemeVariables(el: HTMLElement): void {
    const styles = window.getComputedStyle(this.container);
    const themeVars = [
      "--mrsf-accent",
      "--mrsf-badge-bg",
      "--mrsf-badge-fg",
      "--mrsf-badge-resolved-bg",
      "--mrsf-add-bg",
      "--mrsf-add-fg",
      "--mrsf-add-border",
      "--mrsf-tooltip-bg",
      "--mrsf-tooltip-fg",
      "--mrsf-tooltip-border",
      "--mrsf-highlight-bg",
      "--mrsf-highlight-border",
      "--mrsf-severity-high",
      "--mrsf-severity-medium",
      "--mrsf-severity-low",
      "--mrsf-font-family",
    ];

    for (const name of themeVars) {
      const value = styles.getPropertyValue(name).trim();
      if (value) {
        el.style.setProperty(name, value);
      }
    }
  }

  private hideInlineTimeout: ReturnType<typeof setTimeout> | null = null;

  private scheduleHideInlineTooltip(): void {
    this.hideInlineTimeout = setTimeout(() => this.hideInlineTooltip(), 120);
  }

  private cancelHideInlineTooltip(): void {
    if (this.hideInlineTimeout) {
      clearTimeout(this.hideInlineTimeout);
      this.hideInlineTimeout = null;
    }
  }

  private hideInlineTooltip(): void {
    this.cancelHideInlineTooltip();
    if (this.inlineTooltipEl) {
      this.inlineTooltipEl.remove();
      this.inlineTooltipEl = null;
    }
  }

  /** Remove all inline marks, unwrapping their contents back to text. */
  private removeInlineHighlights(): void {
    this.hideInlineTooltip();
    for (const mark of this.inlineMarks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    }
    this.inlineMarks = [];
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
    for (const thread of this.orderThreadsForDisplay(threads)) {
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
    if (!this.selectionBelongsToContainer(range)) {
      this.hideFloatingAddButton();
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      this.hideFloatingAddButton();
      return;
    }

    const startAnchor = this.findSelectionAnchor(range.startContainer);
    const endAnchor = this.findSelectionAnchor(range.endContainer);
    if (!startAnchor || !endAnchor) {
      this.hideFloatingAddButton();
      return;
    }

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

  private selectionBelongsToContainer(range: Range): boolean {
    return this.container.contains(range.commonAncestorContainer)
      && this.container.contains(range.startContainer)
      && this.container.contains(range.endContainer);
  }

  private findSelectionAnchor(node: Node): HTMLElement | null {
    const element = node instanceof Element ? node : node.parentElement;
    const anchor = element?.closest<HTMLElement>("[data-mrsf-line]") ?? null;
    return anchor && this.container.contains(anchor) ? anchor : null;
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
    this.container.appendChild(btn);
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
    const containerRect = this.container.getBoundingClientRect();
    btn.style.visibility = "hidden";
    btn.style.display = "block";
    const width = btn.offsetWidth || 0;
    const height = btn.offsetHeight || 0;

    const minTop = this.container.scrollTop;
    const maxTop = Math.max(minTop, minTop + this.container.clientHeight - height);
    const minLeft = this.container.scrollLeft;
    const maxLeft = Math.max(minLeft, minLeft + this.container.clientWidth - width);

    const preferredTop = rect.top - containerRect.top + this.container.scrollTop - height - margin;
    const fallbackTop = rect.bottom - containerRect.top + this.container.scrollTop + margin;
    const unclampedTop = preferredTop < minTop ? fallbackTop : preferredTop;
    const unclampedLeft = rect.left - containerRect.left + this.container.scrollLeft;

    const top = Math.min(Math.max(unclampedTop, minTop), maxTop);
    const left = Math.min(Math.max(unclampedLeft, minLeft), maxLeft);

    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
    btn.style.visibility = "visible";
  }

  // ── Dialog: form (add/edit/reply) ───────────────────────

  private injectStyles(): void {
    if (this.styleInjected) return;
    const css = `
.mrsf-overlay { position: fixed; inset: 0; background: var(--mrsf-dialog-backdrop, rgba(15, 23, 42, 0.28)); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 12px; }
.mrsf-dialog { background: var(--mrsf-dialog-bg, var(--mrsf-tooltip-bg, #0f172a)); color: var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)); border: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); border-radius: 10px; width: min(420px, calc(100vw - 24px)); box-shadow: 0 18px 48px rgba(15, 23, 42, 0.24); font-family: var(--mrsf-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); font-size: 13px; overflow: hidden; }
.mrsf-dialog header { padding: 10px 12px; font-weight: 600; line-height: 1.35; border-bottom: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); }
.mrsf-dialog form { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.mrsf-dialog-body { padding: 12px; line-height: 1.45; }
.mrsf-field { display: flex; flex-direction: column; gap: 4px; }
.mrsf-field label { font-size: 12px; color: var(--mrsf-dialog-muted, color-mix(in srgb, var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)) 72%, transparent)); }
.mrsf-field input, .mrsf-field select, .mrsf-field textarea, .mrsf-field pre { background: var(--mrsf-field-bg, color-mix(in srgb, var(--mrsf-dialog-bg, var(--mrsf-tooltip-bg, #0f172a)) 88%, white)); color: var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)); border: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); border-radius: 6px; padding: 7px 9px; font-size: 12px; line-height: 1.45; }
.mrsf-field textarea { min-height: 76px; resize: vertical; }
.mrsf-field select { min-height: 34px; }
.mrsf-field pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.mrsf-field input:focus, .mrsf-field select:focus, .mrsf-field textarea:focus { outline: 2px solid color-mix(in srgb, var(--mrsf-accent, #2563eb) 38%, transparent); outline-offset: 1px; }
.mrsf-actions-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 0; padding: 10px 12px 12px; border-top: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); }
.mrsf-btn { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); background: var(--mrsf-button-bg, color-mix(in srgb, var(--mrsf-dialog-bg, var(--mrsf-tooltip-bg, #0f172a)) 82%, white)); color: var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)); cursor: pointer; font: inherit; line-height: 1.2; }
.mrsf-btn-primary { background: var(--mrsf-button-primary-bg, var(--mrsf-accent, #2563eb)); border-color: var(--mrsf-button-primary-bg, var(--mrsf-accent, #2563eb)); color: #fff; }
.mrsf-helper { font-size: 11px; color: var(--mrsf-dialog-muted, color-mix(in srgb, var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)) 72%, transparent)); }
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

    const sourceComment = action === "edit" ? this.findCommentById(detail.commentId) : null;
    const selText = detail.selectionText ?? sourceComment?.selected_text ?? "";
    const line = detail.line ?? detail.start_line ?? sourceComment?.line ?? null;
    const endLine = detail.end_line ?? detail.line ?? sourceComment?.end_line ?? sourceComment?.line ?? null;
    const startCol = detail.start_column ?? sourceComment?.start_column ?? null;
    const endCol = detail.end_column ?? sourceComment?.end_column ?? null;

    const overlay = document.createElement("div");
    overlay.className = "mrsf-overlay";
    this.applyThemeVariables(overlay);

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
    textArea.value = action === "edit" ? (sourceComment?.text ?? "") : "";
    field("Comment text", textArea);

    const typeSelect = document.createElement("select");
    typeSelect.name = "type";
    ["", "suggestion", "issue", "question", "accuracy", "style", "clarity"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t || "(none)";
      typeSelect.appendChild(opt);
    });
    typeSelect.value = action === "edit" ? (sourceComment?.type ?? "") : "";
    field("Type", typeSelect, "Optional");

    const severitySelect = document.createElement("select");
    severitySelect.name = "severity";
    ["", "low", "medium", "high"].forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s || "(none)";
      severitySelect.appendChild(opt);
    });
    severitySelect.value = action === "edit" ? (sourceComment?.severity ?? "") : "";
    field("Severity", severitySelect, "Optional");

    if (selText) {
      const pre = document.createElement("pre");
      pre.textContent = selText;
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
    this.applyThemeVariables(overlay);

    const dialog = document.createElement("div");
    dialog.className = "mrsf-dialog";

    const header = document.createElement("header");
    header.textContent = action === "delete" ? "Delete comment" : "Change status";
    dialog.appendChild(header);

    const body = document.createElement("div");
    body.className = "mrsf-dialog-body";
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

const controllerRegistry = new Set<MrsfController>();
let autoInitDone = false;

export function refreshAll(): void {
  for (const controller of controllerRegistry) {
    controller.refresh();
  }
}

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

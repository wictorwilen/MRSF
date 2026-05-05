import { createMrsfGutterBadgePresentation } from "../shared/gutter.js";
import { renderThreadHtml } from "../shared/html.js";
import type { CommentThread, SlimComment } from "../shared/types.js";
import type { EditorView } from "@milkdown/prose/view";
import type { MilkdownMrsfController } from "../MilkdownMrsfController.js";
import type { MilkdownMrsfComposeResult, MilkdownMrsfControllerOptions, ReviewState, ReviewThread } from "../types.js";
import { createLineIndex, getDocumentText, getSelectedText, pointToOffset, selectionToEditorSelection, textOffsetToPmPos } from "../core/textModel.js";
import { openMilkdownMrsfConfirmDialog, openMilkdownMrsfFormDialog } from "./dialogs.js";

interface DialogComposeResult {
  text: string;
  severity?: MilkdownMrsfComposeResult["severity"] | null;
  type?: MilkdownMrsfComposeResult["type"] | null;
}

interface OverlayEntry {
  line: number;
  top: number;
  height: number;
  threadCount: number;
  commentCount: number;
  resolvedState: "open" | "resolved" | "mixed";
  highestSeverity: string | null;
  rootCommentId: string;
}

interface OverlayContext {
  text: string;
  lineStarts: number[];
}

function getLineStartOffset(lineStarts: readonly number[], lineNumber: number): number | null {
  if (lineNumber < 1) {
    return null;
  }

  return lineStarts[lineNumber - 1] ?? null;
}

function createOverlayContext(view: EditorView): OverlayContext {
  const text = getDocumentText(view.state.doc);
  return {
    text,
    lineStarts: createLineIndex(text),
  };
}

function getLinePosition(view: EditorView, container: HTMLElement, context: OverlayContext, lineNumber: number): { top: number; height: number } | null {
  const lineStartOffset = getLineStartOffset(context.lineStarts, lineNumber);
  if (lineStartOffset == null) {
    return null;
  }

  try {
    const from = textOffsetToPmPos(view.state.doc, lineStartOffset);
    const coords = view.coordsAtPos(from);
    const containerRect = container.getBoundingClientRect();

    return {
      top: Math.max(0, container.scrollTop + coords.top - containerRect.top),
      height: Math.max(20, coords.bottom - coords.top || 0),
    };
  } catch {
    return null;
  }
}

export class MilkdownMrsfOverlay {
  private readonly container: HTMLElement;
  private readonly editorRoot: HTMLElement;
  private readonly highlightLayer: HTMLElement;
  private readonly gutter: HTMLElement;
  private readonly addButton: HTMLButtonElement;
  private tooltip: HTMLElement | null = null;
  private hideTooltipTimer: number | null = null;
  private cleanupPosition: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderScheduled = false;
  private pendingAddSelection: { selection: ReturnType<typeof selectionToEditorSelection>; selectedText: string } | null = null;

  constructor(
    private view: EditorView,
    private readonly getState: () => ReviewState | null,
    private readonly getController: () => MilkdownMrsfController | null,
    private readonly options: Pick<MilkdownMrsfControllerOptions, "inlineHighlights" | "interactive" | "showSelectionAddButton" | "onCommentSelect" | "composeAdd" | "composeReply" | "composeEdit" | "confirmDelete">,
  ) {
    this.editorRoot = view.dom;
    this.container = this.resolveContainer(view.dom);
    this.highlightLayer = document.createElement("div");
    this.highlightLayer.className = "mrsf-line-highlight-layer is-hidden";
    this.gutter = document.createElement("div");
    this.gutter.className = "mrsf-gutter mrsf-gutter-right is-hidden";
    this.addButton = document.createElement("button");
    this.addButton.type = "button";
    this.addButton.className = "mrsf-add-inline-button";
    this.addButton.textContent = "Add comment";
    this.addButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    this.addButton.addEventListener("click", () => {
      void this.handleAddComment();
    });

    this.ensureContainerPositioning();
    this.container.classList.add("mrsf-overlay-root");
    this.container.appendChild(this.highlightLayer);
    this.container.appendChild(this.gutter);
    this.container.appendChild(this.addButton);
    this.container.addEventListener("scroll", this.handleScroll, { passive: true });
    this.container.addEventListener("mouseover", this.handlePointerEnter);
    this.container.addEventListener("mouseout", this.handlePointerLeave);
    this.container.addEventListener("focusin", this.handleFocusIn);
    this.container.addEventListener("focusout", this.handleFocusOut);
    window.addEventListener("resize", this.handleResize);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleRender();
      });
      this.resizeObserver.observe(this.container);
      this.resizeObserver.observe(this.editorRoot);
    }
  }

  setView(view: EditorView): void {
    this.view = view;
  }

  update(): void {
    this.scheduleRender();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container.removeEventListener("scroll", this.handleScroll);
    this.container.removeEventListener("mouseover", this.handlePointerEnter);
    this.container.removeEventListener("mouseout", this.handlePointerLeave);
    this.container.removeEventListener("focusin", this.handleFocusIn);
    this.container.removeEventListener("focusout", this.handleFocusOut);
    window.removeEventListener("resize", this.handleResize);
    this.clearTooltip();
    this.hideAddButton();
    this.addButton.remove();
    this.highlightLayer.remove();
    this.gutter.remove();
    this.editorRoot.style.removeProperty("padding-right");
    this.container.classList.remove("mrsf-overlay-root");
    this.cleanupPosition?.();
    this.cleanupPosition = null;
  }

  private readonly handleScroll = (): void => {
    this.scheduleRender();
  };

  private readonly handleResize = (): void => {
    this.scheduleRender();
  };

  private readonly handlePointerEnter = (event: Event): void => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-mrsf-comment-id]") : null;
    if (!target || !this.container.contains(target)) {
      return;
    }

    const gutterLine = Number(target.dataset.mrsfGutterLine ?? target.closest<HTMLElement>("[data-mrsf-gutter-line]")?.dataset.mrsfGutterLine ?? "");
    if (Number.isFinite(gutterLine) && gutterLine > 0) {
      this.showLineTooltip(gutterLine, target);
      return;
    }

    this.showTooltip(target.dataset.mrsfCommentId ?? "", target);
  };

  private readonly handlePointerLeave = (event: Event): void => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-mrsf-comment-id]") : null;
    if (!target) {
      return;
    }

    const related = event instanceof MouseEvent && event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && (target.contains(related) || this.tooltip?.contains(related))) {
      return;
    }

    this.scheduleTooltipHide();
  };

  private readonly handleFocusIn = (event: Event): void => {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-mrsf-comment-id]") : null;
    if (!target || !this.container.contains(target)) {
      return;
    }

    this.showTooltip(target.dataset.mrsfCommentId ?? "", target);
  };

  private readonly handleFocusOut = (event: Event): void => {
    const related = event instanceof FocusEvent && event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && this.tooltip?.contains(related)) {
      return;
    }

    this.scheduleTooltipHide();
  };

  private resolveContainer(root: HTMLElement): HTMLElement {
    return root.closest(".editor-host") as HTMLElement ?? root.parentElement ?? root;
  }

  private ensureContainerPositioning(): void {
    const computed = window.getComputedStyle(this.container);
    if (computed.position !== "static") {
      return;
    }

    const previous = this.container.style.position;
    this.container.style.position = "relative";
    this.cleanupPosition = () => {
      this.container.style.position = previous;
    };
  }

  private scheduleRender(): void {
    if (this.renderScheduled) {
      return;
    }

    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  private render(): void {
    const state = this.getState();
    if (!state) {
      this.hide();
      this.clearTooltip();
      this.hideAddButton();
      return;
    }

    const context = createOverlayContext(this.view);
    const entries = state.snapshot.threadsByLine.flatMap(({ line, threads }) => {
      if (threads.length === 0) {
        return [];
      }

      const position = getLinePosition(this.view, this.container, context, line);
      if (!position) {
        return [];
      }

      const rootCommentId = threads[0]?.rootCommentId;
      if (!rootCommentId) {
        return [];
      }

      return [{
        line,
        top: position.top,
        height: position.height,
        threadCount: threads.length,
        commentCount: threads.reduce((sum, thread) => sum + thread.commentIds.length, 0),
        resolvedState: state.snapshot.gutterMarks.find((mark) => mark.line === line)?.resolvedState ?? "open",
        highestSeverity: state.snapshot.gutterMarks.find((mark) => mark.line === line)?.highestSeverity ?? null,
        rootCommentId,
      } satisfies OverlayEntry];
    });

    if (entries.length === 0) {
      this.hide();
    } else {
      this.highlightLayer.className = "mrsf-line-highlight-layer";
      this.highlightLayer.style.height = `${Math.max(this.container.scrollHeight, this.editorRoot.scrollHeight)}px`;
      const children = [
        ...entries.map((entry) => this.renderLineHighlight(entry)),
        ...(this.options.inlineHighlights === false
          ? state.snapshot.inlineRanges.flatMap((inlineRange) => this.renderInlineHighlights(context, inlineRange))
          : []),
      ];
      this.highlightLayer.replaceChildren(...children);

      this.gutter.className = "mrsf-gutter mrsf-gutter-right";
      this.gutter.style.height = `${Math.max(this.container.scrollHeight, this.editorRoot.scrollHeight)}px`;
      this.gutter.replaceChildren(...entries.map((entry) => this.renderGutterItem(entry)));
      this.editorRoot.style.paddingRight = "calc(var(--mrsf-gutter-width, 36px) + 1.3rem)";
    }

    this.updateAddButton();
  }

  private hide(): void {
    this.highlightLayer.className = "mrsf-line-highlight-layer is-hidden";
    this.highlightLayer.replaceChildren();
    this.gutter.className = "mrsf-gutter mrsf-gutter-right is-hidden";
    this.gutter.replaceChildren();
    this.editorRoot.style.removeProperty("padding-right");
  }

  private toSlimComment(comment: ReviewThread["rootComment"] | ReviewThread["replies"][number]): SlimComment {
    return {
      id: comment.id,
      author: comment.author || "Unknown",
      text: comment.text || "",
      line: comment.line ?? null,
      end_line: comment.end_line ?? null,
      start_column: comment.start_column ?? null,
      end_column: comment.end_column ?? null,
      selected_text: comment.selected_text || null,
      resolved: !!comment.resolved,
      reply_to: comment.reply_to || null,
      severity: comment.severity || null,
      type: comment.type || null,
      timestamp: comment.timestamp || null,
    };
  }

  private toSharedThread(thread: ReviewThread): CommentThread {
    return {
      comment: this.toSlimComment(thread.rootComment),
      replies: thread.replies.map((reply) => this.toSlimComment(reply)),
    };
  }

  private getThread(commentId: string): ReviewThread | null {
    return this.getController()?.getThreadForComment(commentId) ?? null;
  }

  private getThreadsAtLine(line: number): ReviewThread[] {
    return this.getController()?.getThreadsAtLine(line) ?? [];
  }

  private getThreadHtml(commentId: string): string | null {
    const thread = this.getThread(commentId);
    if (!thread) {
      return null;
    }

    return renderThreadHtml(this.toSharedThread(thread), this.options.interactive !== false);
  }

  private getLineThreadHtml(line: number): string | null {
    const threads = this.getThreadsAtLine(line);
    if (threads.length === 0) {
      return null;
    }

    return threads
      .map((thread) => renderThreadHtml(this.toSharedThread(thread), this.options.interactive !== false))
      .join("");
  }

  private showTooltip(commentId: string, anchor: HTMLElement): void {
    if (!commentId) {
      this.clearTooltip();
      return;
    }

    const html = this.getThreadHtml(commentId);
    if (!html) {
      this.clearTooltip();
      return;
    }

    this.cancelTooltipHide();
    this.options.onCommentSelect?.(commentId);

    if (!this.tooltip) {
      this.tooltip = document.createElement("div");
      this.tooltip.className = this.options.interactive === false ? "mrsf-inline-tooltip" : "mrsf-inline-tooltip mrsf-interactive";
      this.tooltip.addEventListener("mouseenter", this.cancelTooltipHide);
      this.tooltip.addEventListener("mouseleave", this.scheduleTooltipHide);
      this.tooltip.addEventListener("click", (event) => {
        void this.handleTooltipClick(event);
      });
      document.body.appendChild(this.tooltip);
    }

    this.tooltip.innerHTML = html;
    this.positionTooltip(anchor);
  }

  private showLineTooltip(line: number, anchor: HTMLElement): void {
    if (!line) {
      this.clearTooltip();
      return;
    }

    const threads = this.getThreadsAtLine(line);
    const html = this.getLineThreadHtml(line);
    if (!html) {
      this.clearTooltip();
      return;
    }

    this.cancelTooltipHide();
    if (threads[0]?.rootComment.id) {
      this.options.onCommentSelect?.(threads[0].rootComment.id);
    }

    if (!this.tooltip) {
      this.tooltip = document.createElement("div");
      this.tooltip.className = this.options.interactive === false ? "mrsf-inline-tooltip" : "mrsf-inline-tooltip mrsf-interactive";
      this.tooltip.addEventListener("mouseenter", this.cancelTooltipHide);
      this.tooltip.addEventListener("mouseleave", this.scheduleTooltipHide);
      this.tooltip.addEventListener("click", (event) => {
        void this.handleTooltipClick(event);
      });
      document.body.appendChild(this.tooltip);
    }

    this.tooltip.innerHTML = html;
    this.positionTooltip(anchor);
  }

  private positionTooltip(anchor: HTMLElement): void {
    if (!this.tooltip) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    this.tooltip.style.visibility = "hidden";
    this.tooltip.style.top = "0px";
    this.tooltip.style.left = "0px";

    const tooltipRect = this.tooltip.getBoundingClientRect();
    const margin = 12;
    const preferredTop = anchorRect.bottom + 8;
    const preferredLeft = anchorRect.left;
    const maxLeft = Math.max(margin, window.innerWidth - tooltipRect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - tooltipRect.height - margin);
    const top = Math.min(maxTop, Math.max(margin, preferredTop));
    const left = Math.min(maxLeft, Math.max(margin, preferredLeft));

    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.visibility = "visible";
  }

  private scheduleTooltipHide = (): void => {
    this.cancelTooltipHide();
    this.hideTooltipTimer = window.setTimeout(() => {
      this.clearTooltip();
    }, 120);
  };

  private cancelTooltipHide = (): void => {
    if (this.hideTooltipTimer !== null) {
      window.clearTimeout(this.hideTooltipTimer);
      this.hideTooltipTimer = null;
    }
  };

  private clearTooltip(): void {
    this.cancelTooltipHide();
    this.tooltip?.remove();
    this.tooltip = null;
  }

  private updateAddButton(): void {
    if (this.options.showSelectionAddButton === false || this.options.interactive === false || !this.view.state.selection || this.view.state.selection.empty) {
      this.hideAddButton();
      return;
    }

    const selection = selectionToEditorSelection(this.view.state.selection, this.view.state.doc);
    const selectedText = getSelectedText(this.view.state as Parameters<typeof getSelectedText>[0]);
    if (!selectedText.trim()) {
      this.hideAddButton();
      return;
    }

    try {
      const startCoords = this.view.coordsAtPos(this.view.state.selection.from);
      const endCoords = this.view.coordsAtPos(this.view.state.selection.to);
      const containerRect = this.container.getBoundingClientRect();
      const top = Math.max(
        this.container.scrollTop,
        Math.min(startCoords.top, endCoords.top) - containerRect.top + this.container.scrollTop - 42,
      );
      const left = Math.max(
        this.container.scrollLeft,
        Math.max(startCoords.left, endCoords.right) - containerRect.left + this.container.scrollLeft + 8,
      );

      this.pendingAddSelection = { selection, selectedText };
      this.addButton.style.top = `${top}px`;
      this.addButton.style.left = `${left}px`;
      this.addButton.style.display = "inline-flex";
    } catch {
      this.hideAddButton();
    }
  }

  private hideAddButton(): void {
    this.pendingAddSelection = null;
    this.addButton.style.display = "none";
  }

  private async handleAddComment(): Promise<void> {
    const pending = this.pendingAddSelection;
    const controller = this.getController();
    if (!pending || !controller) {
      return;
    }

    const draft = await this.resolveComposeResult(
      this.options.composeAdd?.(pending)
        ?? openMilkdownMrsfFormDialog({
          action: "add",
          selectionText: pending.selectedText,
          targetDocument: this.editorRoot.ownerDocument,
          themeSource: this.container,
        }),
    );
    if (!draft) {
      return;
    }

    const comment = await controller.addCommentFromSelection(
      pending.selection,
      draft.text,
      pending.selectedText,
      {
        severity: draft.severity ?? undefined,
        type: draft.type ?? undefined,
      },
    );
    this.options.onCommentSelect?.(comment.id);
    this.hideAddButton();
  }

  private async handleTooltipClick(event: Event): Promise<void> {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-mrsf-action]") : null;
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const action = target.dataset.mrsfAction;
    const commentId = target.dataset.mrsfCommentId;
    if (!action || !commentId) {
      return;
    }

    const controller = this.getController();
    const comment = controller?.getCommentById(commentId);
    const thread = controller?.getThreadForComment(commentId);
    if (!controller || !comment || !thread) {
      return;
    }

    this.options.onCommentSelect?.(commentId);

    if (action === "resolve") {
      controller.resolve(commentId);
      this.refreshTooltip(commentId);
      return;
    }

    if (action === "unresolve") {
      controller.unresolve(commentId);
      this.refreshTooltip(commentId);
      return;
    }

    if (action === "reply") {
      const draft = await this.resolveComposeResult(
        this.options.composeReply?.({ comment, thread })
          ?? openMilkdownMrsfFormDialog({
            action: "reply",
            initialSeverity: comment.severity ?? null,
            initialType: comment.type ?? null,
            targetDocument: this.editorRoot.ownerDocument,
            themeSource: this.container,
          }),
      );
      if (!draft) {
        return;
      }
      const reply = await controller.reply(commentId, draft);
      this.options.onCommentSelect?.(reply.id);
      this.refreshTooltip(reply.id);
      return;
    }

    if (action === "edit") {
      const draft = await this.resolveComposeResult(
        this.options.composeEdit?.({ comment, thread })
          ?? openMilkdownMrsfFormDialog({
            action: "edit",
            initialText: comment.text,
            initialSeverity: comment.severity ?? null,
            initialType: comment.type ?? null,
            selectionText: comment.selected_text ?? null,
            targetDocument: this.editorRoot.ownerDocument,
            themeSource: this.container,
          }),
      );
      if (!draft) {
        return;
      }
      controller.edit(commentId, {
        text: draft.text,
        severity: draft.severity ?? comment.severity,
        type: draft.type ?? comment.type,
        selected_text: comment.selected_text,
      });
      this.refreshTooltip(commentId);
      return;
    }

    if (action === "delete") {
      const confirmed = await Promise.resolve(
        this.options.confirmDelete?.({ comment, thread })
          ?? openMilkdownMrsfConfirmDialog({
            title: "Delete comment",
            message: `Delete comment by ${comment.author || "Unknown"}?`,
            confirmLabel: "Delete",
            targetDocument: this.editorRoot.ownerDocument,
            themeSource: this.container,
          }),
      );
      if (!confirmed) {
        return;
      }
      controller.remove(commentId);
      this.clearTooltip();
    }
  }

  private async resolveComposeResult(
    result: DialogComposeResult | MilkdownMrsfComposeResult | null | Promise<DialogComposeResult | MilkdownMrsfComposeResult | null>,
  ): Promise<MilkdownMrsfComposeResult | null> {
    const resolved = await Promise.resolve(result);
    if (!resolved?.text?.trim()) {
      return null;
    }

    return {
      text: resolved.text.trim(),
      severity: resolved.severity ?? undefined,
      type: resolved.type ?? undefined,
    };
  }

  private refreshTooltip(commentId: string): void {
    const anchorId = this.getThread(commentId)?.rootComment.id ?? commentId;
    const anchor = this.container.querySelector<HTMLElement>(`[data-mrsf-comment-id="${anchorId}"]`);
    if (!anchor) {
      this.clearTooltip();
      return;
    }

    this.showTooltip(commentId, anchor);
  }

  private renderLineHighlight(entry: OverlayEntry): HTMLElement {
    const element = document.createElement("div");
    element.className = "mrsf-line-highlight-overlay";
    element.dataset.mrsfLine = String(entry.line);
    element.style.top = `${entry.top}px`;
    element.style.height = `${entry.height}px`;
    return element;
  }

  private renderInlineHighlights(
    context: OverlayContext,
    inlineRange: ReviewState["snapshot"]["inlineRanges"][number],
  ): HTMLElement[] {
    const segments = this.getInlineHighlightSegments(context, inlineRange);
    return segments.map((segment) => {
      const element = document.createElement("div");
      element.className = "mrsf-highlight-overlay mrsf-inline-highlight-overlay";
      element.dataset.mrsfCommentId = inlineRange.commentId;
      element.dataset.mrsfResolved = String(inlineRange.resolved);
      if (inlineRange.severity) {
        element.dataset.mrsfSeverity = inlineRange.severity;
      }
      element.style.top = `${segment.top}px`;
      element.style.left = `${segment.left}px`;
      element.style.width = `${segment.width}px`;
      element.style.height = `${segment.height}px`;
      return element;
    });
  }

  private getInlineHighlightSegments(
    context: OverlayContext,
    inlineRange: ReviewState["snapshot"]["inlineRanges"][number],
  ): Array<{ top: number; left: number; width: number; height: number }> {
    const startLine = inlineRange.range.start.lineIndex;
    const endLine = inlineRange.range.end.lineIndex;
    const segments: Array<{ top: number; left: number; width: number; height: number }> = [];

    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      const lineStart = lineIndex === startLine
        ? inlineRange.range.start
        : { lineIndex, column: 0 };
      const lineEnd = lineIndex === endLine
        ? inlineRange.range.end
        : { lineIndex, column: this.getLineLength(context, lineIndex) };

      const startOffset = pointToOffset(lineStart, context.text);
      const endOffset = pointToOffset(lineEnd, context.text);
      if (endOffset <= startOffset) {
        continue;
      }

      try {
        const from = textOffsetToPmPos(this.view.state.doc, startOffset);
        const to = textOffsetToPmPos(this.view.state.doc, endOffset);
        const fromCoords = this.view.coordsAtPos(from);
        const toCoords = this.view.coordsAtPos(Math.max(from + 1, to));
        const containerRect = this.container.getBoundingClientRect();
        const top = Math.min(fromCoords.top, toCoords.top) - containerRect.top + this.container.scrollTop;
        const left = Math.min(fromCoords.left, toCoords.left) - containerRect.left + this.container.scrollLeft;
        const right = Math.max(fromCoords.left, toCoords.left) - containerRect.left + this.container.scrollLeft;
        const height = Math.max(fromCoords.bottom, toCoords.bottom) - Math.min(fromCoords.top, toCoords.top);

        segments.push({
          top: Math.max(0, top),
          left: Math.max(0, left),
          width: Math.max(8, right - left),
          height: Math.max(18, height),
        });
      } catch {
        continue;
      }
    }

    return segments;
  }

  private getLineLength(context: OverlayContext, lineIndex: number): number {
    const lineStart = context.lineStarts[lineIndex];
    if (lineStart == null) {
      return 0;
    }

    const nextLineStart = context.lineStarts[lineIndex + 1];
    if (nextLineStart == null) {
      return context.text.length - lineStart;
    }

    return Math.max(0, nextLineStart - lineStart - 1);
  }

  private renderGutterItem(entry: OverlayEntry): HTMLElement {
    const presentation = createMrsfGutterBadgePresentation({
      line: entry.line,
      commentCount: entry.commentCount,
      threadCount: entry.threadCount,
      resolvedState: entry.resolvedState,
      highestSeverity: entry.highestSeverity,
      isActive: false,
    });

    const item = document.createElement("div");
    item.className = "mrsf-gutter-item";
    item.dataset.mrsfGutterLine = String(entry.line);
    item.style.top = `${entry.top}px`;
    item.style.height = `${entry.height}px`;

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "mrsf-badge";
    if (entry.resolvedState === "resolved") {
      badge.classList.add("mrsf-badge-resolved");
    }
    if (entry.highestSeverity) {
      badge.classList.add(`mrsf-badge-severity-${entry.highestSeverity}`);
    }
    badge.dataset.mrsfCommentId = entry.rootCommentId;
    badge.dataset.mrsfLine = String(entry.line);
    badge.dataset.mrsfGutterLine = String(entry.line);
    badge.setAttribute("aria-label", presentation.ariaLabel);
    badge.title = presentation.title;
    badge.textContent = presentation.label;

    item.appendChild(badge);
    return item;
  }
}

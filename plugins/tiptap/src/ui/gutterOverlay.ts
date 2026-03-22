import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { createLineIndex, getDocumentText as getTextModelDocumentText, textOffsetToPmPos } from "../core/textModel.js";
import type { TiptapMrsfPlugin } from "../TiptapMrsfPlugin.js";
import type { RenderedThreadSnapshot, ReviewState, TiptapMrsfDisplayOptions } from "../types.js";

interface GutterOverlayOptions {
  editor: Editor;
  getController: () => TiptapMrsfPlugin | null;
}

interface LineGutterEntry {
  line: number;
  top: number;
  height: number;
  threadCount: number;
  commentCount: number;
  resolvedState: "open" | "resolved" | "mixed";
  highestSeverity: string | null;
  rootCommentId: string;
}

interface HighlightEntry {
  line: number;
  top: number;
  height: number;
}

interface RenderContext {
  text: string;
  lineStarts: number[];
}

function severityRank(severity: string | null | undefined): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function getResolvedState(threads: readonly RenderedThreadSnapshot[]): "open" | "resolved" | "mixed" {
  const resolvedCount = threads.filter((thread) => thread.resolved).length;
  if (resolvedCount === 0) {
    return "open";
  }
  if (resolvedCount === threads.length) {
    return "resolved";
  }
  return "mixed";
}

function getHighestSeverity(threads: readonly RenderedThreadSnapshot[]): string | null {
  let current: string | null = null;
  for (const thread of threads) {
    if (severityRank(thread.highestSeverity) > severityRank(current)) {
      current = thread.highestSeverity;
    }
  }
  return current;
}

function getLineStartOffset(lineStarts: readonly number[], lineNumber: number): number | null {
  if (lineNumber < 1) {
    return null;
  }

  return lineStarts[lineNumber - 1] ?? null;
}

function getLinePosition(view: EditorView, container: HTMLElement, context: RenderContext, lineNumber: number): { top: number; height: number } | null {
  const lineStartOffset = getLineStartOffset(context.lineStarts, lineNumber);
  if (lineStartOffset == null) {
    return null;
  }

  const from = textOffsetToPmPos(view.state.doc, lineStartOffset);
  const coords = view.coordsAtPos(from);
  const containerRect = container.getBoundingClientRect();

  return {
    top: Math.max(0, container.scrollTop + coords.top - containerRect.top),
    height: Math.max(18, coords.bottom - coords.top || 0),
  };
}

function createRenderContext(view: EditorView): RenderContext {
  const text = getTextModelDocumentText(view.state.doc);
  return {
    text,
    lineStarts: createLineIndex(text),
  };
}

function getVisibleEntries(
  view: EditorView,
  container: HTMLElement,
  state: ReviewState,
  displayOptions: Required<TiptapMrsfDisplayOptions>,
  interactive: boolean,
): LineGutterEntry[] {
  const context = createRenderContext(view);

  return state.snapshot.threadsByLine.flatMap(({ line, threads }) => {
    const visibleThreads = displayOptions.gutterForInline
      ? threads
      : threads.filter((thread) => !thread.inline);

    if (visibleThreads.length === 0) {
      return [];
    }

    const position = getLinePosition(view, container, context, line);
    if (!position) {
      return [];
    }

    const rootCommentId = visibleThreads[0]?.rootCommentId ?? "";
    if (!rootCommentId && interactive) {
      return [];
    }

    return [{
      line,
      top: position.top,
      height: position.height,
      threadCount: visibleThreads.length,
      commentCount: visibleThreads.reduce((sum, thread) => sum + thread.commentIds.length, 0),
      resolvedState: getResolvedState(visibleThreads),
      highestSeverity: getHighestSeverity(visibleThreads),
      rootCommentId,
    } satisfies LineGutterEntry];
  });
}

export class TiptapMrsfGutterOverlay {
  private readonly container: HTMLElement;
  private readonly editorRoot: HTMLElement;
  private readonly highlightLayer: HTMLElement;
  private readonly gutter: HTMLElement;
  private cleanupPosition: (() => void) | null = null;
  private renderScheduled = false;
  private rendering = false;
  private readonly handleScroll = (): void => {
    this.scheduleRender();
  };
  private readonly handleResize = (): void => {
    this.scheduleRender();
  };
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly options: GutterOverlayOptions) {
    this.editorRoot = options.editor.view.dom as HTMLElement;
    this.container = this.editorRoot.parentElement ?? this.editorRoot;
    this.container.classList.add("mrsf-overlay-root");
    this.highlightLayer = document.createElement("div");
    this.highlightLayer.className = "mrsf-line-highlight-layer is-hidden";
    this.gutter = document.createElement("div");
    this.gutter.className = "mrsf-gutter is-hidden";
    this.ensureContainerPositioning();
    this.container.appendChild(this.highlightLayer);
    this.container.appendChild(this.gutter);
    this.container.addEventListener("scroll", this.handleScroll, { passive: true });
    window.addEventListener("resize", this.handleResize);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleRender();
      });
      this.resizeObserver.observe(this.container);
      this.resizeObserver.observe(this.editorRoot);
    }
  }

  update(): void {
    this.scheduleRender();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.container.removeEventListener("scroll", this.handleScroll);
    window.removeEventListener("resize", this.handleResize);
    this.highlightLayer.remove();
    this.gutter.remove();
    this.cleanupPosition?.();
    this.cleanupPosition = null;
    this.container.classList.remove("mrsf-overlay-root");
    this.editorRoot.style.removeProperty("padding-left");
    this.editorRoot.style.removeProperty("padding-right");
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

  private render(): void {
    if (this.rendering) {
      return;
    }

    this.rendering = true;

    try {
    const controller = this.options.getController();
    const state = controller?.getState() ?? null;
    const displayOptions = controller?.getDisplayOptions() ?? null;

    if (!controller || !state || !displayOptions) {
      this.highlightLayer.className = "mrsf-line-highlight-layer is-hidden";
      this.highlightLayer.replaceChildren();
      this.hideGutter();
      return;
    }

    const entries = getVisibleEntries(
      this.options.editor.view,
      this.container,
      state,
      displayOptions,
      displayOptions.interactive,
    );

    this.renderHighlights(state, displayOptions);

    if (entries.length === 0) {
      this.hideGutter();
      return;
    }

    this.gutter.className = `mrsf-gutter mrsf-gutter-${displayOptions.gutterPosition}`;
    this.gutter.replaceChildren(...entries.map((entry) => this.renderEntry(entry, controller, displayOptions)));
    this.gutter.style.height = `${Math.max(this.container.scrollHeight, this.editorRoot.scrollHeight)}px`;

    if (displayOptions.gutterPosition === "right") {
      this.editorRoot.style.removeProperty("padding-left");
      this.editorRoot.style.paddingRight = "var(--mrsf-gutter-width, 36px)";
    } else {
      this.editorRoot.style.removeProperty("padding-right");
      this.editorRoot.style.paddingLeft = "var(--mrsf-gutter-width, 36px)";
    }
    } finally {
      this.rendering = false;
    }
  }

  private hideGutter(): void {
    this.gutter.className = "mrsf-gutter is-hidden";
    this.gutter.replaceChildren();
    this.editorRoot.style.removeProperty("padding-left");
    this.editorRoot.style.removeProperty("padding-right");
  }

  private renderHighlights(
    state: ReviewState,
    displayOptions: Required<TiptapMrsfDisplayOptions>,
  ): void {
    if (!displayOptions.lineHighlight) {
      this.highlightLayer.className = "mrsf-line-highlight-layer is-hidden";
      this.highlightLayer.replaceChildren();
      return;
    }

    const context = createRenderContext(this.options.editor.view);
    const highlights: HighlightEntry[] = state.snapshot.threadsByLine.flatMap(({ line, threads }) => {
      if (threads.length === 0) {
        return [];
      }

      const position = getLinePosition(this.options.editor.view, this.container, context, line);
      if (!position) {
        return [];
      }

      return [{
        line,
        top: position.top,
        height: position.height,
      } satisfies HighlightEntry];
    });

    if (highlights.length === 0) {
      this.highlightLayer.className = "mrsf-line-highlight-layer is-hidden";
      this.highlightLayer.replaceChildren();
      return;
    }

    this.highlightLayer.className = "mrsf-line-highlight-layer";
    this.highlightLayer.style.height = `${Math.max(this.container.scrollHeight, this.editorRoot.scrollHeight)}px`;
    this.highlightLayer.replaceChildren(...highlights.map((entry) => this.renderHighlight(entry)));
  }

  private renderHighlight(entry: HighlightEntry): HTMLElement {
    const element = document.createElement("div");
    element.className = "mrsf-line-highlight-overlay";
    element.dataset.mrsfLine = String(entry.line);
    element.style.top = `${entry.top}px`;
    element.style.height = `${entry.height}px`;
    return element;
  }

  private renderEntry(
    entry: LineGutterEntry,
    controller: TiptapMrsfPlugin,
    displayOptions: Required<TiptapMrsfDisplayOptions>,
  ): HTMLElement {
    const item = document.createElement("div");
    item.className = "mrsf-gutter-item";
    item.dataset.mrsfGutterLine = String(entry.line);
    item.style.top = `${entry.top}px`;
    item.style.height = `${entry.height}px`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "mrsf-badge",
      entry.highestSeverity ? `severity-${entry.highestSeverity}` : "severity-none",
    ].join(" ");
    if (entry.resolvedState === "resolved") {
      button.classList.add("mrsf-badge-resolved");
    }
    if (entry.highestSeverity) {
      button.classList.add(`mrsf-badge-severity-${entry.highestSeverity}`);
    }
    button.textContent = String(entry.commentCount);
    button.title = `${entry.commentCount} comment${entry.commentCount === 1 ? "" : "s"} in ${entry.threadCount} thread${entry.threadCount === 1 ? "" : "s"} on line ${entry.line}`;
    button.setAttribute("aria-label", button.title);
    button.disabled = !displayOptions.interactive;

    if (displayOptions.interactive) {
      button.addEventListener("click", () => {
        controller.handleCommentClick(entry.rootCommentId, button.getBoundingClientRect());
      });
    }

    item.appendChild(button);
    return item;
  }
}

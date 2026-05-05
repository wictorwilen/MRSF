// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Schema } from "@milkdown/prose/model";
import type { Comment } from "@mrsf/cli/browser";
import { MilkdownMrsfOverlay } from "../ui/overlay.js";
import type { ReviewState, ReviewThread } from "../types.js";

vi.mock("../shared/gutter.js", () => ({
  createMrsfGutterBadgePresentation: ({ line, commentCount }: { line: number; commentCount: number }) => ({
    ariaLabel: `Line ${line}`,
    title: `Comments: ${commentCount}`,
    label: String(commentCount),
  }),
}));

vi.mock("../shared/html.js", () => ({
  renderThreadHtml: (thread: { comment: { id: string } }) => `
    <div class="tooltip-thread">
      <button data-mrsf-action="resolve" data-mrsf-comment-id="${thread.comment.id}">Resolve</button>
      <button data-mrsf-action="unresolve" data-mrsf-comment-id="${thread.comment.id}">Unresolve</button>
      <button data-mrsf-action="reply" data-mrsf-comment-id="${thread.comment.id}">Reply</button>
      <button data-mrsf-action="edit" data-mrsf-comment-id="${thread.comment.id}">Edit</button>
      <button data-mrsf-action="delete" data-mrsf-comment-id="${thread.comment.id}">Delete</button>
    </div>
  `,
}));

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
    },
  },
  marks: {},
});

function createDoc(lines: string[]) {
  return schema.node("doc", undefined, lines.map((line) =>
    schema.node("paragraph", undefined, line ? [schema.text(line)] : undefined),
  ));
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "root",
    author: "Reviewer",
    timestamp: "2025-01-01T00:00:00.000Z",
    text: "Root",
    resolved: false,
    line: 1,
    start_column: 0,
    end_column: 5,
    selected_text: "alpha",
    ...overrides,
  };
}

function makeState(): { state: ReviewState; root: Comment; reply: Comment; thread: ReviewThread } {
  const root = makeComment();
  const reply = makeComment({
    id: "reply",
    text: "Reply",
    reply_to: "root",
    start_column: undefined,
    end_column: undefined,
    selected_text: undefined,
  });
  const thread = {
    line: 1,
    rootComment: root,
    replies: [reply],
  } satisfies ReviewThread;
  const state = {
    resourceId: "resource",
    document: {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [root, reply],
    },
    projectedDocument: {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [root, reply],
    },
    sidecarPath: "/tmp/doc.md.review.yaml",
    documentPath: "/tmp/doc.md",
    documentLines: ["alpha line", "beta line", "gamma line"],
    snapshot: {
      threadsByLine: [{
        line: 1,
        threads: [{
          line: 1,
          rootCommentId: "root",
          commentIds: ["root", "reply"],
          replyCount: 1,
          resolved: false,
          highestSeverity: "medium",
          inline: true,
          range: {
            start: { lineIndex: 0, column: 0 },
            end: { lineIndex: 0, column: 5 },
          },
        }],
      }],
      gutterMarks: [{
        line: 1,
        threadCount: 1,
        commentCount: 2,
        resolvedState: "open",
        highestSeverity: "medium",
      }],
      inlineRanges: [{
        commentId: "root",
        line: 1,
        selectedText: "alpha",
        resolved: false,
        severity: "medium",
        range: {
          start: { lineIndex: 0, column: 0 },
          end: { lineIndex: 0, column: 5 },
        },
      }],
      hoverTargets: [{
        line: 1,
        commentIds: ["root", "reply"],
      }],
      documentLevelCommentIds: [],
      orphanedCommentIds: [],
    },
    loaded: true,
    dirty: false,
    hasPendingShifts: false,
    lastReanchorResults: [],
  } satisfies ReviewState;

  return { state, root, reply, thread };
}

function makeMixedLineState(): { state: ReviewState; threads: ReviewThread[] } {
  const inlineRoot = makeComment({ id: "inline-root", text: "Inline root", line: 1, start_column: 0, end_column: 5, selected_text: "alpha" });
  const lineRoot = makeComment({ id: "line-root", text: "Line root", line: 1, start_column: undefined, end_column: undefined, selected_text: undefined });
  const lineReply = makeComment({ id: "line-reply", text: "Line reply", line: 1, reply_to: "line-root", start_column: undefined, end_column: undefined, selected_text: undefined });

  const threads = [
    {
      line: 1,
      rootComment: inlineRoot,
      replies: [],
    },
    {
      line: 1,
      rootComment: lineRoot,
      replies: [lineReply],
    },
  ] satisfies ReviewThread[];

  const state = {
    resourceId: "resource",
    document: {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [inlineRoot, lineRoot, lineReply],
    },
    projectedDocument: {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [inlineRoot, lineRoot, lineReply],
    },
    sidecarPath: "/tmp/doc.md.review.yaml",
    documentPath: "/tmp/doc.md",
    documentLines: ["alpha line", "beta line", "gamma line"],
    snapshot: {
      threadsByLine: [{
        line: 1,
        threads: [
          {
            line: 1,
            rootCommentId: "inline-root",
            commentIds: ["inline-root"],
            replyCount: 0,
            resolved: false,
            highestSeverity: null,
            inline: true,
            range: {
              start: { lineIndex: 0, column: 0 },
              end: { lineIndex: 0, column: 5 },
            },
          },
          {
            line: 1,
            rootCommentId: "line-root",
            commentIds: ["line-root", "line-reply"],
            replyCount: 1,
            resolved: false,
            highestSeverity: null,
            inline: false,
          },
        ],
      }],
      gutterMarks: [{
        line: 1,
        threadCount: 2,
        commentCount: 3,
        resolvedState: "open",
        highestSeverity: null,
      }],
      inlineRanges: [{
        commentId: "inline-root",
        line: 1,
        selectedText: "alpha",
        resolved: false,
        severity: null,
        range: {
          start: { lineIndex: 0, column: 0 },
          end: { lineIndex: 0, column: 5 },
        },
      }],
      hoverTargets: [{
        line: 1,
        commentIds: ["inline-root", "line-root", "line-reply"],
      }],
      documentLevelCommentIds: [],
      orphanedCommentIds: [],
    },
    loaded: true,
    dirty: false,
    hasPendingShifts: false,
    lastReanchorResults: [],
  } satisfies ReviewState;

  return { state, threads };
}

function makeView(selection: { from: number; to: number; empty: boolean } = { from: 1, to: 1, empty: true }) {
  const container = document.createElement("div");
  container.className = "editor-host";
  const dom = document.createElement("div");
  container.appendChild(dom);
  document.body.appendChild(container);

  Object.defineProperty(container, "scrollHeight", { value: 640, configurable: true });
  Object.defineProperty(dom, "scrollHeight", { value: 520, configurable: true });
  Object.defineProperty(container, "scrollTop", { value: 0, writable: true, configurable: true });
  Object.defineProperty(container, "scrollLeft", { value: 0, writable: true, configurable: true });

  container.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 10,
    left: 20,
    right: 620,
    bottom: 650,
    width: 600,
    height: 640,
    toJSON: () => ({}),
  });
  dom.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 10,
    left: 20,
    right: 620,
    bottom: 530,
    width: 600,
    height: 520,
    toJSON: () => ({}),
  });

  const doc = createDoc(["alpha line", "beta line", "gamma line"]);
  const view = {
    dom,
    state: { doc, selection },
    coordsAtPos: (pos: number) => ({
      top: 30 + pos * 3,
      bottom: 50 + pos * 3,
      left: 40 + pos * 6,
      right: 48 + pos * 6,
    }),
  };

  return { container, dom, view };
}

describe("MilkdownMrsfOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders gutter and highlight overlays and hides cleanly when state disappears", () => {
    const { state, thread } = makeState();
    const { view, dom } = makeView();
    const controller = {
      getThreadForComment: vi.fn(() => thread),
      getCommentById: vi.fn((id: string) => state.projectedDocument.comments.find((comment) => comment.id === id) ?? null),
    };
    let currentState: ReviewState | null = state;
    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => currentState,
      () => controller as never,
      {},
    );

    overlay.update();

    expect(dom.style.paddingRight).toContain("--mrsf-gutter-width");
    expect(document.querySelectorAll(".mrsf-line-highlight-overlay").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".mrsf-gutter-item")).toHaveLength(1);

    currentState = null;
    overlay.update();
    expect(document.querySelector(".mrsf-line-highlight-layer.is-hidden")).not.toBeNull();
    expect(document.querySelector(".mrsf-gutter.is-hidden")).not.toBeNull();

    overlay.destroy();
    expect(document.querySelector(".mrsf-gutter")).toBeNull();
  });

  it("renders inline overlay segments when inline decorations are disabled", () => {
    const { state, thread } = makeState();
    const { view } = makeView();
    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => state,
      () => ({
        getThreadForComment: () => thread,
        getCommentById: () => state.projectedDocument.comments[0] ?? null,
      }) as never,
      { inlineHighlights: false },
    );

    overlay.update();
    expect(document.querySelectorAll(".mrsf-inline-highlight-overlay").length).toBeGreaterThan(0);

    overlay.destroy();
  });

  it("shows tooltips on hover and handles resolve, reply, edit, and delete actions", async () => {
    const { state, root, thread } = makeState();
    const { container, view } = makeView();
    const onCommentSelect = vi.fn();
    const controller = {
      getThreadsAtLine: vi.fn(() => [thread]),
      getThreadForComment: vi.fn((commentId: string) => (commentId === "missing" ? null : thread)),
      getCommentById: vi.fn((commentId: string) => state.projectedDocument.comments.find((comment) => comment.id === commentId) ?? null),
      resolve: vi.fn(() => true),
      unresolve: vi.fn(() => true),
      reply: vi.fn(async () => ({ ...root, id: "reply-2", text: "Reply 2", reply_to: "root" })),
      edit: vi.fn(),
      remove: vi.fn(),
    };

    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => state,
      () => controller as never,
      {
        onCommentSelect,
        composeReply: vi.fn(async () => ({ text: " Reply body ", severity: "low", type: "note" })),
        composeEdit: vi.fn(async () => ({ text: " Edited body ", severity: "high", type: "issue" })),
        confirmDelete: vi.fn(async () => true),
      },
    );

    overlay.update();

    const badge = document.querySelector<HTMLButtonElement>(".mrsf-badge");
    expect(badge).not.toBeNull();
    badge!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const tooltip = document.querySelector<HTMLElement>(".mrsf-inline-tooltip");
    expect(tooltip).not.toBeNull();
    expect(onCommentSelect).toHaveBeenCalledWith("root");

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="resolve"]')!.click();
    await vi.runAllTimersAsync();
    expect(controller.resolve).toHaveBeenCalledWith("root");

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="unresolve"]')!.click();
    await vi.runAllTimersAsync();
    expect(controller.unresolve).toHaveBeenCalledWith("root");

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="reply"]')!.click();
    await vi.runAllTimersAsync();
    expect(controller.reply).toHaveBeenCalled();
    expect(onCommentSelect).toHaveBeenCalledWith("reply-2");

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="edit"]')!.click();
    await vi.runAllTimersAsync();
    expect(controller.edit).toHaveBeenCalledWith("root", expect.objectContaining({ text: "Edited body" }));

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="delete"]')!.click();
    await vi.runAllTimersAsync();
    expect(controller.remove).toHaveBeenCalledWith("root");
    expect(document.querySelector(".mrsf-inline-tooltip")).toBeNull();

    badge!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: container }));
    await vi.advanceTimersByTimeAsync(120);
    overlay.destroy();
  });

  it("shows all line threads when hovering the gutter badge", () => {
    const { state, threads } = makeMixedLineState();
    const { view } = makeView();
    const controller = {
      getThreadsAtLine: vi.fn(() => threads),
      getThreadForComment: vi.fn((commentId: string) => threads.find((thread) => thread.rootComment.id === commentId) ?? null),
      getCommentById: vi.fn((commentId: string) => state.projectedDocument.comments.find((comment) => comment.id === commentId) ?? null),
    };

    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => state,
      () => controller as never,
      {},
    );

    overlay.update();

    const badge = document.querySelector<HTMLButtonElement>(".mrsf-badge");
    expect(badge).not.toBeNull();
    badge!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    const tooltip = document.querySelector<HTMLElement>(".mrsf-inline-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.querySelectorAll(".tooltip-thread")).toHaveLength(2);
    expect(controller.getThreadsAtLine).toHaveBeenCalledWith(1);

    overlay.destroy();
  });

  it("uses dialog fallbacks and ignores missing tooltip targets", async () => {
    const { state, thread } = makeState();
    const { view } = makeView();
    const controller = {
      getThreadForComment: vi.fn((commentId: string) => (commentId === "missing" ? null : thread)),
      getCommentById: vi.fn((commentId: string) => state.projectedDocument.comments.find((comment) => comment.id === commentId) ?? null),
      resolve: vi.fn(() => true),
      unresolve: vi.fn(() => true),
      reply: vi.fn(async () => ({ ...state.projectedDocument.comments[0]!, id: "reply-x", reply_to: "root" })),
      edit: vi.fn(),
      remove: vi.fn(),
    };

    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => state,
      () => controller as never,
      { interactive: false },
    );

    overlay.update();
    const badge = document.querySelector<HTMLButtonElement>(".mrsf-badge");
    badge!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    const tooltip = document.querySelector<HTMLElement>(".mrsf-inline-tooltip");
    expect(tooltip?.className).toBe("mrsf-inline-tooltip");

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="reply"]')!.click();
    await vi.runAllTimersAsync();
    const replyDialog = document.querySelector<HTMLFormElement>(".mrsf-overlay form");
    expect(replyDialog).not.toBeNull();
    replyDialog!.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!.value = " Prompted reply ";
    replyDialog!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();
    expect(controller.reply).toHaveBeenCalledOnce();

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="edit"]')!.click();
    await vi.runAllTimersAsync();
    const editDialog = document.querySelector<HTMLFormElement>(".mrsf-overlay form");
    expect(editDialog).not.toBeNull();
    editDialog!.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!.value = " Prompted edit ";
    editDialog!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();
    expect(controller.edit).toHaveBeenCalled();

    tooltip!.querySelector<HTMLElement>('[data-mrsf-action="delete"]')!.click();
    await vi.runAllTimersAsync();
    const confirmDialog = document.querySelector<HTMLElement>(".mrsf-overlay");
    expect(confirmDialog).not.toBeNull();
    confirmDialog!.querySelector<HTMLButtonElement>(".mrsf-btn")!.click();
    await vi.runAllTimersAsync();
    expect(controller.remove).not.toHaveBeenCalled();

    const orphanAnchor = document.createElement("button");
    orphanAnchor.dataset.mrsfCommentId = "missing";
    view.dom.appendChild(orphanAnchor);
    orphanAnchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await vi.runAllTimersAsync();

    overlay.destroy();
  });

  it("adds a comment from the current selection through the inline add button", async () => {
    const { state } = makeState();
    const { view } = makeView({ from: 1, to: 6, empty: false });
    const onCommentSelect = vi.fn();
    const controller = {
      addCommentFromSelection: vi.fn(async () => ({ ...state.projectedDocument.comments[0]!, id: "new-comment" })),
      getThreadForComment: vi.fn(() => null),
      getCommentById: vi.fn(() => null),
    };

    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => state,
      () => controller as never,
      { onCommentSelect },
    );

    overlay.update();
    const addButton = document.querySelector<HTMLButtonElement>(".mrsf-add-inline-button");
    expect(addButton).not.toBeNull();
    expect(addButton?.style.display).toBe("inline-flex");

    addButton!.click();
    await vi.runAllTimersAsync();

    const dialog = document.querySelector<HTMLFormElement>(".mrsf-overlay form");
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector("pre")?.textContent).toContain("alpha");
    dialog!.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!.value = " New comment ";
    dialog!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();

    expect(controller.addCommentFromSelection).toHaveBeenCalledWith(
      expect.objectContaining({ start: expect.any(Object), end: expect.any(Object) }),
      "New comment",
      expect.stringContaining("alpha"),
      expect.objectContaining({ severity: undefined, type: undefined }),
    );
    expect(onCommentSelect).toHaveBeenCalledWith("new-comment");

    overlay.destroy();
  });

  it("suppresses the inline add button when configured off", () => {
    const { state } = makeState();
    const { view } = makeView({ from: 1, to: 6, empty: false });
    const overlay = new MilkdownMrsfOverlay(
      view as never,
      () => state,
      () => ({
        getThreadForComment: () => null,
        getCommentById: () => null,
      }) as never,
      { showSelectionAddButton: false },
    );

    overlay.update();
    expect(document.querySelector<HTMLButtonElement>(".mrsf-add-inline-button")?.style.display).toBe("none");

    overlay.destroy();
  });
});

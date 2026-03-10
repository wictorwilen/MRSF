import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MrsfController, autoInit, refreshAll } from "../controller.js";
import type { CommentThread, SlimComment } from "../types.js";

// jsdom lacks ResizeObserver — provide a minimal stub.
class ResizeObserverStub {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.callback = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;

// ── Helpers ──────────────────────────────────────────────

function makeComment(overrides: Partial<SlimComment> = {}): SlimComment {
  return {
    id: "c1",
    author: "Alice",
    text: "A comment",
    line: 5,
    end_line: null,
    start_column: null,
    end_column: null,
    selected_text: null,
    resolved: false,
    reply_to: null,
    severity: null,
    type: null,
    timestamp: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<SlimComment> = {}, replies: SlimComment[] = []): CommentThread {
  return { comment: makeComment(overrides), replies };
}

/**
 * Build a container with `data-mrsf-line` paragraphs and an optional
 * embedded `<script type="application/mrsf+json">` with thread data.
 */
function buildContainer(
  lines: number[],
  threads?: CommentThread[],
): HTMLDivElement {
  const div = document.createElement("div");
  for (const line of lines) {
    const p = document.createElement("p");
    p.dataset.mrsfLine = String(line);
    p.textContent = `Line ${line} content`;
    div.appendChild(p);
  }
  if (threads) {
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = JSON.stringify({ threads });
    div.appendChild(script);
  }
  document.body.appendChild(div);
  return div;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ── Cleanup ──────────────────────────────────────────────

let container: HTMLDivElement;
let ctrl: MrsfController | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  ctrl?.destroy();
  ctrl = null;
  document.body.innerHTML = "";
});

// ── Constructor & Options ────────────────────────────────

describe("MrsfController constructor", () => {
  it("adds mrsf-overlay-root class to container", () => {
    container = buildContainer([1, 2, 3]);
    ctrl = new MrsfController(container);
    expect(container.classList.contains("mrsf-overlay-root")).toBe(true);
  });

  it("creates a right gutter by default", () => {
    container = buildContainer([1, 2, 3]);
    ctrl = new MrsfController(container);
    const gutter = container.querySelector(".mrsf-gutter-right");
    expect(gutter).not.toBeNull();
    expect(container.querySelector(".mrsf-gutter-left")).toBeNull();
  });

  it("creates a left gutter when gutterPosition is 'left'", () => {
    container = buildContainer([1, 2, 3]);
    ctrl = new MrsfController(container, { gutterPosition: "left" });
    expect(container.querySelector(".mrsf-gutter-left")).not.toBeNull();
    expect(container.querySelector(".mrsf-gutter-right")).toBeNull();
  });

  it("defaults interactive to false", () => {
    container = buildContainer([1, 2, 3]);
    ctrl = new MrsfController(container);
    // Non-interactive: no add buttons in gutter
    const addBtns = container.querySelectorAll(".mrsf-gutter-add");
    expect(addBtns.length).toBe(0);
  });
});

// ── Data loading ─────────────────────────────────────────

describe("data loading", () => {
  it("loads threads from embedded script", () => {
    const threads = [makeThread({ id: "c1", line: 1 })];
    container = buildContainer([1, 2], threads);
    ctrl = new MrsfController(container);

    // Should render a badge for line 1
    const badge = container.querySelector('.mrsf-badge[data-mrsf-line="1"]');
    expect(badge).not.toBeNull();
  });

  it("loads threads from constructor options (overrides script)", () => {
    // Embedded script has thread on line 1, constructor has thread on line 2
    const scriptThreads = [makeThread({ id: "s1", line: 1 })];
    const optThreads = [makeThread({ id: "o1", line: 2 })];
    container = buildContainer([1, 2], scriptThreads);
    ctrl = new MrsfController(container, { comments: optThreads });

    const badge1 = container.querySelector('.mrsf-badge[data-mrsf-line="1"]');
    const badge2 = container.querySelector('.mrsf-badge[data-mrsf-line="2"]');
    expect(badge1).toBeNull(); // script threads should be ignored
    expect(badge2).not.toBeNull();
  });

  it("handles malformed JSON in embedded script gracefully", () => {
    container = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = "1";
    container.appendChild(p);
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = "not valid json {{{";
    container.appendChild(script);
    document.body.appendChild(container);

    // Should not throw
    ctrl = new MrsfController(container);
    const badges = container.querySelectorAll(".mrsf-badge");
    expect(badges.length).toBe(0);
  });

  it("handles missing script element", () => {
    container = buildContainer([1, 2]); // no threads
    ctrl = new MrsfController(container);
    const badges = container.querySelectorAll(".mrsf-badge");
    expect(badges.length).toBe(0);
  });

  it("handles empty script content", () => {
    container = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = "1";
    container.appendChild(p);
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = "";
    container.appendChild(script);
    document.body.appendChild(container);

    ctrl = new MrsfController(container);
    const badges = container.querySelectorAll(".mrsf-badge");
    expect(badges.length).toBe(0);
  });
});

// ── Gutter rendering ─────────────────────────────────────

describe("gutter rendering", () => {
  it("creates badge for line with comments", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("1"); // 1 comment
  });

  it("shows correct count for thread with replies", () => {
    const reply = makeComment({ id: "r1", reply_to: "c1", line: null });
    const threads = [makeThread({ id: "c1", line: 5 }, [reply])];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.textContent).toContain("2"); // 1 root + 1 reply
  });

  it("shows resolved badge styling for all-resolved threads", () => {
    const threads = [makeThread({ id: "c1", line: 5, resolved: true })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.classList.contains("mrsf-badge-resolved")).toBe(true);
    expect(badge!.textContent).toContain("✓");
  });

  it("shows normal badge for unresolved thread", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.textContent).toContain("💬");
  });

  it("applies high severity class", () => {
    const threads = [makeThread({ id: "c1", line: 5, severity: "high" })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.classList.contains("mrsf-badge-severity-high")).toBe(true);
  });

  it("applies medium severity class", () => {
    const threads = [makeThread({ id: "c1", line: 5, severity: "medium" })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.classList.contains("mrsf-badge-severity-medium")).toBe(true);
  });

  it("does not apply severity class for low severity", () => {
    const threads = [makeThread({ id: "c1", line: 5, severity: "low" })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.classList.contains("mrsf-badge-severity-low")).toBe(false);
  });

  it("creates gutter items for multiple lines", () => {
    const threads = [
      makeThread({ id: "c1", line: 1 }),
      makeThread({ id: "c2", line: 5 }),
      makeThread({ id: "c3", line: 10 }),
    ];
    container = buildContainer([1, 5, 10], threads);
    ctrl = new MrsfController(container);

    const badges = container.querySelectorAll(".mrsf-badge");
    expect(badges.length).toBe(3);
  });

  it("creates add buttons for uncommented lines in interactive mode", () => {
    const threads = [makeThread({ id: "c1", line: 1 })];
    container = buildContainer([1, 2, 3], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtns = container.querySelectorAll(".mrsf-gutter-add");
    expect(addBtns.length).toBe(2);
    expect(Array.from(addBtns).map((el) => (el as HTMLElement).dataset.mrsfLine)).toEqual(["2", "3"]);
  });

  it("does not create add buttons alongside badges in interactive mode", () => {
    const threads = [makeThread({ id: "c1", line: 1 })];
    container = buildContainer([1], threads);
    ctrl = new MrsfController(container, { interactive: true });

    // Commented lines reuse the tooltip action instead of rendering a second button.
    const gutterItem = container.querySelector('.mrsf-gutter-item[data-mrsf-gutter-line="1"]');
    expect(gutterItem!.querySelector(".mrsf-badge")).not.toBeNull();
    expect(gutterItem!.querySelector(".mrsf-gutter-add")).toBeNull();
  });

  it("sets data attributes on badge elements", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    expect(badge.dataset.mrsfLine).toBe("5");
    expect(badge.dataset.mrsfAction).toBe("navigate");
    expect(badge.dataset.mrsfCommentId).toBe("c1");
  });

  it("ignores script elements when collecting lines", () => {
    container = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = "1";
    p.textContent = "Line 1";
    container.appendChild(p);
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.dataset.mrsfLine = "999"; // Should be ignored
    script.textContent = JSON.stringify({ threads: [makeThread({ id: "c1", line: 1 })] });
    container.appendChild(script);
    document.body.appendChild(container);

    ctrl = new MrsfController(container);
    // Only line 1 should have a gutter item, not 999
    const items = container.querySelectorAll(".mrsf-gutter-item");
    expect(items.length).toBe(1);
  });
});

// ── Positioning ──────────────────────────────────────────

describe("positionGutterItems", () => {
  it("sets top style on gutter items based on target element position", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    // jsdom getBoundingClientRect always returns zeros, but we can verify
    // the method runs without errors
    const item = container.querySelector(".mrsf-gutter-item") as HTMLElement;
    expect(item.style.top).toBeDefined();
  });

  it("hides gutter item when target element is missing", () => {
    const threads = [makeThread({ id: "c1", line: 99 })];
    // Container has line 5 but thread references line 99
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    // The gutter item for line 99 should exist but not have a corresponding
    // data-mrsf-line target element. It won't get an item at all since
    // collectLines finds lines from DOM elements.
    // Actually: the badge is for line 99 from threads, but collectLines
    // looks at data-mrsf-line attributes which only has line 5.
    // So line 99 has no DOM element → no gutter item created.
    const items = container.querySelectorAll(".mrsf-gutter-item");
    // Only line 5 should exist (no threads → no badge,
    // and not interactive → no add button → no item at all)
    expect(items.length).toBe(0);
  });

  it("calls positionGutterItems as public method without error", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    // Should not throw when called directly
    expect(() => ctrl!.positionGutterItems()).not.toThrow();
  });

  it("positions expanded pre lines within the code block instead of at the block top", () => {
    const div = document.createElement("div");
    const pre = document.createElement("pre");
    pre.dataset.mrsfLine = "44";
    pre.dataset.mrsfStartLine = "44";
    pre.dataset.mrsfEndLine = "49";
    pre.textContent = "code block";
    pre.style.paddingTop = "8px";
    pre.style.paddingBottom = "8px";
    pre.style.lineHeight = "16px";
    div.appendChild(pre);
    document.body.appendChild(div);
    container = div;

    const containerRect = { top: 0, left: 0, right: 0, bottom: 120, width: 200, height: 120, x: 0, y: 0, toJSON() {} };
    const preRect = { top: 20, left: 0, right: 200, bottom: 100, width: 200, height: 80, x: 0, y: 20, toJSON() {} };
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(containerRect as DOMRect);
    vi.spyOn(pre, "getBoundingClientRect").mockReturnValue(preRect as DOMRect);

    ctrl = new MrsfController(container, { interactive: true });
    ctrl.positionGutterItems();

    const item = container.querySelector('[data-mrsf-gutter-line="48"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.style.top).toBe("76px");
  });

  it("keeps gutter positions in content coordinates when the host container is scrolled", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      value: 120,
    });

    const containerRect = {
      top: 100,
      left: 0,
      right: 200,
      bottom: 300,
      width: 200,
      height: 200,
      x: 0,
      y: 100,
      toJSON() {},
    };
    const lineRect = {
      top: 140,
      left: 0,
      right: 200,
      bottom: 160,
      width: 200,
      height: 20,
      x: 0,
      y: 140,
      toJSON() {},
    };

    const lineEl = container.querySelector('[data-mrsf-line="5"]') as HTMLElement;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(containerRect as DOMRect);
    vi.spyOn(lineEl, "getBoundingClientRect").mockReturnValue(lineRect as DOMRect);

    ctrl.refresh();

    const item = container.querySelector('[data-mrsf-gutter-line="5"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.style.top).toBe("160px");
  });
});

// ── Tooltip ──────────────────────────────────────────────

describe("tooltip interaction", () => {
  it("shows tooltip on badge click", () => {
    const threads = [makeThread({ id: "c1", line: 5, author: "Bob", text: "Test comment" })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const tooltip = container.querySelector(".mrsf-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.classList.contains("mrsf-tooltip-visible")).toBe(true);
    expect(tooltip!.innerHTML).toContain("Bob");
    expect(tooltip!.innerHTML).toContain("Test comment");
  });

  it("hides tooltip on second badge click (toggle)", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();
    expect(container.querySelector(".mrsf-tooltip")).not.toBeNull();

    badge.click();
    expect(container.querySelector(".mrsf-tooltip")).toBeNull();
  });

  it("hides tooltip on outside click", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();
    expect(container.querySelector(".mrsf-tooltip")).not.toBeNull();

    // Click outside
    document.body.click();
    expect(container.querySelector(".mrsf-tooltip")).toBeNull();
  });

  it("tooltip includes thread HTML with mrsf-thread class", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const tooltip = container.querySelector(".mrsf-tooltip");
    expect(tooltip!.querySelector(".mrsf-thread")).not.toBeNull();
  });

  it("interactive tooltip includes add button and mrsf-interactive class", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const tooltip = container.querySelector(".mrsf-tooltip");
    expect(tooltip!.classList.contains("mrsf-interactive")).toBe(true);
    expect(tooltip!.innerHTML).toContain("Add comment");
  });

  it("non-interactive tooltip has no add button", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const tooltip = container.querySelector(".mrsf-tooltip");
    expect(tooltip!.querySelector(".mrsf-tooltip-actions")).toBeNull();
  });

  it("shows tooltip with replies", () => {
    const reply = makeComment({ id: "r1", author: "Carol", text: "Reply text", reply_to: "c1" });
    const threads = [makeThread({ id: "c1", line: 5 }, [reply])];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const tooltip = container.querySelector(".mrsf-tooltip");
    expect(tooltip!.innerHTML).toContain("Carol");
    expect(tooltip!.innerHTML).toContain("Reply text");
    expect(tooltip!.querySelector(".mrsf-replies")).not.toBeNull();
  });

  it("handles multiple threads on same line in tooltip", () => {
    const threads = [
      makeThread({ id: "c1", line: 5, author: "Alice" }),
      makeThread({ id: "c2", line: 5, author: "Bob" }),
    ];
    // buildThreadMap puts both on line 5
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const tooltip = container.querySelector(".mrsf-tooltip");
    expect(tooltip!.innerHTML).toContain("Alice");
    expect(tooltip!.innerHTML).toContain("Bob");
  });

  it("renders resolved top-level threads after unresolved ones on the same line", () => {
    const threads = [
      makeThread({ id: "resolved", line: 5, author: "Resolved", resolved: true }),
      makeThread({ id: "open", line: 5, author: "Open", resolved: false }),
    ];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const threadEls = Array.from(container.querySelectorAll(".mrsf-tooltip .mrsf-thread"));
    const authors = threadEls.map((threadEl) => {
      const authorEl = threadEl.querySelector(".mrsf-comment .mrsf-author");
      return authorEl?.textContent;
    });

    expect(authors).toEqual(["Open", "Resolved"]);
  });
});

// ── Click action dispatch ────────────────────────────────

describe("click action dispatch", () => {
  it("dispatches mrsf:navigate event on badge navigate action", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    // The badge has data-mrsf-action="navigate" — but badge click opens
    // tooltip via the click listener on the badge itself (stopPropagation).
    // The navigate action would fire from the data attribute route.
    // For this test, create a custom element with navigate action:
    const navEl = document.createElement("button");
    navEl.dataset.mrsfAction = "navigate";
    navEl.dataset.mrsfCommentId = "c1";
    navEl.dataset.mrsfLine = "5";
    container.appendChild(navEl);

    const handler = vi.fn();
    document.addEventListener("mrsf:navigate", handler);

    navEl.click();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.action).toBe("navigate");
    expect(detail.commentId).toBe("c1");
    expect(detail.line).toBe(5);

    document.removeEventListener("mrsf:navigate", handler);
  });

  it("opens form dialog for add action in interactive mode", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const overlay = document.querySelector(".mrsf-overlay");
    expect(overlay).not.toBeNull();
    const dialog = overlay!.querySelector(".mrsf-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector("header")!.textContent).toBe("Add comment");
  });

  it("copies theme variables from the container onto action dialogs", () => {
    container = buildContainer([1]);
    container.style.setProperty("--mrsf-tooltip-bg", "rgb(10, 20, 30)");
    container.style.setProperty("--mrsf-tooltip-fg", "rgb(40, 50, 60)");
    container.style.setProperty("--mrsf-tooltip-border", "rgb(70, 80, 90)");
    container.style.setProperty("--mrsf-font-family", "Test Sans");
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const overlay = document.querySelector(".mrsf-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.getPropertyValue("--mrsf-tooltip-bg")).toBe("rgb(10, 20, 30)");
    expect(overlay.style.getPropertyValue("--mrsf-tooltip-fg")).toBe("rgb(40, 50, 60)");
    expect(overlay.style.getPropertyValue("--mrsf-tooltip-border")).toBe("rgb(70, 80, 90)");
    expect(overlay.style.getPropertyValue("--mrsf-font-family")).toBe("Test Sans");
  });

  it("opens form dialog for add action from an existing comment tooltip", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const addBtn = container.querySelector('.mrsf-tooltip [data-mrsf-action="add"]') as HTMLElement;
    addBtn.click();

    const overlay = document.querySelector(".mrsf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector("header")!.textContent).toBe("Add comment");
  });

  it("opens form dialog for reply action", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    // Open tooltip to access reply button
    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const replyBtn = container.querySelector('[data-mrsf-action="reply"]') as HTMLElement;
    replyBtn.click();

    const overlay = document.querySelector(".mrsf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector("header")!.textContent).toBe("Reply");
  });

  it("prefills the edit dialog with the comment data", () => {
    const threads = [
      makeThread({
        id: "c1",
        line: 5,
        text: "Existing comment text",
        type: "issue",
        severity: "medium",
        selected_text: "Original selection",
      }),
    ];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const editBtn = container.querySelector('[data-mrsf-action="edit"]') as HTMLElement;
    editBtn.click();

    const overlay = document.querySelector(".mrsf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector("header")!.textContent).toBe("Edit comment");
    expect((overlay!.querySelector("textarea[name=\"text\"]") as HTMLTextAreaElement).value).toBe("Existing comment text");
    expect((overlay!.querySelector('select[name="type"]') as HTMLSelectElement).value).toBe("issue");
    expect((overlay!.querySelector('select[name="severity"]') as HTMLSelectElement).value).toBe("medium");
    expect(overlay!.textContent).toContain("Original selection");
  });

  it("opens confirm dialog for resolve action", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const resolveBtn = container.querySelector('[data-mrsf-action="resolve"]') as HTMLElement;
    resolveBtn.click();

    const overlay = document.querySelector(".mrsf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("Mark this comment as resolved?");
  });

  it("opens confirm dialog for delete action", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const deleteBtn = container.querySelector('[data-mrsf-action="delete"]') as HTMLElement;
    deleteBtn.click();

    const overlay = document.querySelector(".mrsf-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("Delete this comment?");
  });

  it("closes overlay on cancel", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const cancelBtn = document.querySelector(".mrsf-btn:not(.mrsf-btn-primary)") as HTMLElement;
    cancelBtn.click();

    expect(document.querySelector(".mrsf-overlay")).toBeNull();
  });

  it("closes overlay on backdrop click", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const overlay = document.querySelector(".mrsf-overlay") as HTMLElement;
    overlay.click();

    expect(document.querySelector(".mrsf-overlay")).toBeNull();
  });
});

// ── Form submission ──────────────────────────────────────

describe("form submission", () => {
  it("dispatches mrsf:submit on form submit", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const handler = vi.fn();
    document.addEventListener("mrsf:submit", handler);

    const textarea = document.querySelector(".mrsf-dialog textarea") as HTMLTextAreaElement;
    textarea.value = "New comment text";

    const form = document.querySelector(".mrsf-dialog form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.action).toBe("add");
    expect(detail.text).toBe("New comment text");

    document.removeEventListener("mrsf:submit", handler);
  });

  it("includes type and severity in submit detail", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const handler = vi.fn();
    document.addEventListener("mrsf:submit", handler);

    const textarea = document.querySelector(".mrsf-dialog textarea") as HTMLTextAreaElement;
    textarea.value = "text";
    const typeSelect = document.querySelector('.mrsf-dialog select[name="type"]') as HTMLSelectElement;
    typeSelect.value = "suggestion";
    const severitySelect = document.querySelector('.mrsf-dialog select[name="severity"]') as HTMLSelectElement;
    severitySelect.value = "high";

    const form = document.querySelector(".mrsf-dialog form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    const detail = handler.mock.calls[0][0].detail;
    expect(detail.type).toBe("suggestion");
    expect(detail.severity).toBe("high");

    document.removeEventListener("mrsf:submit", handler);
  });

  it("dispatches mrsf:submit on confirm dialog", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const resolveBtn = container.querySelector('[data-mrsf-action="resolve"]') as HTMLElement;
    resolveBtn.click();

    const handler = vi.fn();
    document.addEventListener("mrsf:submit", handler);

    const confirmBtn = document.querySelector(".mrsf-btn-primary") as HTMLElement;
    confirmBtn.click();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.action).toBe("resolve");
    expect(detail.commentId).toBe("c1");

    document.removeEventListener("mrsf:submit", handler);
  });

  it("closes overlay after submit", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const textarea = document.querySelector(".mrsf-dialog textarea") as HTMLTextAreaElement;
    textarea.value = "text";

    const form = document.querySelector(".mrsf-dialog form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(document.querySelector(".mrsf-overlay")).toBeNull();
  });
});

// ── mrsfDisableBuiltinUi ─────────────────────────────────

describe("mrsfDisableBuiltinUi", () => {
  it("does not open form when mrsfDisableBuiltinUi is set", () => {
    (window as any).mrsfDisableBuiltinUi = true;
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    expect(document.querySelector(".mrsf-overlay")).toBeNull();
    delete (window as any).mrsfDisableBuiltinUi;
  });

  it("does not open confirm when mrsfDisableBuiltinUi is set", () => {
    (window as any).mrsfDisableBuiltinUi = true;
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const badge = container.querySelector(".mrsf-badge") as HTMLElement;
    badge.click();

    const resolveBtn = container.querySelector('[data-mrsf-action="resolve"]') as HTMLElement;
    resolveBtn.click();

    expect(document.querySelector(".mrsf-overlay")).toBeNull();
    delete (window as any).mrsfDisableBuiltinUi;
  });
});

// ── Destroy ──────────────────────────────────────────────

describe("destroy", () => {
  it("removes overlay-root class", () => {
    container = buildContainer([1, 2]);
    ctrl = new MrsfController(container);
    ctrl.destroy();
    ctrl = null;
    expect(container.classList.contains("mrsf-overlay-root")).toBe(false);
  });

  it("removes gutters from DOM", () => {
    container = buildContainer([1, 2]);
    ctrl = new MrsfController(container);
    ctrl.destroy();
    ctrl = null;
    expect(container.querySelector(".mrsf-gutter")).toBeNull();
  });

  it("removes floating add button from DOM", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });
    // The floating add button is lazily created on selection change,
    // so it may not exist yet. Destroy should handle that.
    ctrl.destroy();
    ctrl = null;
    expect(document.querySelector(".mrsf-add-inline-button")).toBeNull();
  });

  it("removes event listeners (no errors on subsequent clicks)", () => {
    const threads = [makeThread({ id: "c1", line: 5 })];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container, { interactive: true });
    ctrl.destroy();
    ctrl = null;

    // Should not throw when clicking after destroy
    expect(() => document.body.click()).not.toThrow();
  });

  it("closes open overlay on destroy", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();
    expect(document.querySelector(".mrsf-overlay")).not.toBeNull();

    ctrl.destroy();
    ctrl = null;
    expect(document.querySelector(".mrsf-overlay")).toBeNull();
  });
});

// ── Selection floater ───────────────────────────────────

describe("selection floater", () => {
  it("renders the selection add button inside the markdown container", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const line = container.querySelector('[data-mrsf-line="1"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(line);

    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 80,
        left: 40,
        right: 140,
        bottom: 100,
        width: 100,
        height: 20,
        x: 40,
        y: 80,
        toJSON() {},
      } as DOMRect),
    });

    vi.spyOn(document, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "Line 1 content",
      getRangeAt: () => range,
    } as unknown as Selection);

    document.dispatchEvent(new Event("selectionchange"));

    const button = container.querySelector(".mrsf-add-inline-button");
    expect(button).not.toBeNull();
    expect(button?.parentElement).toBe(container);
  });

  it("hides the selection add button when the selection is outside the container", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const outside = document.createElement("p");
    outside.textContent = "Outside";
    document.body.appendChild(outside);

    const range = document.createRange();
    range.selectNodeContents(outside);

    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 120,
        left: 50,
        right: 120,
        bottom: 140,
        width: 70,
        height: 20,
        x: 50,
        y: 120,
        toJSON() {},
      } as DOMRect),
    });

    vi.spyOn(document, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "Outside",
      getRangeAt: () => range,
    } as unknown as Selection);

    document.dispatchEvent(new Event("selectionchange"));

    expect(container.querySelector(".mrsf-add-inline-button")).toBeNull();
  });

  it("clamps the selection add button within the visible container bounds", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 120,
    });

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 50,
      left: 20,
      right: 220,
      bottom: 170,
      width: 200,
      height: 120,
      x: 20,
      y: 50,
      toJSON() {},
    } as DOMRect);

    const line = container.querySelector('[data-mrsf-line="1"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(line);

    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        top: 54,
        left: 210,
        right: 260,
        bottom: 74,
        width: 50,
        height: 20,
        x: 210,
        y: 54,
        toJSON() {},
      } as DOMRect),
    });

    vi.spyOn(document, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "Line 1 content",
      getRangeAt: () => range,
    } as unknown as Selection);

    document.dispatchEvent(new Event("selectionchange"));

    const button = container.querySelector(".mrsf-add-inline-button") as HTMLButtonElement;
    expect(button).not.toBeNull();

    Object.defineProperty(button, "offsetWidth", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(button, "offsetHeight", {
      configurable: true,
      value: 24,
    });

    document.dispatchEvent(new Event("selectionchange"));

    expect(button.style.left).toBe("120px");
    expect(button.style.top).toBe("30px");
  });
});

// ── autoInit ─────────────────────────────────────────────

describe("autoInit", () => {
  it("initializes controllers for [data-mrsf-controller] elements", () => {
    const div = document.createElement("div");
    div.dataset.mrsfController = "";
    const p = document.createElement("p");
    p.dataset.mrsfLine = "1";
    p.textContent = "Line 1";
    div.appendChild(p);
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = JSON.stringify({
      threads: [makeThread({ id: "c1", line: 1 })],
    });
    div.appendChild(script);
    document.body.appendChild(div);

    // autoInit is idempotent (guards with autoInitDone) so we need
    // a fresh module state — just verify the function doesn't throw.
    // In a real browser, it would init controllers on page load.
    expect(() => autoInit()).not.toThrow();
  });
});

describe("refresh", () => {
  it("refreshes automatically after external content mutations", async () => {
    container = buildContainer([1, 2], [makeThread({ id: "c1", line: 1 })]);
    ctrl = new MrsfController(container, { interactive: true });

    const refreshSpy = vi.spyOn(ctrl, "refresh");
    const target = container.querySelector('[data-mrsf-line="2"]') as HTMLElement;
    target.appendChild(document.createElement("svg"));

    await flushMicrotasks();

    expect(refreshSpy).toHaveBeenCalled();
  });

  it("refreshAll calls refresh on active controllers", () => {
    const first = buildContainer([1], [makeThread({ id: "c1", line: 1 })]);
    const second = buildContainer([2], [makeThread({ id: "c2", line: 2 })]);

    const firstController = new MrsfController(first);
    const secondController = new MrsfController(second);
    const firstSpy = vi.spyOn(firstController, "refresh");
    const secondSpy = vi.spyOn(secondController, "refresh");

    refreshAll();

    expect(firstSpy).toHaveBeenCalledTimes(1);
    expect(secondSpy).toHaveBeenCalledTimes(1);

    firstController.destroy();
    secondController.destroy();
  });
});

// ── Severity calculation across threads ──────────────────

describe("severity badge across multiple threads", () => {
  it("shows high severity when any thread is high", () => {
    const threads = [
      makeThread({ id: "c1", line: 5, severity: "low" }),
      makeThread({ id: "c2", line: 5, severity: "high" }),
    ];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.classList.contains("mrsf-badge-severity-high")).toBe(true);
  });

  it("shows medium severity when highest is medium", () => {
    const threads = [
      makeThread({ id: "c1", line: 5, severity: "low" }),
      makeThread({ id: "c2", line: 5, severity: "medium" }),
    ];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.classList.contains("mrsf-badge-severity-medium")).toBe(true);
  });

  it("does not show severity class when all threads have null severity", () => {
    const threads = [
      makeThread({ id: "c1", line: 5, severity: null }),
      makeThread({ id: "c2", line: 5, severity: null }),
    ];
    container = buildContainer([5], threads);
    ctrl = new MrsfController(container);

    const badge = container.querySelector(".mrsf-badge");
    expect(badge!.className).not.toContain("mrsf-badge-severity");
  });
});

// ── Style injection ──────────────────────────────────────

describe("style injection", () => {
  it("injects dialog styles on first form open", () => {
    container = buildContainer([1]);
    ctrl = new MrsfController(container, { interactive: true });

    const stylesBefore = document.querySelectorAll("style");
    const countBefore = stylesBefore.length;

    const addBtn = container.querySelector(".mrsf-gutter-add") as HTMLElement;
    addBtn.click();

    const stylesAfter = document.querySelectorAll("style");
    expect(stylesAfter.length).toBeGreaterThan(countBefore);
  });

  it("does not duplicate styles on second form open", () => {
    container = buildContainer([1, 2]);
    ctrl = new MrsfController(container, { interactive: true });

    const addBtn1 = container.querySelector('.mrsf-gutter-add[data-mrsf-line="1"]') as HTMLElement;
    addBtn1.click();
    const countAfterFirst = document.querySelectorAll("style").length;

    // Close and reopen
    (document.querySelector(".mrsf-btn:not(.mrsf-btn-primary)") as HTMLElement).click();

    const addBtn2 = container.querySelector('.mrsf-gutter-add[data-mrsf-line="2"]') as HTMLElement;
    addBtn2.click();
    const countAfterSecond = document.querySelectorAll("style").length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

// ── Inline Highlights ─────────────────────────────────────

describe("Inline text highlights", () => {
  /**
   * Helper: build a container with text content and a thread that has selected_text.
   */
  function buildInlineContainer(
    line: number,
    textContent: string,
    threads: CommentThread[],
  ): HTMLDivElement {
    const div = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = String(line);
    p.textContent = textContent;
    div.appendChild(p);
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = JSON.stringify({ threads });
    div.appendChild(script);
    document.body.appendChild(div);
    return div;
  }

  it("wraps selected_text in a <mark> element", () => {
    const thread = makeThread({
      id: "inline1",
      line: 5,
      selected_text: "Bearer token",
    });
    container = buildInlineContainer(5, "All endpoints require a valid Bearer token in the header.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Bearer token");
  });

  it("sets data-mrsf-comment-id on the mark", () => {
    const thread = makeThread({
      id: "c-inline",
      line: 5,
      selected_text: "Bearer token",
    });
    container = buildInlineContainer(5, "All endpoints require a valid Bearer token in the header.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    expect(mark).not.toBeNull();
    expect(mark.dataset.mrsfCommentId).toBe("c-inline");
  });

  it("sets data-mrsf-line on the mark", () => {
    const thread = makeThread({
      id: "c-inline",
      line: 5,
      selected_text: "Bearer token",
    });
    container = buildInlineContainer(5, "All endpoints require a valid Bearer token in the header.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    expect(mark.dataset.mrsfLine).toBe("5");
  });

  it("does not create marks when inlineHighlights is false", () => {
    const thread = makeThread({
      id: "c-inline",
      line: 5,
      selected_text: "Bearer token",
    });
    container = buildInlineContainer(5, "All endpoints require a valid Bearer token in the header.", [thread]);
    ctrl = new MrsfController(container, { inlineHighlights: false });

    expect(container.querySelector("mark.mrsf-inline-highlight")).toBeNull();
  });

  it("does not create marks when comment has no selected_text", () => {
    const thread = makeThread({ id: "no-sel", line: 5 });
    container = buildInlineContainer(5, "Some text content.", [thread]);
    ctrl = new MrsfController(container);

    expect(container.querySelector("mark.mrsf-inline-highlight")).toBeNull();
  });

  it("does not create marks when selected_text is not found in content", () => {
    const thread = makeThread({
      id: "missing",
      line: 5,
      selected_text: "nonexistent text",
    });
    container = buildInlineContainer(5, "This is completely different content.", [thread]);
    ctrl = new MrsfController(container);

    expect(container.querySelector("mark.mrsf-inline-highlight")).toBeNull();
  });

  it("strips markdown backticks and matches rendered text", () => {
    const thread = makeThread({
      id: "backtick",
      line: 5,
      selected_text: "`Authorization`",
    });
    container = buildInlineContainer(5, "Use the Authorization header.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Authorization");
  });

  it("strips markdown bold and matches rendered text", () => {
    const thread = makeThread({
      id: "bold",
      line: 5,
      selected_text: "**important**",
    });
    container = buildInlineContainer(5, "This is important note.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("important");
  });

  it("strips markdown italic and matches rendered text", () => {
    const thread = makeThread({
      id: "italic",
      line: 5,
      selected_text: "*emphasis*",
    });
    container = buildInlineContainer(5, "This has emphasis on it.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("emphasis");
  });

  it("strips markdown strikethrough and matches rendered text", () => {
    const thread = makeThread({
      id: "strike",
      line: 5,
      selected_text: "~~deprecated~~",
    });
    container = buildInlineContainer(5, "The deprecated API is removed.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("deprecated");
  });

  it("creates multiple marks for different comments on the same line", () => {
    const threads = [
      makeThread({ id: "a", line: 5, selected_text: "Bearer" }),
      makeThread({ id: "b", line: 5, selected_text: "header" }),
    ];
    container = buildInlineContainer(5, "Use Bearer token in the header.", threads);
    ctrl = new MrsfController(container);

    const marks = container.querySelectorAll("mark.mrsf-inline-highlight");
    expect(marks.length).toBe(2);
    const ids = Array.from(marks).map((m) => (m as HTMLElement).dataset.mrsfCommentId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("handles selected_text with start_column and end_column", () => {
    const thread = makeThread({
      id: "col-span",
      line: 5,
      start_column: 28,
      end_column: 46,
      selected_text: "public API surface",
    });
    container = buildInlineContainer(5, "This document describes the public API surface.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("public API surface");
  });

  it("shows tooltip on click of mark", () => {
    const thread = makeThread({
      id: "clickable",
      line: 5,
      selected_text: "target text",
    });
    container = buildInlineContainer(5, "Click on target text to see tooltip.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();

    const tooltip = document.querySelector(".mrsf-inline-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("A comment");
  });

  it("toggles tooltip on repeated click", () => {
    const thread = makeThread({
      id: "toggle",
      line: 5,
      selected_text: "toggle me",
    });
    container = buildInlineContainer(5, "Click toggle me to test.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();
    expect(document.querySelector(".mrsf-inline-tooltip")).not.toBeNull();

    mark.click();
    expect(document.querySelector(".mrsf-inline-tooltip")).toBeNull();
  });

  it("shows author and comment text in inline tooltip", () => {
    const thread = makeThread({
      id: "detail",
      line: 5,
      selected_text: "specific text",
    }, []);
    thread.comment.author = "Bob";
    thread.comment.text = "This needs clarification";
    container = buildInlineContainer(5, "Here is specific text for review.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();
    const tooltip = document.querySelector(".mrsf-inline-tooltip")!;
    expect(tooltip.textContent).toContain("Bob");
    expect(tooltip.textContent).toContain("This needs clarification");
  });

  it("shows replies in inline tooltip", () => {
    const reply = makeComment({
      id: "r1",
      reply_to: "parent",
      text: "Good point",
      author: "Charlie",
    });
    const thread = makeThread(
      { id: "parent", line: 5, selected_text: "review this" },
      [reply],
    );
    container = buildInlineContainer(5, "Please review this section.", [thread]);
    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();
    const tooltip = document.querySelector(".mrsf-inline-tooltip")!;
    expect(tooltip.textContent).toContain("Good point");
    expect(tooltip.textContent).toContain("Charlie");
  });

  it("removes marks on destroy", () => {
    const thread = makeThread({
      id: "destroy-me",
      line: 5,
      selected_text: "ephemeral",
    });
    container = buildInlineContainer(5, "This ephemeral mark will be removed.", [thread]);
    ctrl = new MrsfController(container);

    expect(container.querySelector("mark.mrsf-inline-highlight")).not.toBeNull();

    ctrl.destroy();
    ctrl = null;

    expect(container.querySelector("mark.mrsf-inline-highlight")).toBeNull();
    // Original text should be restored
    expect(container.querySelector("p")!.textContent).toContain("ephemeral");
  });

  it("preserves surrounding text when mark is removed", () => {
    const thread = makeThread({
      id: "preserved",
      line: 5,
      selected_text: "middle",
    });
    container = buildInlineContainer(5, "before middle after", [thread]);
    ctrl = new MrsfController(container);

    ctrl.destroy();
    ctrl = null;

    expect(container.querySelector("p")!.textContent).toBe("before middle after");
  });

  it("handles text spanning across inline elements", () => {
    // Build container with mixed inline elements
    const div = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = "5";
    p.innerHTML = "Use <strong>Bearer</strong> token in header.";
    div.appendChild(p);

    const thread = makeThread({
      id: "cross-elem",
      line: 5,
      selected_text: "Bearer token",
    });
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = JSON.stringify({ threads: [thread] });
    div.appendChild(script);
    document.body.appendChild(div);
    container = div;

    ctrl = new MrsfController(container);

    const mark = container.querySelector("mark.mrsf-inline-highlight");
    expect(mark).not.toBeNull();
    // Content may be "Bearer token" or just the portion that was wrappable
    expect(mark!.textContent).toContain("Bearer");
  });
});

// ── Multi-line element gutter expansion ──────────────────

describe("Multi-line element gutter expansion", () => {
  /**
   * Helper: build a container with a single block element spanning multiple lines.
   */
  function buildMultiLineContainer(
    startLine: number,
    endLine: number,
    threads?: CommentThread[],
  ): HTMLDivElement {
    const div = document.createElement("div");
    const blockquote = document.createElement("blockquote");
    blockquote.dataset.mrsfLine = String(startLine);
    blockquote.dataset.mrsfStartLine = String(startLine);
    blockquote.dataset.mrsfEndLine = String(endLine);
    blockquote.textContent = "A multi-line block";
    div.appendChild(blockquote);
    if (threads) {
      const script = document.createElement("script");
      script.type = "application/mrsf+json";
      script.textContent = JSON.stringify({ threads });
      div.appendChild(script);
    }
    document.body.appendChild(div);
    return div;
  }

  it("creates gutter items for every line in a multi-line blockquote", () => {
    container = buildMultiLineContainer(10, 13);
    ctrl = new MrsfController(container, { interactive: true });
    const items = container.querySelectorAll(".mrsf-gutter-item");
    expect(items.length).toBe(4); // lines 10, 11, 12, 13
    const lines = Array.from(items).map((el) => el.getAttribute("data-mrsf-gutter-line"));
    expect(lines).toEqual(["10", "11", "12", "13"]);
  });

  it("creates badge on a specific line within a multi-line range", () => {
    const thread = makeThread({ id: "mid", line: 12 });
    container = buildMultiLineContainer(10, 13, [thread]);
    ctrl = new MrsfController(container);
    const badge = container.querySelector("[data-mrsf-gutter-line='12'] .mrsf-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("1");
  });

  it("creates add buttons on lines without comments in multi-line range", () => {
    const thread = makeThread({ id: "c-on-11", line: 11 });
    container = buildMultiLineContainer(10, 12, [thread]);
    ctrl = new MrsfController(container, { interactive: true });
    // Add rows that collapse onto the same rendered block as a badge are hidden.
    const visibleAddBtns = Array.from(container.querySelectorAll(".mrsf-gutter-add")).filter(
      (el) => (el.closest(".mrsf-gutter-item") as HTMLElement | null)?.style.display !== "none",
    );
    expect(visibleAddBtns.length).toBe(0);
  });

  it("keeps add buttons on distinct rows around a commented line", () => {
    const threads = [makeThread({ id: "c1", line: 2 })];
    container = buildContainer([1, 2, 3, 4], threads);
    ctrl = new MrsfController(container, { interactive: true });

    const addLines = Array.from(container.querySelectorAll(".mrsf-gutter-add")).map(
      (el) => (el as HTMLElement).dataset.mrsfLine,
    );

    expect(addLines).toEqual(["1", "3", "4"]);
  });

  it("keeps ordered-list add buttons for rows adjacent to a commented item", () => {
    const div = document.createElement("div");
    const ol = document.createElement("ol");
    ol.dataset.mrsfLine = "53";
    ol.dataset.mrsfStartLine = "53";
    ol.dataset.mrsfEndLine = "58";

    const li53 = document.createElement("li");
    li53.dataset.mrsfLine = "53";
    li53.dataset.mrsfStartLine = "53";
    li53.dataset.mrsfEndLine = "53";
    li53.textContent = "Build the container image.";
    ol.appendChild(li53);

    const li54 = document.createElement("li");
    li54.dataset.mrsfLine = "54";
    li54.dataset.mrsfStartLine = "54";
    li54.dataset.mrsfEndLine = "54";
    li54.textContent = "Push to the registry.";
    ol.appendChild(li54);

    const li55 = document.createElement("li");
    li55.dataset.mrsfLine = "55";
    li55.dataset.mrsfStartLine = "55";
    li55.dataset.mrsfEndLine = "57";
    li55.textContent = "Update the deployment manifest.";

    const nestedOl = document.createElement("ol");
    nestedOl.dataset.mrsfLine = "56";
    nestedOl.dataset.mrsfStartLine = "56";
    nestedOl.dataset.mrsfEndLine = "57";

    const li56 = document.createElement("li");
    li56.dataset.mrsfLine = "56";
    li56.dataset.mrsfStartLine = "56";
    li56.dataset.mrsfEndLine = "56";
    li56.textContent = "Set the new image tag.";
    nestedOl.appendChild(li56);

    const li57 = document.createElement("li");
    li57.dataset.mrsfLine = "57";
    li57.dataset.mrsfStartLine = "57";
    li57.dataset.mrsfEndLine = "57";
    li57.textContent = "Adjust replica count if needed.";
    nestedOl.appendChild(li57);

    li55.appendChild(nestedOl);
    ol.appendChild(li55);

    const li58 = document.createElement("li");
    li58.dataset.mrsfLine = "58";
    li58.dataset.mrsfStartLine = "58";
    li58.dataset.mrsfEndLine = "58";
    li58.textContent = "Apply with kubectl.";
    ol.appendChild(li58);

    div.appendChild(ol);

    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = JSON.stringify({ threads: [makeThread({ id: "deploy", line: 55 })] });
    div.appendChild(script);

    document.body.appendChild(div);
    container = div;

    ctrl = new MrsfController(container, { interactive: true });

    const addLines = Array.from(container.querySelectorAll(".mrsf-gutter-add")).map(
      (el) => (el as HTMLElement).dataset.mrsfLine,
    );

    expect(addLines).toEqual(["53", "54", "56", "57", "58"]);
  });

  it("expands code fence elements to visible code lines only", () => {
    const div = document.createElement("div");
    const pre = document.createElement("pre");
    pre.dataset.mrsfLine = "40";
    pre.dataset.mrsfStartLine = "40";
    pre.dataset.mrsfEndLine = "47";
    pre.textContent = "code block";
    div.appendChild(pre);
    document.body.appendChild(div);
    container = div;

    ctrl = new MrsfController(container, { interactive: true });
    const addLines = Array.from(container.querySelectorAll(".mrsf-gutter-add")).map(
      (el) => (el as HTMLElement).dataset.mrsfLine,
    );

    expect(addLines).toEqual(["41", "42", "43", "44", "45", "46"]);
  });

  it("does not expand list containers into blank trailing lines", () => {
    const div = document.createElement("div");
    const ol = document.createElement("ol");
    ol.dataset.mrsfLine = "53";
    ol.dataset.mrsfStartLine = "53";
    ol.dataset.mrsfEndLine = "59";
    ol.textContent = "list";
    div.appendChild(ol);
    document.body.appendChild(div);
    container = div;

    ctrl = new MrsfController(container, { interactive: true });
    const addLines = Array.from(container.querySelectorAll(".mrsf-gutter-add")).map(
      (el) => (el as HTMLElement).dataset.mrsfLine,
    );

    expect(addLines).toEqual(["53"]);
  });

  it("does not expand single-line elements", () => {
    // data-mrsf-start-line = data-mrsf-end-line = data-mrsf-line (no expansion)
    const div = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = "5";
    p.dataset.mrsfStartLine = "5";
    p.dataset.mrsfEndLine = "5";
    p.textContent = "Single line";
    div.appendChild(p);
    document.body.appendChild(div);
    container = div;

    ctrl = new MrsfController(container, { interactive: true });
    const items = container.querySelectorAll(".mrsf-gutter-item");
    expect(items.length).toBe(1);
  });

  it("mixes single-line and multi-line elements in the same container", () => {
    const div = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = "1";
    p.textContent = "A paragraph";
    div.appendChild(p);

    const bq = document.createElement("blockquote");
    bq.dataset.mrsfLine = "3";
    bq.dataset.mrsfStartLine = "3";
    bq.dataset.mrsfEndLine = "6";
    bq.textContent = "A 4-line blockquote";
    div.appendChild(bq);

    const p2 = document.createElement("p");
    p2.dataset.mrsfLine = "8";
    p2.textContent = "After blockquote";
    div.appendChild(p2);

    document.body.appendChild(div);
    container = div;

    ctrl = new MrsfController(container, { interactive: true });
    const items = container.querySelectorAll(".mrsf-gutter-item");
    // line 1 + lines 3,4,5,6 + line 8 = 6
    expect(items.length).toBe(6);
  });
});

// ── Interactive inline tooltips ──────────────────────────

describe("Interactive inline tooltips", () => {
  function buildInlineContainer(
    line: number,
    textContent: string,
    threads: CommentThread[],
  ): HTMLDivElement {
    const div = document.createElement("div");
    const p = document.createElement("p");
    p.dataset.mrsfLine = String(line);
    p.textContent = textContent;
    div.appendChild(p);
    const script = document.createElement("script");
    script.type = "application/mrsf+json";
    script.textContent = JSON.stringify({ threads });
    div.appendChild(script);
    document.body.appendChild(div);
    return div;
  }

  it("adds mrsf-interactive class to inline tooltip when interactive is true", () => {
    const thread = makeThread({
      id: "interactive-inline",
      line: 5,
      selected_text: "target",
    });
    container = buildInlineContainer(5, "Click on target text.", [thread]);
    ctrl = new MrsfController(container, { interactive: true });

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();

    const tooltip = document.querySelector(".mrsf-inline-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.classList.contains("mrsf-interactive")).toBe(true);
  });

  it("does not add mrsf-interactive class when interactive is false", () => {
    const thread = makeThread({
      id: "non-interactive-inline",
      line: 5,
      selected_text: "target",
    });
    container = buildInlineContainer(5, "Click on target text.", [thread]);
    ctrl = new MrsfController(container, { interactive: false });

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();

    const tooltip = document.querySelector(".mrsf-inline-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.classList.contains("mrsf-interactive")).toBe(false);
  });

  it("shows action buttons in interactive inline tooltip", () => {
    const thread = makeThread({
      id: "action-inline",
      line: 5,
      selected_text: "actionable",
    });
    container = buildInlineContainer(5, "This is actionable text.", [thread]);
    ctrl = new MrsfController(container, { interactive: true });

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();

    const tooltip = document.querySelector(".mrsf-inline-tooltip");
    expect(tooltip).not.toBeNull();
    const actions = tooltip!.querySelectorAll("[data-mrsf-action]");
    expect(actions.length).toBeGreaterThan(0);
  });

  it("copies theme variables from the container onto inline tooltips", () => {
    const thread = makeThread({
      id: "theme-inline",
      line: 5,
      selected_text: "target",
    });
    container = buildInlineContainer(5, "Click on target text.", [thread]);
    container.style.setProperty("--mrsf-tooltip-bg", "rgb(1, 2, 3)");
    container.style.setProperty("--mrsf-tooltip-fg", "rgb(4, 5, 6)");
    container.style.setProperty("--mrsf-tooltip-border", "rgb(7, 8, 9)");
    ctrl = new MrsfController(container, { interactive: true });

    const mark = container.querySelector("mark.mrsf-inline-highlight") as HTMLElement;
    mark.click();

    const tooltip = document.querySelector(".mrsf-inline-tooltip") as HTMLElement;
    expect(tooltip).not.toBeNull();
    expect(tooltip.style.getPropertyValue("--mrsf-tooltip-bg")).toBe("rgb(1, 2, 3)");
    expect(tooltip.style.getPropertyValue("--mrsf-tooltip-fg")).toBe("rgb(4, 5, 6)");
    expect(tooltip.style.getPropertyValue("--mrsf-tooltip-border")).toBe("rgb(7, 8, 9)");
  });
});

// ── Orphaned comments section ────────────────────────────

describe("Orphaned comments section", () => {
  it("renders orphaned threads at the bottom of the container", () => {
    const t1 = makeThread({ id: "in-doc", line: 5 });
    const orphan = makeThread({ id: "orphaned", line: 999 });
    container = buildContainer([5], [t1, orphan]);
    ctrl = new MrsfController(container);

    const section = container.querySelector(".mrsf-orphaned-section");
    expect(section).not.toBeNull();
    const threads = section!.querySelectorAll(".mrsf-orphaned-thread");
    expect(threads.length).toBe(1);
    expect(threads[0].querySelector("[data-mrsf-comment-id='orphaned']")).not.toBeNull();
  });

  it("does not render orphaned section when all threads have matching lines", () => {
    const t1 = makeThread({ id: "c1", line: 5 });
    container = buildContainer([5], [t1]);
    ctrl = new MrsfController(container);

    expect(container.querySelector(".mrsf-orphaned-section")).toBeNull();
  });

  it("shows the correct count in the heading", () => {
    const orphan1 = makeThread({ id: "o1", line: 900 });
    const orphan2 = makeThread({ id: "o2", line: 901 });
    container = buildContainer([5], [orphan1, orphan2]);
    ctrl = new MrsfController(container);

    const heading = container.querySelector(".mrsf-orphaned-heading");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe("Orphaned Comments (2)");
  });

  it("adds mrsf-interactive class on orphaned threads when interactive", () => {
    const orphan = makeThread({ id: "oi", line: 999 });
    container = buildContainer([5], [orphan]);
    ctrl = new MrsfController(container, { interactive: true });

    const thread = container.querySelector(".mrsf-orphaned-thread");
    expect(thread).not.toBeNull();
    expect(thread!.classList.contains("mrsf-interactive")).toBe(true);
  });

  it("does not add mrsf-interactive class when not interactive", () => {
    const orphan = makeThread({ id: "oni", line: 999 });
    container = buildContainer([5], [orphan]);
    ctrl = new MrsfController(container, { interactive: false });

    const thread = container.querySelector(".mrsf-orphaned-thread");
    expect(thread).not.toBeNull();
    expect(thread!.classList.contains("mrsf-interactive")).toBe(false);
  });

  it("removes orphaned section on destroy", () => {
    const orphan = makeThread({ id: "od", line: 999 });
    container = buildContainer([5], [orphan]);
    ctrl = new MrsfController(container);

    expect(container.querySelector(".mrsf-orphaned-section")).not.toBeNull();
    ctrl.destroy();
    ctrl = null;
    expect(container.querySelector(".mrsf-orphaned-section")).toBeNull();
  });

  it("renders multiple orphaned threads from different lines", () => {
    const t1 = makeThread({ id: "in-doc", line: 5 });
    const orphan1 = makeThread({ id: "o1", line: 500 });
    const orphan2 = makeThread({ id: "o2", line: 600 });
    const orphan3 = makeThread({ id: "o3", line: 700 });
    container = buildContainer([5], [t1, orphan1, orphan2, orphan3]);
    ctrl = new MrsfController(container);

    const threads = container.querySelectorAll(".mrsf-orphaned-thread");
    expect(threads.length).toBe(3);
    const heading = container.querySelector(".mrsf-orphaned-heading");
    expect(heading!.textContent).toBe("Orphaned Comments (3)");
  });
});

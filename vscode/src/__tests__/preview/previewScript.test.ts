import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const script = readFileSync(new URL("../../../preview/previewScript.js", import.meta.url), "utf8");
let dom: JSDOM;

function content(text = "First comment"): string {
  const comments = JSON.stringify([{ id: "c1", author: "Reviewer", text, line: 1, selected_text: "Hello" }]);
  return `<div class="markdown-body"><p data-line="0">Hello world</p>
    <div id="mrsf-comment-data" data-document-uri="file:///workspace/doc.md" data-comments='${comments}'></div>
    <div id="mrsf-preview-meta"></div></div>`;
}

beforeEach(() => {
  dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
});

afterEach(() => {
  dom.window.dispatchEvent(new dom.window.Event("pagehide"));
  dom.window.close();
});

describe("Markdown preview lifecycle", () => {
  it.each([
    { left: 280, top: 210, anchorTop: 200, translation: "translate(-248px, -178px)" },
    { left: -120, top: -20, anchorTop: -40, translation: "translate(128px, 28px)" },
  ])("clamps tooltip placement at viewport edges ($left, $top)", async ({ left, top, anchorTop, translation }) => {
    dom.window.document.body.innerHTML = content();
    Object.defineProperty(dom.window.document.documentElement, "clientWidth", { value: 320 });
    Object.defineProperty(dom.window.document.documentElement, "clientHeight", { value: 240 });
    vi.spyOn(dom.window.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("mrsf-tooltip")) {
        return { left, top, right: left + 280, bottom: top + 160, width: 280, height: 160 } as DOMRect;
      }
      return { left: 0, top: anchorTop, right: 30, bottom: anchorTop + 20, width: 30, height: 20 } as DOMRect;
    });
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelector(".mrsf-badge")).not.toBeNull());
    dom.window.document.querySelector<HTMLElement>(".mrsf-badge")!.click();
    const tooltip = dom.window.document.querySelector<HTMLElement>(".mrsf-tooltip-visible")!;
    expect(tooltip.style.transform).toBe(translation);
    expect(tooltip.style.getPropertyValue("--mrsf-tooltip-available-width")).toBe("304px");
    expect(tooltip.style.getPropertyValue("--mrsf-tooltip-available-height")).toBe("224px");
    dom.window.dispatchEvent(new dom.window.Event("scroll"));
    expect(tooltip.style.transform).toBe(translation);
    dom.window.dispatchEvent(new dom.window.CustomEvent("vscode.markdown.updateContent"));
    await vi.waitFor(() => {
      const replacement = dom.window.document.querySelector<HTMLElement>(".mrsf-tooltip-visible")!;
      expect(replacement === tooltip).toBe(false);
      expect(replacement.style.transform).toBe(translation);
    });
  });

  it("ignores unchanged viewport resize notifications but handles actual resizing", async () => {
    dom.window.document.body.innerHTML = content();
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelector(".mrsf-badge")).not.toBeNull());
    const badge = dom.window.document.querySelector(".mrsf-badge");
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(() => resolve())));
    expect(dom.window.document.querySelector(".mrsf-badge") === badge).toBe(true);
    Object.defineProperty(dom.window, "innerWidth", { value: 800, configurable: true });
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    await vi.waitFor(() => expect(dom.window.document.querySelector(".mrsf-badge") === badge).toBe(false));
  });

  it("keeps click targets stable when the host measures layout outside Markdown content", async () => {
    dom.window.document.body.innerHTML = content();
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelector(".mrsf-badge")).not.toBeNull());
    const badge = dom.window.document.querySelector(".mrsf-badge");
    const measurement = dom.window.document.createElement("span");
    measurement.textContent = "layout probe";
    dom.window.document.body.appendChild(measurement);
    measurement.remove();
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(() => resolve())));
    expect(dom.window.document.querySelector(".mrsf-badge") === badge).toBe(true);
  });

  it.each([".mrsf-inline-highlight", ".mrsf-badge", ".mrsf-comment"])("routes the original user click on %s through a real extension link", async (selector) => {
    dom.window.document.body.innerHTML = content();
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelector(selector)).not.toBeNull());
    const target = dom.window.document.querySelector(selector)!;
    const link = target.closest("a")!;
    expect(link).not.toBeNull();
    const uri = new URL(link.href);
    expect(uri.pathname).toBe("/revealComment");
    expect(uri.searchParams.get("commentId")).toBe("c1");
    expect(uri.searchParams.get("documentUri")).toBe("file:///workspace/doc.md");
    const forwarded = vi.fn((event: Event) => event.preventDefault());
    dom.window.addEventListener("click", forwarded);
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, view: dom.window });
    target.dispatchEvent(click);
    expect(forwarded).toHaveBeenCalledExactlyOnceWith(click);
    expect(dom.window.document.querySelector(".markdown-body")?.textContent).toContain("Hello world");
  });

  it("keeps inline-only comments natively focusable without a gutter badge", async () => {
    dom.window.document.body.innerHTML = content();
    dom.window.document.getElementById("mrsf-comment-data")!.dataset.gutterForInline = "false";
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelectorAll(".mrsf-inline-highlight")).toHaveLength(1));
    expect(dom.window.document.querySelectorAll(".mrsf-badge")).toHaveLength(0);
    const mark = dom.window.document.querySelector<HTMLAnchorElement>(".mrsf-inline-highlight")!;
    expect(mark.tagName).toBe("A");
    expect(mark.tabIndex).toBe(0);
    expect(mark.href).toContain("/revealComment?");
    const key = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    mark.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    mark.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dom.window.document.querySelector(".mrsf-tooltip-visible")).not.toBeNull();
  });

  it("filters resolved comments and keeps first-comment links document-bound", async () => {
    dom.window.document.body.innerHTML = content();
    const data = dom.window.document.getElementById("mrsf-comment-data")!;
    data.dataset.showResolved = "false";
    data.dataset.uriScheme = "vscode-insiders";
    data.dataset.comments = JSON.stringify([{ id: "resolved", line: 1, resolved: true }]);
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelector(".mrsf-add-button")).not.toBeNull());
    expect(dom.window.document.querySelector(".mrsf-badge")).toBeNull();
    const href = dom.window.document.querySelector(".mrsf-add-button")!.getAttribute("href")!;
    expect(href.startsWith("vscode-insiders://wictor.mrsf-vscode/addLineComment")).toBe(true);
    expect(new URL(href).searchParams.get("documentUri")).toBe("file:///workspace/doc.md");
    expect(new URL(href).searchParams.get("line")).toBe("1");
    const forwarded = vi.fn((event: Event) => expect(event.defaultPrevented).toBe(true));
    dom.window.addEventListener("click", forwarded);
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, view: dom.window });
    dom.window.document.querySelector(".mrsf-add-button")!.dispatchEvent(click);
    expect(forwarded).toHaveBeenCalledExactlyOnceWith(click);
  });

  it.each(["comments-disabled", "preview-disabled", "all-resolved", "empty"])("navigates without annotations when %s", async (mode) => {
    dom.window.document.body.innerHTML = content();
    const scroll = vi.fn();
    dom.window.HTMLElement.prototype.scrollIntoView = scroll;
    const data = dom.window.document.getElementById("mrsf-comment-data")!;
    const meta = dom.window.document.getElementById("mrsf-preview-meta")!;
    meta.dataset.documentUri = "file:///workspace/doc.md";
    meta.dataset.scrollRequestId = "1";
    meta.dataset.scrollToLine = "1";
    if (mode === "comments-disabled" || mode === "preview-disabled") {
      meta.dataset[mode === "comments-disabled" ? "commentsEnabled" : "previewComments"] = "false";
      data.remove();
    } else {
      data.dataset.showResolved = "false";
      data.dataset.comments = mode === "empty" ? "[]" : JSON.stringify([{ id: "c1", line: 1, resolved: true }]);
    }
    dom.window.eval(script);
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(dom.window.document.querySelector(".mrsf-badge")).toBeNull();
    expect(dom.window.document.querySelector(".mrsf-inline-highlight")).toBeNull();
    dom.window.dispatchEvent(new dom.window.CustomEvent("vscode.markdown.updateContent"));
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("restores annotations when comments are enabled without reopening the preview", async () => {
    dom.window.document.body.innerHTML = content();
    const meta = dom.window.document.getElementById("mrsf-preview-meta")!;
    meta.dataset.documentUri = "file:///workspace/doc.md";
    meta.dataset.commentsEnabled = "false";
    dom.window.document.getElementById("mrsf-comment-data")!.remove();
    dom.window.eval(script);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    expect(dom.window.document.querySelector(".mrsf-badge")).toBeNull();
    expect(dom.window.document.querySelector(".mrsf-preview-gutter")).toBeNull();

    dom.window.document.querySelector(".markdown-body")!.outerHTML = content();
    dom.window.dispatchEvent(new dom.window.CustomEvent("vscode.markdown.updateContent"));
    await vi.waitFor(() => expect(dom.window.document.querySelectorAll(".mrsf-badge")).toHaveLength(1));
    expect(dom.window.document.querySelectorAll(".mrsf-inline-highlight")).toHaveLength(1);
  });

  it("handles each navigation request once across content rerenders", async () => {
    dom.window.document.body.innerHTML = content();
    const scroll = vi.fn();
    dom.window.HTMLElement.prototype.scrollIntoView = scroll;
    const meta = dom.window.document.getElementById("mrsf-preview-meta")!;
    meta.dataset.documentUri = "file:///workspace/doc.md";
    meta.dataset.scrollRequestId = "1";
    meta.dataset.scrollToLine = "1";
    dom.window.eval(script);
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    dom.window.dispatchEvent(new dom.window.CustomEvent("vscode.markdown.updateContent"));
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    expect(scroll).toHaveBeenCalledTimes(1);
    meta.dataset.scrollRequestId = "2";
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  });

  it("renders content inserted after the script and DOMContentLoaded", async () => {
    dom.window.eval(script);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    dom.window.document.body.insertAdjacentHTML("beforeend", content());
    await vi.waitFor(() => expect(dom.window.document.querySelectorAll(".mrsf-badge")).toHaveLength(1));
    expect(dom.window.document.querySelectorAll(".mrsf-inline-highlight")).toHaveLength(1);
  });

  it("rerenders updated content without resizing or accumulating annotations", async () => {
    dom.window.document.body.innerHTML = content();
    dom.window.eval(script);
    await vi.waitFor(() => expect(dom.window.document.querySelectorAll(".mrsf-badge")).toHaveLength(1));
    dom.window.document.querySelector(".markdown-body")!.outerHTML = content("Updated comment");
    dom.window.dispatchEvent(new dom.window.CustomEvent("vscode.markdown.updateContent"));
    await vi.waitFor(() => expect(dom.window.document.querySelector(".mrsf-comment-body")?.textContent).toBe("Updated comment"));
    dom.window.dispatchEvent(new dom.window.CustomEvent("vscode.markdown.updateContent"));
    await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    expect(dom.window.document.querySelectorAll(".mrsf-badge")).toHaveLength(1);
    expect(dom.window.document.querySelectorAll(".mrsf-inline-highlight")).toHaveLength(1);
    expect(dom.window.document.querySelectorAll(".mrsf-preview-gutter")).toHaveLength(1);
  });
});
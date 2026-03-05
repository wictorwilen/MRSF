/**
 * MRSF rehype plugin — hast element factories.
 *
 * Creates hast element nodes for badges, tooltips, highlights, and
 * gutter containers. Uses shared HTML helpers for comment/thread rendering.
 */

import type { Element, ElementContent, Text } from "hast";
import type { CommentThread } from "./types.js";
import { escapeHtml, renderThreadHtml } from "@mrsf/plugin-shared";

/**
 * Create a badge + tooltip element for the gutter.
 */
export function createBadge(
  line: number,
  threads: CommentThread[],
  interactive: boolean,
  gutterPosition: "left" | "tight" | "right",
): Element {
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

  // Badge element
  const badge: Element = {
    type: "element",
    tagName: "span",
    properties: {
      className: classes,
      "data-mrsf-line": String(line),
      "data-mrsf-action": "navigate",
      "data-mrsf-comment-id": threads[0].comment.id,
      tabIndex: 0,
    },
    children: [{ type: "text", value: `${icon} ${total}` }],
  };

  // Tooltip (raw HTML via shared helpers)
  let tooltipInner = "";
  for (const thread of threads) {
    tooltipInner += renderThreadHtml(thread, interactive);
  }
  if (interactive) {
    tooltipInner += `<span class="mrsf-tooltip-actions"><button class="mrsf-action-btn" data-mrsf-action="add" data-mrsf-line="${line}" data-mrsf-start-line="${line}" data-mrsf-end-line="${line}">Add comment</button></span>`;
  }
  const tooltipClasses = ["mrsf-tooltip"];
  if (interactive) {
    tooltipClasses.push("mrsf-interactive");
  }
  const tooltip: Element = {
    type: "element",
    tagName: "span",
    properties: {
      className: tooltipClasses,
      "data-mrsf-line": String(line),
    },
    children: [{ type: "raw", value: tooltipInner } as unknown as ElementContent],
  };

  // Tooltip anchor wrapper
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["mrsf-tooltip-anchor", `mrsf-gutter-${gutterPosition}`],
    },
    children: interactive
      ? [
        badge,
        {
          type: "element",
          tagName: "button",
          properties: {
            className: ["mrsf-gutter-add"],
            "data-mrsf-action": "add",
            "data-mrsf-line": String(line),
            "data-mrsf-start-line": String(line),
            "data-mrsf-end-line": String(line),
            ariaLabel: "Add comment",
          },
          children: [{ type: "text", value: "+" }],
        },
        tooltip,
      ]
      : [badge, tooltip],
  };
}

/**
 * Create a gutter add button for lines without existing threads.
 */
export function createAddControl(
  line: number,
  gutterPosition: "left" | "tight" | "right",
): Element {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["mrsf-tooltip-anchor", "mrsf-gutter-add-only", `mrsf-gutter-${gutterPosition}`],
    },
    children: [
      {
        type: "element",
        tagName: "button",
        properties: {
          className: ["mrsf-gutter-add"],
          "data-mrsf-action": "add",
          "data-mrsf-line": String(line),
          "data-mrsf-start-line": String(line),
          "data-mrsf-end-line": String(line),
          ariaLabel: "Add comment",
        },
        children: [{ type: "text", value: "+" }],
      },
    ],
  };
}

/**
 * Create an inline highlight wrapper (<mark> + tooltip).
 */
export function createHighlight(
  text: string,
  thread: CommentThread,
  interactive: boolean,
): Element {
  const tooltipHtml = renderThreadHtml(thread, interactive);

  const mark: Element = {
    type: "element",
    tagName: "mark",
    properties: {
      className: ["mrsf-highlight"],
      "data-mrsf-comment-id": thread.comment.id,
      tabIndex: 0,
    },
    children: [{ type: "text", value: text }],
  };

  const inlineTooltipClasses = ["mrsf-tooltip", "mrsf-inline-tooltip"];
  if (interactive) {
    inlineTooltipClasses.push("mrsf-interactive");
  }
  const tooltip: Element = {
    type: "element",
    tagName: "span",
    properties: {
      className: inlineTooltipClasses,
    },
    children: [{ type: "raw", value: tooltipHtml } as unknown as ElementContent],
  };

  return {
    type: "element",
    tagName: "span",
    properties: {
      className: ["mrsf-tooltip-anchor", "mrsf-inline-anchor"],
      "data-mrsf-line": thread.comment.line ?? undefined,
      "data-mrsf-start-line": thread.comment.line ?? undefined,
      "data-mrsf-end-line": thread.comment.end_line ?? thread.comment.line ?? undefined,
      "data-mrsf-start-column": thread.comment.start_column ?? undefined,
      "data-mrsf-end-column": thread.comment.end_column ?? undefined,
    },
    children: [mark, tooltip],
  };
}

/**
 * Create the gutter container wrapper for left gutter mode.
 */
export function createGutterContainer(children: ElementContent[]): Element {
  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["mrsf-gutter-container"],
    },
    children,
  };
}

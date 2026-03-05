/**
 * MRSF markdown-it plugin — renderer rules.
 *
 * Adds custom renderer rules for MRSF tokens:
 *   - mrsf_badge: renders badge + tooltip HTML (gutter)
 *   - mrsf_highlight_open/close: renders <mark> wrappers with inline tooltips
 */

import type { CommentThread } from "../types.js";
import { escapeHtml, renderThreadHtml } from "@mrsf/plugin-shared";

/**
 * Install MRSF renderer rules on a markdown-it instance.
 */
export function installRendererRules(
  md: { renderer: { rules: Record<string, ((...args: any[]) => string) | undefined> } },
): void {
  // Badge + tooltip (gutter)
  md.renderer.rules["mrsf_badge"] = (
    tokens: { meta: { line: number; threads: CommentThread[]; interactive: boolean; gutterPosition: "left" | "tight" | "right" } }[],
    idx: number,
  ): string => {
    const { line, threads, interactive, gutterPosition } = tokens[idx].meta;

    const total = threads.reduce(
      (n, t) => n + 1 + t.replies.length,
      0,
    );
    const allResolved = threads.every((t) => t.comment.resolved);
    const highestSeverity = threads.reduce<string | null>((sev, t) => {
      if (t.comment.severity === "high" || sev === "high") return "high";
      if (t.comment.severity === "medium" || sev === "medium") return "medium";
      if (t.comment.severity === "low" || sev === "low") return "low";
      return sev;
    }, null);

    const resolvedClass = allResolved ? " mrsf-badge-resolved" : "";
    const severityClass = highestSeverity === "high" || highestSeverity === "medium"
      ? ` mrsf-badge-severity-${highestSeverity}`
      : "";
    const positionClass = ` mrsf-gutter-${gutterPosition}`;

    const icon = allResolved ? "✓" : "💬";

    let html = `<span class="mrsf-tooltip-anchor${positionClass}">`;

    // Badge
    html += `<span class="mrsf-badge${resolvedClass}${severityClass}" data-mrsf-line="${line}" data-mrsf-action="navigate" data-mrsf-comment-id="${escapeHtml(threads[0].comment.id)}" tabindex="0">${icon} ${total}</span>`;

    // Tooltip
    html += `<span class="mrsf-tooltip" data-mrsf-line="${line}">`;
    for (const thread of threads) {
      html += renderThreadHtml(thread, interactive);
    }
    html += `</span>`;

    html += `</span>`;
    return html;
  };

  // Highlight open — wraps in tooltip-anchor for inline hover (feature D)
  md.renderer.rules["mrsf_highlight_open"] = (
    tokens: any[],
    idx: number,
  ): string => {
    const token = tokens[idx];
    const cls = token.attrGet("class") || "mrsf-highlight";
    const commentId = token.attrGet("data-mrsf-comment-id") || "";
    const thread = token.meta?.thread as CommentThread | undefined;

    let html = "";
    if (thread) {
      html += `<span class="mrsf-tooltip-anchor mrsf-inline-anchor">`;
    }
    html += `<mark class="${escapeHtml(cls)}" data-mrsf-comment-id="${escapeHtml(commentId)}" tabindex="0">`;
    return html;
  };

  // Highlight close — adds inline tooltip and closes tooltip-anchor
  md.renderer.rules["mrsf_highlight_close"] = (
    tokens: any[],
    idx: number,
  ): string => {
    const token = tokens[idx];
    const meta = token.meta;
    let html = "</mark>";

    if (meta?.thread) {
      const thread = meta.thread as CommentThread;
      const interactive = meta.interactive as boolean;
      html += `<span class="mrsf-tooltip mrsf-inline-tooltip">`;
      html += renderThreadHtml(thread, interactive);
      html += `</span>`;
      html += `</span>`;
    }

    return html;
  };

  // Gutter container wrapper (left gutter mode)
  md.renderer.rules["mrsf_gutter_open"] = (
    tokens: any[],
    idx: number,
  ): string => {
    const cls = tokens[idx].attrGet("class") || "mrsf-gutter-container";
    return `<div class="${escapeHtml(cls)}">`;
  };

  md.renderer.rules["mrsf_gutter_close"] = (): string => {
    return `</div>`;
  };
}

/**
 * MRSF markdown-it plugin — renderer rules.
 *
 * Adds custom renderer rules for MRSF tokens:
 *   - mrsf_badge: renders badge + tooltip HTML (gutter)
 *   - mrsf_highlight_open/close: renders <mark> wrappers with inline tooltips
 */

import type { CommentThread, SlimComment } from "../types.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function renderCommentHtml(
  comment: SlimComment,
  isReply: boolean,
  interactive: boolean,
): string {
  const resolvedClass = comment.resolved ? " mrsf-resolved" : "";
  const replyClass = isReply ? " mrsf-reply" : "";
  let html = `<span class="mrsf-comment${resolvedClass}${replyClass}" data-mrsf-comment-id="${escapeHtml(comment.id)}">`;

  // Header
  html += `<span class="mrsf-comment-header">`;
  html += `<span class="mrsf-author">${escapeHtml(comment.author)}</span>`;
  if (comment.timestamp) {
    html += `<span class="mrsf-date">${escapeHtml(formatTime(comment.timestamp))}</span>`;
  }
  if (comment.severity) {
    html += `<span class="mrsf-severity mrsf-severity-${escapeHtml(comment.severity)}">${escapeHtml(comment.severity)}</span>`;
  }
  if (comment.type) {
    html += `<span class="mrsf-type">${escapeHtml(comment.type)}</span>`;
  }
  if (comment.resolved) {
    html += `<span class="mrsf-resolved-badge">✓ resolved</span>`;
  }
  html += `</span>`;

  // Selected text quote
  if (comment.selected_text) {
    html += `<span class="mrsf-selected-text">${escapeHtml(comment.selected_text)}</span>`;
  }

  // Body
  html += `<span class="mrsf-comment-body">${escapeHtml(comment.text)}</span>`;

  // Action buttons (interactive mode)
  if (interactive) {
    const line = comment.line != null ? String(comment.line) : "";
    html += `<span class="mrsf-actions">`;
    if (comment.resolved) {
      html += `<button class="mrsf-action-btn" data-mrsf-action="unresolve" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Unresolve</button>`;
    } else {
      html += `<button class="mrsf-action-btn" data-mrsf-action="resolve" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Resolve</button>`;
    }
    html += `<button class="mrsf-action-btn" data-mrsf-action="reply" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Reply</button>`;
    html += `<button class="mrsf-action-btn" data-mrsf-action="edit" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Edit</button>`;
    html += `</span>`;
  }

  html += `</span>`;
  return html;
}

function renderThreadHtml(thread: CommentThread, interactive: boolean): string {
  let html = `<span class="mrsf-thread">`;
  html += renderCommentHtml(thread.comment, false, interactive);
  if (thread.replies.length > 0) {
    html += `<span class="mrsf-replies">`;
    for (const reply of thread.replies) {
      html += renderCommentHtml(reply, true, interactive);
    }
    html += `</span>`;
  }
  html += `</span>`;
  return html;
}

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
}

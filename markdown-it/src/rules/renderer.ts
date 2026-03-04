/**
 * MRSF markdown-it plugin — renderer rules.
 *
 * Adds custom renderer rules for MRSF tokens:
 *   - mrsf_badge: renders badge + tooltip HTML
 *   - mrsf_highlight_open/close: renders <mark> wrappers
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
  let html = `<div class="mrsf-comment${resolvedClass}${replyClass}" data-mrsf-comment-id="${escapeHtml(comment.id)}">`;

  // Header
  html += `<div class="mrsf-comment-header">`;
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
  html += `</div>`;

  // Selected text quote
  if (comment.selected_text) {
    html += `<div class="mrsf-selected-text">${escapeHtml(comment.selected_text)}</div>`;
  }

  // Body
  html += `<div class="mrsf-comment-body">${escapeHtml(comment.text)}</div>`;

  // Action buttons (interactive mode)
  if (interactive) {
    const line = comment.line != null ? String(comment.line) : "";
    html += `<div class="mrsf-actions">`;
    if (comment.resolved) {
      html += `<button class="mrsf-action-btn" data-mrsf-action="unresolve" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Unresolve</button>`;
    } else {
      html += `<button class="mrsf-action-btn" data-mrsf-action="resolve" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Resolve</button>`;
    }
    html += `<button class="mrsf-action-btn" data-mrsf-action="reply" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Reply</button>`;
    html += `<button class="mrsf-action-btn" data-mrsf-action="edit" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Edit</button>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function renderThreadHtml(thread: CommentThread, interactive: boolean): string {
  let html = `<div class="mrsf-thread">`;
  html += renderCommentHtml(thread.comment, false, interactive);
  if (thread.replies.length > 0) {
    html += `<div class="mrsf-replies">`;
    for (const reply of thread.replies) {
      html += renderCommentHtml(reply, true, interactive);
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

/**
 * Install MRSF renderer rules on a markdown-it instance.
 */
export function installRendererRules(
  md: { renderer: { rules: Record<string, ((...args: any[]) => string) | undefined> } },
): void {
  // Badge + tooltip
  md.renderer.rules["mrsf_badge"] = (
    tokens: { meta: { line: number; threads: CommentThread[]; interactive: boolean } }[],
    idx: number,
  ): string => {
    const { line, threads, interactive } = tokens[idx].meta;

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

    const icon = allResolved ? "✓" : "💬";

    let html = `<span class="mrsf-tooltip-anchor">`;

    // Badge
    html += `<span class="mrsf-badge${resolvedClass}${severityClass}" data-mrsf-line="${line}" data-mrsf-action="navigate" data-mrsf-comment-id="${escapeHtml(threads[0].comment.id)}" tabindex="0">${icon} ${total}</span>`;

    // Tooltip
    html += `<div class="mrsf-tooltip" data-mrsf-line="${line}">`;
    for (const thread of threads) {
      html += renderThreadHtml(thread, interactive);
    }
    html += `</div>`;

    html += `</span>`;
    return html;
  };

  // Highlight open/close — simple <mark> wrapper
  md.renderer.rules["mrsf_highlight_open"] = (
    tokens: any[],
    idx: number,
  ): string => {
    const cls = tokens[idx].attrGet("class") || "mrsf-highlight";
    const commentId = tokens[idx].attrGet("data-mrsf-comment-id") || "";
    return `<mark class="${escapeHtml(cls)}" data-mrsf-comment-id="${escapeHtml(commentId)}">`;
  };

  md.renderer.rules["mrsf_highlight_close"] = (): string => {
    return `</mark>`;
  };
}

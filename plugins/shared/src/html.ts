/**
 * Shared HTML rendering helpers for MRSF rendering plugins.
 *
 * These produce the HTML strings used in tooltips, badges, and comment
 * rendering. Both the markdown-it and rehype plugins use these functions
 * to ensure identical visual output.
 */

import type { CommentThread, SlimComment } from "./types.js";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTime(iso: string | null): string {
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

export function renderCommentHtml(
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

  // Selected text quote (collapsible)
  if (comment.selected_text) {
    html += `<details class="mrsf-selected-text"><summary class="mrsf-selected-text-summary">${escapeHtml(comment.selected_text)}</summary><div class="mrsf-selected-text-full">${escapeHtml(comment.selected_text)}</div></details>`;
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
    html += `<button class="mrsf-action-btn mrsf-action-danger" data-mrsf-action="delete" data-mrsf-comment-id="${escapeHtml(comment.id)}" data-mrsf-line="${line}">Delete</button>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

export function renderThreadHtml(thread: CommentThread, interactive: boolean): string {
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

import type { Comment } from "@mrsf/cli";
import type { ReviewThread } from "../types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";

  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function renderCommentHtml(
  comment: Comment,
  isReply: boolean,
  line: number,
  interactive: boolean,
): string {
  const resolvedClass = comment.resolved ? " mrsf-resolved" : "";
  const replyClass = isReply ? " mrsf-reply" : "";
  let html = `<div class="mrsf-comment${resolvedClass}${replyClass}" data-mrsf-comment-id="${escapeHtml(comment.id)}">`;

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

  if (comment.selected_text) {
    html += `<details class="mrsf-selected-text"><summary class="mrsf-selected-text-summary">${escapeHtml(comment.selected_text)}</summary><div class="mrsf-selected-text-full">${escapeHtml(comment.selected_text)}</div></details>`;
  }

  html += `<div class="mrsf-comment-body">${escapeHtml(comment.text)}</div>`;

  if (interactive) {
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

export function renderReviewThreadHtml(thread: ReviewThread, interactive: boolean): string {
  let html = `<div class="mrsf-thread">`;
  html += renderCommentHtml(thread.rootComment, false, thread.line, interactive);

  if (thread.replies.length > 0) {
    html += `<div class="mrsf-replies">`;
    for (const reply of thread.replies) {
      html += renderCommentHtml(reply, true, thread.line, interactive);
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

export { escapeHtml };
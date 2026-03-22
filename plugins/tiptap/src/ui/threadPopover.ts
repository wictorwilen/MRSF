import type { Editor } from "@tiptap/core";
import type { Comment } from "@mrsf/cli/browser";
import {
  openTiptapMrsfConfirmDialog,
  openTiptapMrsfFormDialog,
} from "./dialogs.js";
import type {
  ReviewThread,
  TiptapMrsfCommentClickEvent,
  TiptapMrsfDialogFormResult,
  TiptapMrsfStorage,
  TiptapMrsfThreadPopoverHandlerOptions,
  TiptapMrsfThreadPopoverOptions,
} from "../types.js";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }

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

function renderCommentHtml(comment: Comment, isReply: boolean): string {
  const resolvedClass = comment.resolved ? " mrsf-resolved" : "";
  const replyClass = isReply ? " mrsf-reply" : "";
  let html = `<div class="mrsf-comment${resolvedClass}${replyClass}" data-mrsf-comment-id="${escapeHtml(comment.id)}">`;

  html += `<div class="mrsf-comment-header">`;
  html += `<span class="mrsf-author">${escapeHtml(comment.author || "Unknown")}</span>`;
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
  html += `<div class="mrsf-actions">`;
  if (comment.resolved) {
    html += `<button type="button" class="mrsf-action-btn" data-mrsf-action="unresolve" data-mrsf-comment-id="${escapeHtml(comment.id)}">Unresolve</button>`;
  } else {
    html += `<button type="button" class="mrsf-action-btn" data-mrsf-action="resolve" data-mrsf-comment-id="${escapeHtml(comment.id)}">Resolve</button>`;
  }
  html += `<button type="button" class="mrsf-action-btn" data-mrsf-action="reply" data-mrsf-comment-id="${escapeHtml(comment.id)}">Reply</button>`;
  html += `<button type="button" class="mrsf-action-btn" data-mrsf-action="edit" data-mrsf-comment-id="${escapeHtml(comment.id)}">Edit</button>`;
  html += `<button type="button" class="mrsf-action-btn mrsf-action-danger" data-mrsf-action="delete" data-mrsf-comment-id="${escapeHtml(comment.id)}">Delete</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

function renderThreadHtml(thread: ReviewThread): string {
  let html = `<div class="mrsf-thread">`;
  html += renderCommentHtml(thread.rootComment, false);
  if (thread.replies.length > 0) {
    html += `<div class="mrsf-replies">`;
    for (const reply of thread.replies) {
      html += renderCommentHtml(reply, true);
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

export function findCommentAnchorElements(editor: Editor, commentId: string): HTMLElement[] {
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>(`[data-mrsf-comment-id="${commentId}"]`));
}

export function getCommentAnchorRect(editor: Editor, commentId: string): DOMRect | null {
  const element = findCommentAnchorElements(editor, commentId)[0];
  return element?.getBoundingClientRect() ?? null;
}

export function openTiptapMrsfThreadPopover(
  editor: Editor,
  thread: ReviewThread,
  options: TiptapMrsfThreadPopoverOptions = {},
): { element: HTMLElement; close: () => void } {
  const anchorId = options.commentId ?? thread.rootComment.id;
  const anchorRect = options.anchorRect ?? getCommentAnchorRect(editor, anchorId);
  const popover = document.createElement("div");
  popover.className = `mrsf-inline-tooltip${options.interactive === false ? "" : " mrsf-interactive"}`;
  popover.innerHTML = renderThreadHtml(thread);

  const close = (): void => {
    document.removeEventListener("mousedown", handleOutsideClick, true);
    popover.remove();
    options.onClose?.();
  };

  const handleOutsideClick = (event: Event): void => {
    const target = event.target as Node | null;
    if (target && popover.contains(target)) {
      return;
    }
    close();
  };

  popover.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-mrsf-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.mrsfAction;
    const commentId = target.dataset.mrsfCommentId;
    if (!action || !commentId) {
      return;
    }

    if (action === "reply") options.onReply?.(commentId);
    if (action === "edit") options.onEdit?.(commentId);
    if (action === "resolve") options.onResolve?.(commentId);
    if (action === "unresolve") options.onUnresolve?.(commentId);
    if (action === "delete") options.onDelete?.(commentId);
  });

  popover.style.visibility = "hidden";
  document.body.appendChild(popover);

  const margin = 12;
  const preferredTop = anchorRect ? anchorRect.bottom + 8 : 24;
  const preferredLeft = anchorRect ? anchorRect.left : 24;
  const popoverRect = popover.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - popoverRect.height - margin);
  const top = Math.min(maxTop, Math.max(margin, preferredTop));
  const left = Math.min(maxLeft, Math.max(margin, preferredLeft));

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
  popover.style.visibility = "visible";
  document.addEventListener("mousedown", handleOutsideClick, true);

  return { element: popover, close };
}

function getController(editor: Editor, name = "mrsf"): TiptapMrsfStorage["controller"] {
  const storage = (editor.storage as Record<string, TiptapMrsfStorage | undefined>)[name];
  return storage?.controller ?? null;
}

async function resolveComposeResult(result: TiptapMrsfDialogFormResult | null | undefined): Promise<TiptapMrsfDialogFormResult | null> {
  if (!result) {
    return null;
  }

  const text = result.text.trim();
  if (!text) {
    return null;
  }

  return {
    ...result,
    text,
  };
}

function getDialogThemeOptions(editor: Editor, options: TiptapMrsfThreadPopoverHandlerOptions) {
  return {
    targetDocument: options.targetDocument ?? editor.view.dom.ownerDocument,
    themeSource: options.themeSource ?? (editor.view.dom as HTMLElement),
  };
}

export function createTiptapMrsfThreadPopoverHandler(
  editor: Editor,
  options: TiptapMrsfThreadPopoverHandlerOptions = {},
): (event: TiptapMrsfCommentClickEvent) => void {
  let activePopover: { element: HTMLElement; close: () => void } | null = null;

  const closeActive = (): void => {
    activePopover?.close();
    activePopover = null;
  };

  const openForComment = (commentId: string, anchorRect?: DOMRect | null): void => {
    const controller = getController(editor, options.name);
    const thread = controller?.getThreadForComment(commentId);
    if (!controller || !thread) {
      return;
    }

    closeActive();

    const reopen = (): void => {
      openForComment(commentId);
    };

    activePopover = openTiptapMrsfThreadPopover(editor, thread, {
      commentId,
      anchorRect,
      title: options.title,
      onClose: () => {
        activePopover = null;
        options.onClose?.();
      },
      onResolve: (targetCommentId) => {
        controller.resolve(targetCommentId);
        reopen();
      },
      onUnresolve: (targetCommentId) => {
        controller.unresolve(targetCommentId);
        reopen();
      },
      onReply: async (targetCommentId) => {
        const targetComment = controller.getCommentById(targetCommentId);
        if (!targetComment) {
          return;
        }

        const composeResult = await resolveComposeResult(
          options.composeReply
            ? await options.composeReply(targetComment, thread)
            : await openTiptapMrsfFormDialog({
              ...getDialogThemeOptions(editor, options),
              action: "reply",
              initialSeverity: targetComment.severity ?? null,
              initialType: targetComment.type ?? null,
              title: `Reply to ${targetComment.author || "comment"}`,
            }),
        );
        if (!composeResult) {
          return;
        }

        await controller.replyToComment(targetCommentId, composeResult.text, {
          severity: composeResult.severity ?? undefined,
          type: composeResult.type ?? undefined,
        });
        reopen();
      },
      onEdit: async (targetCommentId) => {
        const targetComment = controller.getCommentById(targetCommentId);
        if (!targetComment) {
          return;
        }

        const composeResult = await resolveComposeResult(
          options.composeEdit
            ? await options.composeEdit(targetComment, thread)
            : await openTiptapMrsfFormDialog({
              ...getDialogThemeOptions(editor, options),
              action: "edit",
              initialSeverity: targetComment.severity ?? null,
              initialText: targetComment.text,
              initialType: targetComment.type ?? null,
              title: "Edit comment",
            }),
        );
        if (!composeResult) {
          return;
        }

        controller.editComment(targetCommentId, composeResult.text, {
          severity: composeResult.severity ?? undefined,
          type: composeResult.type ?? undefined,
        });
        reopen();
      },
      onDelete: async (targetCommentId) => {
        const targetComment = controller.getCommentById(targetCommentId);
        if (!targetComment) {
          return;
        }

        const confirmed = await (options.confirmDelete?.(targetComment, thread) ?? openTiptapMrsfConfirmDialog({
          ...getDialogThemeOptions(editor, options),
          confirmLabel: "Delete",
          message: `Delete comment by ${targetComment.author || "unknown"}?`,
          title: "Delete comment",
        }));
        if (!confirmed) {
          return;
        }

        controller.deleteComment(targetCommentId);
        closeActive();
        if (controller.getThreadForComment(commentId)) {
          reopen();
        }
      },
    });

    options.onOpen?.(thread);
  };

  return (event: TiptapMrsfCommentClickEvent): void => {
    openForComment(event.commentId, event.anchorRect);
  };
}
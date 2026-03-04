/**
 * Sidemark — Client-side event controller for interactive mode.
 *
 * Optional module that listens for clicks on `[data-mrsf-action]` elements
 * and dispatches CustomEvents on the document for host applications.
 *
 * Usage (ESM):
 *   import "@mrsf/plugin-shared/controller";
 *
 * Events dispatched:
 *   - mrsf:resolve   { commentId, line }
 *   - mrsf:unresolve { commentId, line }
 *   - mrsf:reply     { commentId, line }
 *   - mrsf:edit      { commentId, line }
 *   - mrsf:navigate  { commentId, line }
 */

export type MrsfAction = "resolve" | "unresolve" | "reply" | "edit" | "navigate";

export interface MrsfActionDetail {
  commentId: string;
  line: number | null;
  action: MrsfAction;
}

function init(): void {
  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-mrsf-action]",
    );
    if (!target) return;

    const action = target.dataset.mrsfAction as MrsfAction | undefined;
    const commentId = target.dataset.mrsfCommentId;
    if (!action || !commentId) return;

    const lineStr = target.dataset.mrsfLine;
    const line = lineStr ? parseInt(lineStr, 10) : null;

    e.preventDefault();
    e.stopPropagation();

    const detail: MrsfActionDetail = { commentId, line, action };
    document.dispatchEvent(
      new CustomEvent(`mrsf:${action}`, { detail, bubbles: true }),
    );
  });
}

// Auto-initialize
init();

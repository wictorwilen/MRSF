/**
 * Sidemark — Client-side event controller for interactive mode.
 *
 * Optional module that listens for clicks on `[data-mrsf-action]` elements
 * and dispatches CustomEvents on the document for host applications.
 *
 * Usage (ESM):
 *   import "@mrsf/plugin-shared/controller";
 *
 * Events dispatched (host listens on document):
 *   - mrsf:resolve   { commentId, line, ... }
 *   - mrsf:unresolve { commentId, line, ... }
 *   - mrsf:reply     { commentId, line, ... }
 *   - mrsf:edit      { commentId, line, ... }
 *   - mrsf:delete    { commentId, line, ... }
 *   - mrsf:navigate  { commentId, line, ... }
 *   - mrsf:add       { commentId: null, line, selectionText?, ... }
 *   - mrsf:submit    { action, commentId, text?, line?, end_line?, start_column?, end_column?, selection_text? }
 *
 * For actions that open built-in UI (add/edit/reply/resolve/unresolve/delete), the
 * mrsf:<action> event is fired with the same payload as mrsf:submit after the user confirms.
 */

export type MrsfAction = "resolve" | "unresolve" | "reply" | "edit" | "delete" | "navigate" | "add";

export interface MrsfActionDetail {
  commentId: string | null;
  line: number | null;
  action: MrsfAction;
  selectionText?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
}

export interface MrsfSubmitDetail {
  action: "add" | "edit" | "reply" | "resolve" | "unresolve" | "delete";
  commentId: string | null;
  text: string;
  type?: string | null;
  severity?: "low" | "medium" | "high" | null;
  line?: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
  selection_text?: string | null;
}

let floatingAddButton: HTMLButtonElement | null = null;
let lastSelectionText: string | null = null;
let overlayEl: HTMLDivElement | null = null;
let styleInjected = false;

function injectStyles(): void {
  if (styleInjected) return;
  const css = `
.mrsf-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 2000; display: flex; align-items: center; justify-content: center; }
.mrsf-dialog { background: var(--mrsf-dialog-bg, var(--vp-c-bg, #1e1e1e)); color: var(--mrsf-dialog-fg, var(--vp-c-text-1, #f3f3f3)); border: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #444)); border-radius: 8px; width: min(520px, 90vw); box-shadow: 0 10px 40px rgba(0,0,0,0.35); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.mrsf-dialog header { padding: 12px 16px; font-weight: 600; border-bottom: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #333)); }
.mrsf-dialog form { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.mrsf-field { display: flex; flex-direction: column; gap: 6px; }
.mrsf-field label { font-size: 13px; color: var(--mrsf-dialog-muted, var(--vp-c-text-2, #ccc)); }
.mrsf-field input, .mrsf-field select, .mrsf-field textarea { background: var(--mrsf-field-bg, var(--vp-c-bg-soft, #252526)); color: var(--mrsf-dialog-fg, var(--vp-c-text-1, #f3f3f3)); border: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #3c3c3c)); border-radius: 4px; padding: 6px 8px; font-size: 13px; }
.mrsf-field textarea { min-height: 100px; resize: vertical; }
.mrsf-actions-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 0; padding: 12px 16px 16px; border-top: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #333)); }
.mrsf-btn { padding: 6px 12px; border-radius: 4px; border: 1px solid var(--mrsf-dialog-border, var(--vp-c-divider, #3c3c3c)); background: var(--mrsf-button-bg, var(--vp-c-bg-soft, #2d2d30)); color: var(--mrsf-dialog-fg, var(--vp-c-text-1, #f3f3f3)); cursor: pointer; }
.mrsf-btn-primary { background: var(--mrsf-button-primary-bg, #0e639c); border-color: var(--mrsf-button-primary-bg, #0e639c); color: #fff; }
.mrsf-helper { font-size: 12px; color: var(--mrsf-dialog-muted, var(--vp-c-text-2, #aaa)); }
`; 
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  styleInjected = true;
}

function ensureFloatingAddButton(): HTMLButtonElement {
  if (floatingAddButton) return floatingAddButton;
  const btn = document.createElement("button");
  btn.textContent = "Add comment";
  btn.className = "mrsf-add-inline-button";
  btn.dataset.mrsfAction = "add";
  btn.style.display = "none";
  btn.style.position = "absolute";
  btn.style.zIndex = "1200";
  document.body.appendChild(btn);
  floatingAddButton = btn;
  return btn;
}

function hideFloatingAddButton(): void {
  if (!floatingAddButton) return;
  floatingAddButton.style.display = "none";
  floatingAddButton.dataset.mrsfLine = "";
  floatingAddButton.dataset.mrsfStartLine = "";
  floatingAddButton.dataset.mrsfEndLine = "";
  lastSelectionText = null;
}

function showFloatingAddButton(
  startLine: number | null,
  endLine: number | null,
  startColumn: number | null,
  endColumn: number | null,
  rect: DOMRect,
  selectionText: string,
): void {
  const btn = ensureFloatingAddButton();
  if (startLine != null) {
    btn.dataset.mrsfLine = String(startLine);
    btn.dataset.mrsfStartLine = String(startLine);
    btn.dataset.mrsfEndLine = String(endLine ?? startLine);
  } else {
    delete btn.dataset.mrsfLine;
    delete btn.dataset.mrsfStartLine;
    delete btn.dataset.mrsfEndLine;
  }
  if (startColumn != null) {
    btn.dataset.mrsfStartColumn = String(startColumn);
  } else {
    delete btn.dataset.mrsfStartColumn;
  }
  if (endColumn != null) {
    btn.dataset.mrsfEndColumn = String(endColumn);
  } else {
    delete btn.dataset.mrsfEndColumn;
  }
  lastSelectionText = selectionText;

  const margin = 6;
  btn.style.visibility = "hidden";
  btn.style.display = "block";
  const height = btn.offsetHeight || 0;
  const top = window.scrollY + rect.top - height - margin;
  const left = window.scrollX + rect.left;
  btn.style.top = `${Math.max(0, top)}px`;
  btn.style.left = `${Math.max(0, left)}px`;
  btn.style.visibility = "visible";
}

function handleSelectionChange(): void {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    hideFloatingAddButton();
    return;
  }

  const text = sel.toString().trim();
  if (!text) {
    hideFloatingAddButton();
    return;
  }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideFloatingAddButton();
    return;
  }

  const startAnchor = (range.startContainer as Node).parentElement?.closest<HTMLElement>(
    '[data-mrsf-line]',
  );
  const endAnchor = (range.endContainer as Node).parentElement?.closest<HTMLElement>(
    '[data-mrsf-line]',
  );
  const startLineStr = startAnchor?.dataset.mrsfLine;
  const endLineStr = endAnchor?.dataset.mrsfLine ?? startLineStr;
  const startLine = startLineStr ? parseInt(startLineStr, 10) : null;
  const endLine = endLineStr ? parseInt(endLineStr, 10) : startLine;

  const startColumn = startAnchor?.dataset.mrsfStartColumn
    ? parseInt(startAnchor.dataset.mrsfStartColumn, 10)
    : range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startOffset
      : null;
  const endColumn = endAnchor?.dataset.mrsfEndColumn
    ? parseInt(endAnchor.dataset.mrsfEndColumn, 10)
    : range.endContainer.nodeType === Node.TEXT_NODE
      ? range.endOffset
      : null;

  showFloatingAddButton(startLine, endLine, startColumn, endColumn, rect, text);
}

function closeOverlay(): void {
  if (overlayEl && overlayEl.parentElement) {
    overlayEl.parentElement.removeChild(overlayEl);
  }
  overlayEl = null;
}

function openForm(action: "add" | "edit" | "reply", detail: MrsfActionDetail): void {
  if ((window as any).mrsfDisableBuiltinUi) return;
  injectStyles();
  closeOverlay();

  const selText = detail.selectionText ?? "";
  const line = detail.line ?? detail.start_line ?? null;
  const endLine = detail.end_line ?? detail.line ?? null;
  const startCol = detail.start_column ?? null;
  const endCol = detail.end_column ?? null;

  const overlay = document.createElement("div");
  overlay.className = "mrsf-overlay";

  const dialog = document.createElement("div");
  dialog.className = "mrsf-dialog";

  const header = document.createElement("header");
  header.textContent =
    action === "add" ? "Add comment" : action === "edit" ? "Edit comment" : "Reply";
  dialog.appendChild(header);

  const form = document.createElement("form");

  const field = (labelText: string, inputEl: HTMLElement, helper?: string) => {
    const wrap = document.createElement("div");
    wrap.className = "mrsf-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    if (helper) {
      const h = document.createElement("div");
      h.className = "mrsf-helper";
      h.textContent = helper;
      wrap.appendChild(h);
    }
    form.appendChild(wrap);
  };

  const textArea = document.createElement("textarea");
  textArea.name = "text";
  textArea.required = true;
  field("Comment text", textArea);

  const typeSelect = document.createElement("select");
  typeSelect.name = "type";
  ["", "suggestion", "issue", "question", "accuracy", "style", "clarity"].forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t || "(none)";
    typeSelect.appendChild(opt);
  });
  field("Type", typeSelect, "Optional");

  const severitySelect = document.createElement("select");
  severitySelect.name = "severity";
  ["", "low", "medium", "high"].forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s || "(none)";
    severitySelect.appendChild(opt);
  });
  field("Severity", severitySelect, "Optional");

  if (selText) {
    const pre = document.createElement("pre");
    pre.textContent = selText;
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    field("Selected text", pre as unknown as HTMLElement, "Captured automatically");
  }

  const actions = document.createElement("div");
  actions.className = "mrsf-actions-row";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "mrsf-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => closeOverlay());
  actions.appendChild(cancelBtn);

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "mrsf-btn mrsf-btn-primary";
  submitBtn.textContent = action === "add" ? "Add" : action === "reply" ? "Reply" : "Save";
  actions.appendChild(submitBtn);

  form.appendChild(actions);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const detailOut: MrsfSubmitDetail = {
      action,
      commentId: detail.commentId,
      text: textArea.value.trim(),
      type: typeSelect.value || null,
      severity: (severitySelect.value as MrsfSubmitDetail["severity"]) || null,
      line,
      end_line: endLine,
      start_column: startCol,
      end_column: endCol,
      selection_text: selText || null,
    };
    document.dispatchEvent(new CustomEvent("mrsf:submit", { detail: detailOut, bubbles: true }));
    closeOverlay();
  });

  dialog.appendChild(form);
  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });

  document.body.appendChild(overlay);
  overlayEl = overlay;
}

function openConfirm(action: "resolve" | "unresolve" | "delete", detail: MrsfActionDetail): void {
  if ((window as any).mrsfDisableBuiltinUi) return;
  injectStyles();
  closeOverlay();

  const overlay = document.createElement("div");
  overlay.className = "mrsf-overlay";

  const dialog = document.createElement("div");
  dialog.className = "mrsf-dialog";

  const header = document.createElement("header");
  header.textContent = action === "delete" ? "Delete comment" : "Change status";
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.style.padding = "16px";
  body.textContent =
    action === "delete"
      ? "Delete this comment?"
      : action === "resolve"
        ? "Mark this comment as resolved?"
        : "Mark this comment as unresolved?";
  dialog.appendChild(body);

  const actions = document.createElement("div");
  actions.className = "mrsf-actions-row";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "mrsf-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => closeOverlay());
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "mrsf-btn mrsf-btn-primary";
  confirmBtn.textContent = action === "delete" ? "Delete" : "Confirm";
  confirmBtn.addEventListener("click", () => {
    const detailOut: MrsfSubmitDetail = {
      action,
      commentId: detail.commentId,
      text: "",
      type: null,
      severity: null,
      line: detail.line,
      end_line: detail.end_line ?? detail.line ?? null,
      start_column: detail.start_column ?? null,
      end_column: detail.end_column ?? null,
      selection_text: detail.selectionText ?? null,
    };
    document.dispatchEvent(new CustomEvent("mrsf:submit", { detail: detailOut, bubbles: true }));
    closeOverlay();
  });
  actions.appendChild(confirmBtn);

  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });

  document.body.appendChild(overlay);
  overlayEl = overlay;
}

function init(): void {
  const globalAny = window as any;
  if (globalAny.__mrsfControllerReady) return;
  globalAny.__mrsfControllerReady = true;

  document.addEventListener("selectionchange", handleSelectionChange);

  document.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-mrsf-action]",
    );
    if (!target) return;

    const action = target.dataset.mrsfAction as MrsfAction | undefined;
    const commentId = target.dataset.mrsfCommentId ?? null;
    if (!action) return;

    const lineStr = target.dataset.mrsfLine;
    const line = lineStr ? parseInt(lineStr, 10) : null;

    const selectionText = target.dataset.mrsfSelection ?? lastSelectionText ?? null;

    const startLineStr = target.dataset.mrsfStartLine;
    const endLineStr = target.dataset.mrsfEndLine;
    const startColStr = target.dataset.mrsfStartColumn;
    const endColStr = target.dataset.mrsfEndColumn;
    const startLine = startLineStr ? parseInt(startLineStr, 10) : (line ?? null);
    const endLine = endLineStr ? parseInt(endLineStr, 10) : (line ?? null);
    const startColumn = startColStr ? parseInt(startColStr, 10) : null;
    const endColumn = endColStr ? parseInt(endColStr, 10) : null;

    e.preventDefault();
    e.stopPropagation();

    const detail: MrsfActionDetail = {
      commentId,
      line,
      action,
      selectionText,
      start_line: startLine,
      end_line: endLine,
      start_column: startColumn,
      end_column: endColumn,
    };
    if (action === "add" || action === "edit" || action === "reply") {
      if (action === "add") {
        hideFloatingAddButton();
      }
      openForm(action, detail);
      return;
    }

    if (action === "resolve" || action === "unresolve" || action === "delete") {
      openConfirm(action, detail);
      return;
    }

    document.dispatchEvent(
      new CustomEvent(`mrsf:${action}`, { detail, bubbles: true }),
    );
  });
}

// Auto-initialize
init();

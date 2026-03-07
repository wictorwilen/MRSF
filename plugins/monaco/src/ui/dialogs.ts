import type { Comment } from "@mrsf/cli";

export interface MrsfDialogFormResult {
  text: string;
  type: Comment["type"] | null;
  severity: Comment["severity"] | null;
}

export interface MrsfDialogThemeOptions {
  targetDocument?: Document;
  themeSource?: HTMLElement | null;
}

export interface MrsfFormDialogOptions extends MrsfDialogThemeOptions {
  action: "add" | "reply" | "edit";
  title?: string;
  initialText?: string;
  initialType?: Comment["type"] | null;
  initialSeverity?: Comment["severity"] | null;
  selectionText?: string | null;
}

export interface MrsfConfirmDialogOptions extends MrsfDialogThemeOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

let stylesInjected = false;

function injectStyles(targetDocument: Document): void {
  if (stylesInjected || targetDocument.getElementById("mrsf-monaco-dialog-styles")) {
    stylesInjected = true;
    return;
  }

  const style = targetDocument.createElement("style");
  style.id = "mrsf-monaco-dialog-styles";
  style.textContent = `
.mrsf-overlay { position: fixed; inset: 0; background: var(--mrsf-dialog-backdrop, rgba(15, 23, 42, 0.28)); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 12px; }
.mrsf-dialog { background: var(--mrsf-dialog-bg, var(--mrsf-tooltip-bg, #0f172a)); color: var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)); border: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); border-radius: 10px; width: min(420px, calc(100vw - 24px)); box-shadow: 0 18px 48px rgba(15, 23, 42, 0.24); font-family: var(--mrsf-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif); font-size: 13px; overflow: hidden; }
.mrsf-dialog header { padding: 10px 12px; font-weight: 600; line-height: 1.35; border-bottom: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); }
.mrsf-dialog form { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.mrsf-dialog-body { padding: 12px; line-height: 1.45; }
.mrsf-field { display: flex; flex-direction: column; gap: 4px; }
.mrsf-field label { font-size: 12px; color: var(--mrsf-dialog-muted, color-mix(in srgb, var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)) 72%, transparent)); }
.mrsf-field input, .mrsf-field select, .mrsf-field textarea, .mrsf-field pre { background: var(--mrsf-field-bg, color-mix(in srgb, var(--mrsf-dialog-bg, var(--mrsf-tooltip-bg, #0f172a)) 88%, white)); color: var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)); border: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); border-radius: 6px; padding: 7px 9px; font-size: 12px; line-height: 1.45; }
.mrsf-field textarea { min-height: 76px; resize: vertical; }
.mrsf-field select { min-height: 34px; }
.mrsf-field pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.mrsf-field input:focus, .mrsf-field select:focus, .mrsf-field textarea:focus { outline: 2px solid color-mix(in srgb, var(--mrsf-accent, #2563eb) 38%, transparent); outline-offset: 1px; }
.mrsf-actions-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 0; padding: 10px 12px 12px; border-top: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); }
.mrsf-btn { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--mrsf-dialog-border, var(--mrsf-tooltip-border, rgba(148, 163, 184, 0.35))); background: var(--mrsf-button-bg, color-mix(in srgb, var(--mrsf-dialog-bg, var(--mrsf-tooltip-bg, #0f172a)) 82%, white)); color: var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)); cursor: pointer; font: inherit; line-height: 1.2; }
.mrsf-btn-primary { background: var(--mrsf-button-primary-bg, var(--mrsf-accent, #2563eb)); border-color: var(--mrsf-button-primary-bg, var(--mrsf-accent, #2563eb)); color: #fff; }
.mrsf-helper { font-size: 11px; color: var(--mrsf-dialog-muted, color-mix(in srgb, var(--mrsf-dialog-fg, var(--mrsf-tooltip-fg, #e5eefb)) 72%, transparent)); }
`;

  targetDocument.head.appendChild(style);
  stylesInjected = true;
}

function resolveDocument(options: MrsfDialogThemeOptions): Document | null {
  if (options.targetDocument) return options.targetDocument;
  if (typeof document !== "undefined") return document;
  return null;
}

function applyThemeVariables(overlay: HTMLElement, themeSource?: HTMLElement | null): void {
  if (!themeSource || typeof getComputedStyle === "undefined") return;

  const computed = getComputedStyle(themeSource);
  for (const name of computed) {
    if (name.startsWith("--mrsf-")) {
      overlay.style.setProperty(name, computed.getPropertyValue(name));
    }
  }
}

function createButton(targetDocument: Document, label: string, className: string, type: "button" | "submit"): HTMLButtonElement {
  const button = targetDocument.createElement("button");
  button.type = type;
  button.className = className;
  button.textContent = label;
  return button;
}

export async function openMrsfFormDialog(
  options: MrsfFormDialogOptions,
): Promise<MrsfDialogFormResult | null> {
  const targetDocument = resolveDocument(options);
  if (!targetDocument) return null;

  injectStyles(targetDocument);

  return new Promise((resolve) => {
    const overlay = targetDocument.createElement("div");
    overlay.className = "mrsf-overlay";
    applyThemeVariables(overlay, options.themeSource ?? null);

    const dialog = targetDocument.createElement("div");
    dialog.className = "mrsf-dialog";

    const header = targetDocument.createElement("header");
    header.textContent = options.title ?? (
      options.action === "add" ? "Add comment" : options.action === "reply" ? "Reply" : "Edit comment"
    );
    dialog.appendChild(header);

    const form = targetDocument.createElement("form");

    const field = (labelText: string, inputEl: HTMLElement, helper?: string) => {
      const wrap = targetDocument.createElement("div");
      wrap.className = "mrsf-field";

      const label = targetDocument.createElement("label");
      label.textContent = labelText;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);

      if (helper) {
        const helperEl = targetDocument.createElement("div");
        helperEl.className = "mrsf-helper";
        helperEl.textContent = helper;
        wrap.appendChild(helperEl);
      }

      form.appendChild(wrap);
    };

    const textArea = targetDocument.createElement("textarea");
    textArea.name = "text";
    textArea.required = true;
    textArea.value = options.initialText ?? "";
    field("Comment text", textArea);

    const typeSelect = targetDocument.createElement("select");
    typeSelect.name = "type";
    ["", "suggestion", "issue", "question", "accuracy", "style", "clarity", "note"].forEach((value) => {
      const option = targetDocument.createElement("option");
      option.value = value;
      option.textContent = value || "(none)";
      typeSelect.appendChild(option);
    });
    typeSelect.value = options.initialType ?? "";
    field("Type", typeSelect, "Optional");

    const severitySelect = targetDocument.createElement("select");
    severitySelect.name = "severity";
    ["", "low", "medium", "high"].forEach((value) => {
      const option = targetDocument.createElement("option");
      option.value = value;
      option.textContent = value || "(none)";
      severitySelect.appendChild(option);
    });
    severitySelect.value = options.initialSeverity ?? "";
    field("Severity", severitySelect, "Optional");

    if (options.selectionText) {
      const pre = targetDocument.createElement("pre");
      pre.textContent = options.selectionText;
      field("Selected text", pre, "Captured automatically");
    }

    const actions = targetDocument.createElement("div");
    actions.className = "mrsf-actions-row";

    const cancelButton = createButton(targetDocument, "Cancel", "mrsf-btn", "button");
    cancelButton.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    actions.appendChild(cancelButton);

    const confirmLabel = options.action === "add" ? "Add" : options.action === "reply" ? "Reply" : "Save";
    actions.appendChild(createButton(targetDocument, confirmLabel, "mrsf-btn mrsf-btn-primary", "submit"));
    form.appendChild(actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      overlay.remove();
      resolve({
        text: textArea.value.trim(),
        type: (typeSelect.value || null) as MrsfDialogFormResult["type"],
        severity: (severitySelect.value || null) as MrsfDialogFormResult["severity"],
      });
    });

    dialog.appendChild(form);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    targetDocument.body.appendChild(overlay);
    textArea.focus();
  });
}

export async function openMrsfConfirmDialog(
  options: MrsfConfirmDialogOptions,
): Promise<boolean> {
  const targetDocument = resolveDocument(options);
  if (!targetDocument) return false;

  injectStyles(targetDocument);

  return new Promise((resolve) => {
    const overlay = targetDocument.createElement("div");
    overlay.className = "mrsf-overlay";
    applyThemeVariables(overlay, options.themeSource ?? null);

    const dialog = targetDocument.createElement("div");
    dialog.className = "mrsf-dialog";

    const header = targetDocument.createElement("header");
    header.textContent = options.title;
    dialog.appendChild(header);

    const body = targetDocument.createElement("div");
    body.className = "mrsf-dialog-body";
    body.textContent = options.message;
    dialog.appendChild(body);

    const actions = targetDocument.createElement("div");
    actions.className = "mrsf-actions-row";

    const cancelButton = createButton(targetDocument, "Cancel", "mrsf-btn", "button");
    cancelButton.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
    actions.appendChild(cancelButton);

    const confirmButton = createButton(targetDocument, options.confirmLabel, "mrsf-btn mrsf-btn-primary", "button");
    confirmButton.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    actions.appendChild(confirmButton);

    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });

    targetDocument.body.appendChild(overlay);
  });
}
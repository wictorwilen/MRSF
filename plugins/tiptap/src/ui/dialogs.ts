import type {
  TiptapMrsfConfirmDialogOptions,
  TiptapMrsfDialogFormResult,
  TiptapMrsfDialogThemeOptions,
  TiptapMrsfFormDialogOptions,
} from "../types.js";

function resolveDocument(options: TiptapMrsfDialogThemeOptions): Document | null {
  if (options.targetDocument) {
    return options.targetDocument;
  }

  if (typeof document !== "undefined") {
    return document;
  }

  return null;
}

function createButton(targetDocument: Document, label: string, className: string, type: "button" | "submit"): HTMLButtonElement {
  const button = targetDocument.createElement("button");
  button.type = type;
  button.className = className;
  button.textContent = label;
  return button;
}

function bindDismiss(targetDocument: Document, overlay: HTMLDivElement, close: (value: boolean) => void): void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    close(false);
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close(false);
    }
  });

  targetDocument.addEventListener("keydown", handleKeyDown, true);
  overlay.addEventListener("mrsf:cleanup", () => {
    targetDocument.removeEventListener("keydown", handleKeyDown, true);
  }, { once: true });
}

export async function openTiptapMrsfFormDialog(options: TiptapMrsfFormDialogOptions): Promise<TiptapMrsfDialogFormResult | null> {
  const targetDocument = resolveDocument(options);
  if (!targetDocument) {
    return null;
  }

  return new Promise((resolve) => {
    const overlay = targetDocument.createElement("div");
    overlay.className = "mrsf-overlay";

    let settled = false;
    const close = (accepted: boolean, result: TiptapMrsfDialogFormResult | null = null): void => {
      if (settled) {
        return;
      }

      settled = true;
      overlay.dispatchEvent(new Event("mrsf:cleanup"));
      overlay.remove();
      resolve(accepted ? result : null);
    };

    bindDismiss(targetDocument, overlay, close);

    const dialog = targetDocument.createElement("div");
    dialog.className = "mrsf-dialog";

    const header = targetDocument.createElement("header");
    header.textContent = options.title ?? (options.action === "add" ? "Add comment" : options.action === "reply" ? "Reply" : "Edit comment");
    dialog.appendChild(header);

    const form = targetDocument.createElement("form");

    const field = (labelText: string, inputElement: HTMLElement, helper?: string) => {
      const wrapper = targetDocument.createElement("div");
      wrapper.className = "mrsf-field";

      const label = targetDocument.createElement("label");
      label.textContent = labelText;
      wrapper.appendChild(label);
      wrapper.appendChild(inputElement);

      if (helper) {
        const helperElement = targetDocument.createElement("div");
        helperElement.className = "mrsf-helper";
        helperElement.textContent = helper;
        wrapper.appendChild(helperElement);
      }

      form.appendChild(wrapper);
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
      const selectedTextPreview = targetDocument.createElement("pre");
      selectedTextPreview.textContent = options.selectionText;
      field("Selected text", selectedTextPreview, "Captured automatically");
    }

    const actions = targetDocument.createElement("div");
    actions.className = "mrsf-actions-row";

    const cancelButton = createButton(targetDocument, "Cancel", "mrsf-btn", "button");
    cancelButton.addEventListener("click", () => {
      close(false);
    });
    actions.appendChild(cancelButton);

    const confirmLabel = options.action === "add" ? "Add" : options.action === "reply" ? "Reply" : "Save";
    actions.appendChild(createButton(targetDocument, confirmLabel, "mrsf-btn mrsf-btn-primary", "submit"));
    form.appendChild(actions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = textArea.value.trim();
      if (!text) {
        textArea.focus();
        return;
      }

      close(true, {
        text,
        type: (typeSelect.value || null) as TiptapMrsfDialogFormResult["type"],
        severity: (severitySelect.value || null) as TiptapMrsfDialogFormResult["severity"],
      });
    });

    dialog.appendChild(form);
    overlay.appendChild(dialog);
    targetDocument.body.appendChild(overlay);
    textArea.focus();
  });
}

export async function openTiptapMrsfConfirmDialog(options: TiptapMrsfConfirmDialogOptions): Promise<boolean> {
  const targetDocument = resolveDocument(options);
  if (!targetDocument) {
    return false;
  }

  return new Promise((resolve) => {
    const overlay = targetDocument.createElement("div");
    overlay.className = "mrsf-overlay";

    let settled = false;
    const close = (accepted: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      overlay.dispatchEvent(new Event("mrsf:cleanup"));
      overlay.remove();
      resolve(accepted);
    };

    bindDismiss(targetDocument, overlay, close);

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
      close(false);
    });
    actions.appendChild(cancelButton);

    const confirmButton = createButton(targetDocument, options.confirmLabel, "mrsf-btn mrsf-btn-primary", "button");
    confirmButton.addEventListener("click", () => {
      close(true);
    });
    actions.appendChild(confirmButton);

    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    targetDocument.body.appendChild(overlay);
  });
}
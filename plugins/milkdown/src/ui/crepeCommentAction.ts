import type { EditorView } from "@milkdown/prose/view";
import type { MilkdownMrsfController } from "../MilkdownMrsfController.js";
import type { MilkdownMrsfControllerOptions } from "../types.js";
import { getSelectedText, selectionToEditorSelection } from "../core/textModel.js";
import { openMilkdownMrsfFormDialog } from "./dialogs.js";

export const commentIcon = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
>
  <path
    fill="currentColor"
    d="M4 5.5C4 4.12 5.12 3 6.5 3h11C18.88 3 20 4.12 20 5.5v8C20 14.88 18.88 16 17.5 16H9.41L5.7 19.71c-.63.63-1.7.18-1.7-.71zm2.5-1c-.55 0-1 .45-1 1v9.09L8.79 14h8.71c.55 0 1-.45 1-1v-8c0-.55-.45-1-1-1z"
  />
</svg>
`;

interface CrepeToolbarCtxLike {
  get<T, N extends string = string>(sliceType: unknown | N): T;
}

interface CrepeToolbarBuilderLike {
  addGroup(key: string, label: string): {
    addItem(
      key: string,
      item: {
        icon: string;
        active: (ctx: CrepeToolbarCtxLike) => boolean;
        onRun: (ctx: CrepeToolbarCtxLike) => void;
      },
    ): unknown;
  };
}

export function addCrepeMrsfToolbarItem(
  builder: CrepeToolbarBuilderLike,
  onRun: (ctx: CrepeToolbarCtxLike) => void,
): void {
  builder.addGroup("mrsf", "Review").addItem("add-comment", {
    icon: commentIcon,
    active: () => false,
    onRun: (ctx) => {
      onRun(ctx);
    },
  });
}

export async function runCrepeAddComment(
  view: EditorView,
  controller: MilkdownMrsfController | null,
  options: Pick<MilkdownMrsfControllerOptions, "composeAdd" | "onCommentSelect">,
): Promise<void> {
  if (!controller) {
    return;
  }

  const sourceText = controller.getState()?.sourceText;
  const selection = selectionToEditorSelection(view.state.selection, view.state.doc, { sourceText });
  const selectedText = getSelectedText(view.state as Parameters<typeof getSelectedText>[0]);
  const draft = await Promise.resolve(
    options.composeAdd?.({ selection, selectedText })
      ?? openMilkdownMrsfFormDialog({
        action: "add",
        selectionText: selectedText || null,
        targetDocument: view.dom.ownerDocument,
        themeSource: view.dom,
      }),
  );

  if (!draft?.text?.trim()) {
    return;
  }

  const comment = await controller.addCommentFromSelection(
    selection,
    draft.text.trim(),
    selectedText || undefined,
    {
      severity: draft.severity ?? undefined,
      type: draft.type ?? undefined,
    },
  );
  options.onCommentSelect?.(comment.id);
}
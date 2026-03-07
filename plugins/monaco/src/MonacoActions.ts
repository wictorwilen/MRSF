import type * as monaco from "monaco-editor";
import type { CommentDraft, MonacoActionHandlers } from "./types.js";
import { selectionToAnchor } from "./core/positions.js";
import type { MonacoMrsfPlugin } from "./MonacoMrsfPlugin.js";
import { openMrsfFormDialog } from "./ui/dialogs.js";

export interface MonacoActionRegistrationOptions {
  handlers?: MonacoActionHandlers;
  autoSaveAfterReanchor?: boolean;
}

async function createBuiltinCommentDraft(
  editor: monaco.editor.IStandaloneCodeEditor,
): Promise<Partial<CommentDraft> | null> {
  const selection = editor.getSelection();
  const selectionText = selection && !selection.isEmpty()
    ? editor.getModel()?.getValueInRange(selection)
    : undefined;

  const result = await openMrsfFormDialog({
    action: "add",
    selectionText: selectionText ?? null,
    targetDocument: editor.getContainerDomNode?.().ownerDocument,
    themeSource: editor.getContainerDomNode?.() ?? null,
  });

  if (!result?.text) return null;
  return {
    text: result.text,
    selected_text: selectionText,
    severity: result.severity ?? undefined,
    type: result.type ?? undefined,
  };
}

async function createBuiltinReplyDraft(
  editor: monaco.editor.IStandaloneCodeEditor,
): Promise<Partial<Omit<CommentDraft, "line">> | null> {
  const result = await openMrsfFormDialog({
    action: "reply",
    targetDocument: editor.getContainerDomNode?.().ownerDocument,
    themeSource: editor.getContainerDomNode?.() ?? null,
  });

  if (!result?.text) return null;
  return {
    text: result.text,
    severity: result.severity ?? undefined,
    type: result.type ?? undefined,
  };
}

export function registerMonacoActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  plugin: MonacoMrsfPlugin,
  options: MonacoActionRegistrationOptions = {},
): monaco.IDisposable[] {
  const addAction = editor.addAction({
    id: "mrsf.addComment",
    label: "MRSF: Add Comment",
    contextMenuGroupId: "navigation",
    precondition: "editorHasSelection",
    run: async () => {
      const context = plugin.getActionContext();
      if (!context) return;

      const partialDraft = options.handlers?.createCommentDraft
        ? await options.handlers.createCommentDraft(context)
        : await createBuiltinCommentDraft(editor);
      if (!partialDraft?.text) return;

      const anchor = context.selection
        ? selectionToAnchor(context.selection)
        : { line: context.line };

      const draft: CommentDraft = {
        ...anchor,
        text: partialDraft.text,
        author: partialDraft.author,
        selected_text: partialDraft.selected_text,
        severity: partialDraft.severity,
        type: partialDraft.type,
      };

      await plugin.addComment(draft);
    },
  });

  const replyAction = editor.addAction({
    id: "mrsf.replyToComment",
    label: "MRSF: Reply To Comment",
    contextMenuGroupId: "navigation",
    run: async () => {
      const context = plugin.getActionContext();
      if (!context?.thread) return;

      const partialDraft = options.handlers?.createReplyDraft
        ? await options.handlers.createReplyDraft(context)
        : await createBuiltinReplyDraft(editor);
      if (!partialDraft?.text) return;

      await plugin.reply(context.thread.rootComment.id, {
        text: partialDraft.text,
        author: partialDraft.author,
        selected_text: partialDraft.selected_text,
        severity: partialDraft.severity,
        type: partialDraft.type,
        end_line: partialDraft.end_line,
        start_column: partialDraft.start_column,
        end_column: partialDraft.end_column,
      });
    },
  });

  const toggleResolveAction = editor.addAction({
    id: "mrsf.toggleResolveComment",
    label: "MRSF: Toggle Resolve Comment",
    contextMenuGroupId: "navigation",
    run: async () => {
      const context = plugin.getActionContext();
      const root = context?.thread?.rootComment;
      if (!root) return;
      if (root.resolved) {
        plugin.unresolve(root.id);
      } else {
        plugin.resolve(root.id);
      }
    },
  });

  const reanchorAction = editor.addAction({
    id: "mrsf.reanchorComments",
    label: "MRSF: Reanchor Comments",
    contextMenuGroupId: "navigation",
    run: async () => {
      await plugin.reanchor({ autoSave: options.autoSaveAfterReanchor });
    },
  });

  return [addAction, replyAction, toggleResolveAction, reanchorAction];
}
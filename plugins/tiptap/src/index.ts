import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { TiptapMrsfHostAdapter } from "./host/HostAdapter.js";
import { TiptapMrsfPlugin } from "./TiptapMrsfPlugin.js";
import { buildInlineDecorations } from "./core/decorations.js";
import { getDocumentText } from "./core/textModel.js";
import { TiptapMrsfGutterOverlay } from "./ui/gutterOverlay.js";
import type { CommentDraft, DecorationSnapshot, ReviewReanchorOptions, TiptapMrsfExtensionOptions, TiptapMrsfStorage } from "./types.js";

export type {
  AnchorFields,
  CommentDraft,
  DecorationSnapshot,
  DocumentGeometry,
  EditorContentChange,
  EditorPoint,
  EditorRange,
  EditorSelection,
  GutterMarkSnapshot,
  HoverTargetSnapshot,
  InlineDecorationSnapshot,
  LineThreadSnapshot,
  RenderedThreadSnapshot,
  ReviewLoadOptions,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
  ThreadProjectionOptions,
  TiptapMrsfCommentClickEvent,
  TiptapMrsfConfirmDialogOptions,
  TiptapMrsfDialogFormResult,
  TiptapMrsfDialogThemeOptions,
  TiptapMrsfDisplayOptions,
  TiptapMrsfExtensionOptions,
  TiptapMrsfFormDialogOptions,
  TiptapMrsfGutterPosition,
  TiptapMrsfPluginControllerOptions,
  TiptapMrsfPluginSaveOptions,
  TiptapMrsfPluginSaveRequest,
  TiptapMrsfStateChangeEvent,
  TiptapMrsfStateChangeSource,
  TiptapMrsfStorage,
  TiptapMrsfTheme,
  TiptapMrsfThreadPopoverHandlerOptions,
  TiptapMrsfThreadPopoverOptions,
} from "./types.js";

export type { HostDisposer, TiptapMrsfHostAdapter } from "./host/HostAdapter.js";

export type { Comment, DiffHunk, MrsfDocument, ReanchorResult, ReanchorStatus } from "@mrsf/cli/browser";

export { TiptapMrsfPlugin } from "./TiptapMrsfPlugin.js";
export { splitDocumentLines } from "./host/HostAdapter.js";
export { ReviewStore } from "./core/ReviewStore.js";
export { applyLineShifts } from "./core/liveLineTracker.js";
export { buildInlineDecorations } from "./core/decorations.js";
export {
  comparePoints,
  normalizeRange,
  commentToEditorRange,
  selectionToAnchor,
  isInlineComment,
  isDocumentLevelComment,
} from "./core/positions.js";
export { projectDecorationSnapshot } from "./core/threadProjection.js";
export {
  createLineIndex,
  diffTextChange,
  geometryFromText,
  getDocumentText,
  getSelectedText,
  offsetToPoint,
  pmPosToTextOffset,
  pointToOffset,
  rangeFromOffsets,
  selectionToEditorSelection,
  textOffsetToPmPos,
} from "./core/textModel.js";
export {
  createTiptapMrsfThreadPopoverHandler,
  findCommentAnchorElements,
  getCommentAnchorRect,
  openTiptapMrsfThreadPopover,
} from "./ui/threadPopover.js";
export { openTiptapMrsfConfirmDialog, openTiptapMrsfFormDialog } from "./ui/dialogs.js";
export { TiptapMrsfGutterOverlay } from "./ui/gutterOverlay.js";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mrsf: {
      mrsfAddComment: (text: string, draft?: Partial<CommentDraft>) => ReturnType;
      mrsfReply: (commentId: string, text: string, draft?: Partial<CommentDraft>) => ReturnType;
      mrsfEdit: (commentId: string, text: string, draft?: Partial<CommentDraft>) => ReturnType;
      mrsfResolve: (commentId: string) => ReturnType;
      mrsfUnresolve: (commentId: string) => ReturnType;
      mrsfToggleResolved: (commentId: string) => ReturnType;
      mrsfDeleteComment: (commentId: string) => ReturnType;
      mrsfReload: () => ReturnType;
      mrsfSave: (reason?: string) => ReturnType;
      mrsfReanchor: (options?: ReviewReanchorOptions) => ReturnType;
    };
  }
}

export function getTiptapMrsfController(editor: Editor, name = "mrsf"): TiptapMrsfPlugin | null {
  const storage = (editor.storage as Record<string, TiptapMrsfStorage | undefined>)[name];
  return storage?.controller ?? null;
}

export function getTiptapMrsfDecorationState(editor: Editor, name = "mrsf"): { snapshot: DecorationSnapshot | null; decorations: DecorationSet } | null {
  const controller = getTiptapMrsfController(editor, name);
  const snapshot = controller?.getState()?.snapshot ?? null;
  if (!snapshot) {
    return null;
  }

  const text = getDocumentText(editor.state.doc);
  return {
    snapshot,
    decorations: buildInlineDecorations(editor.state.doc, snapshot, text),
  };
}

export function createTiptapMrsfExtension(host: TiptapMrsfHostAdapter, options: TiptapMrsfExtensionOptions): Extension {
  const extensionName = options.name ?? "mrsf";
  const pluginKey = new PluginKey<DecorationSet>(`${extensionName}$mrsf$decorations`);
  let suppressMetaDispatch = false;

  const buildDecorations = (editorState: EditorState, controller: TiptapMrsfPlugin | null): DecorationSet => {
    const snapshot = controller?.getState()?.snapshot ?? null;
    return buildInlineDecorations(
      editorState.doc,
      snapshot,
      getDocumentText(editorState.doc),
      { inlineHighlights: controller?.getDisplayOptions().inlineHighlights ?? true },
    );
  };

  return Extension.create<Record<string, never>, TiptapMrsfStorage>({
    name: extensionName,

    addStorage() {
      return {
        controller: null,
      };
    },

    addCommands() {
      return {
        mrsfAddComment: (text, draft = {}) => () => {
          const controller = this.storage.controller;
          if (!controller || !text.trim()) {
            return false;
          }

          void controller.addCommentFromSelection({
            ...draft,
            text,
          });
          return true;
        },
        mrsfReply: (commentId, text, draft = {}) => () => {
          const controller = this.storage.controller;
          if (!controller || !commentId || !text.trim()) {
            return false;
          }

          void controller.replyToComment(commentId, text, draft);
          return true;
        },
        mrsfEdit: (commentId, text, draft = {}) => () => {
          const controller = this.storage.controller;
          if (!controller || !commentId || !text.trim()) {
            return false;
          }

          controller.editComment(commentId, text, draft);
          return true;
        },
        mrsfResolve: (commentId) => () => {
          const controller = this.storage.controller;
          return controller ? controller.resolve(commentId) : false;
        },
        mrsfUnresolve: (commentId) => () => {
          const controller = this.storage.controller;
          return controller ? controller.unresolve(commentId) : false;
        },
        mrsfToggleResolved: (commentId) => () => {
          const controller = this.storage.controller;
          return controller ? controller.toggleResolved(commentId) : false;
        },
        mrsfDeleteComment: (commentId) => () => {
          const controller = this.storage.controller;
          return controller ? controller.deleteComment(commentId) : false;
        },
        mrsfReload: () => () => {
          const controller = this.storage.controller;
          if (!controller) {
            return false;
          }

          void controller.reloadFromHost();
          return true;
        },
        mrsfSave: (reason) => () => {
          const controller = this.storage.controller;
          if (!controller) {
            return false;
          }

          void controller.save({ reason });
          return true;
        },
        mrsfReanchor: (reanchorOptions) => () => {
          const controller = this.storage.controller;
          if (!controller) {
            return false;
          }

          void controller.reanchor(reanchorOptions);
          return true;
        },
      };
    },

    onCreate() {
      const userStateChange = options.onStateChange;
      this.storage.controller = new TiptapMrsfPlugin(this.editor, host, {
        ...options,
        onStateChange: (event) => {
          userStateChange?.(event);
          if (suppressMetaDispatch || this.editor.isDestroyed) {
            return;
          }

          const transaction = this.editor.state.tr
            .setMeta(pluginKey, event.source)
            .setMeta("addToHistory", false);
          this.editor.view.dispatch(transaction);
        },
      });
      void this.storage.controller.loadCurrent();
    },

    onDestroy() {
      this.storage.controller?.dispose();
      this.storage.controller = null;
    },

    addProseMirrorPlugins() {
      const extension = this;

      return [
        new Plugin<DecorationSet>({
          key: pluginKey,
          state: {
            init: (_, editorState) => buildDecorations(editorState, extension.storage.controller),
            apply: (tr, _oldDecorations, oldState, newState) => {
              const controller = extension.storage.controller;
              if (!controller) {
                return DecorationSet.empty;
              }

              if (tr.docChanged) {
                suppressMetaDispatch = true;
                try {
                  controller.handleViewUpdate(oldState, newState);
                } finally {
                  suppressMetaDispatch = false;
                }
              }

              if (tr.docChanged || tr.getMeta(pluginKey) != null) {
                return buildDecorations(newState, controller);
              }

              return buildDecorations(newState, controller);
            },
          },
          props: {
            decorations(state) {
              return pluginKey.getState(state) ?? DecorationSet.empty;
            },
            handleClick(view, _pos, event) {
              const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-mrsf-comment-id]");
              const commentId = target?.dataset.mrsfCommentId;
              if (!commentId) {
                return false;
              }

              return extension.storage.controller?.handleCommentClick(commentId) ?? false;
            },
          },
          view() {
            const overlay = new TiptapMrsfGutterOverlay({
              editor: extension.editor,
              getController: () => extension.storage.controller,
            });

            overlay.update();

            return {
              update() {
                overlay.update();
              },
              destroy() {
                overlay.destroy();
              },
            };
          },
        }),
      ];
    },
  });
}
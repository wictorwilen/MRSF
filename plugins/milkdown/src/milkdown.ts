import * as milkdownCore from "@milkdown/kit/core";
import * as milkdownCtx from "@milkdown/ctx";
import type { Node as ProsemirrorNode } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { Selection } from "@milkdown/prose/state";
import { DecorationSet } from "@milkdown/prose/view";
import { buildInlineDecorations } from "./core/decorations.js";
import { getSelectedText, getDocumentText, geometryFromText, selectionToEditorSelection } from "./core/textModel.js";
import { MilkdownMrsfController } from "./MilkdownMrsfController.js";
import type { MilkdownMrsfHostAdapter } from "./host/HostAdapter.js";
import type { EditorSelection, MilkdownMrsfControllerOptions } from "./types.js";
import { MilkdownMrsfOverlay } from "./ui/overlay.js";

type Cleanup = () => void | Promise<void>;
type RunnerReturnType = void | Promise<void> | Cleanup | Promise<Cleanup>;
type CtxRunner = () => RunnerReturnType;

interface MilkdownCtxLike {
  isInjected<T, N extends string = string>(sliceType: unknown | N): boolean;
  inject<T, N extends string = string>(sliceType: unknown | N, value?: T): unknown;
  remove<T, N extends string = string>(sliceType: unknown | N): unknown;
  get<T, N extends string = string>(sliceType: unknown | N): T;
  set<T, N extends string = string>(sliceType: unknown | N, value: T): void;
  update<T, N extends string = string>(sliceType: unknown | N, updater: (prev: T) => T): void;
  wait(timer: unknown): Promise<void>;
}

type MilkdownPlugin = (ctx: MilkdownCtxLike) => CtxRunner;

export interface MilkdownEditorLike {
  action<T>(action: (ctx: MilkdownCtxLike) => T): T;
}

interface MilkdownEditorViewLike {
  state: {
    doc: ProsemirrorNode;
    selection: Selection;
    tr: {
      setMeta(key: PluginKey, value: unknown): unknown;
    };
  };
  dispatch(tr: unknown): void;
}

export interface MilkdownMrsfPluginOptions extends MilkdownMrsfControllerOptions {
  autoLoad?: boolean;
}

export const milkdownMrsfControllerCtx = (milkdownCtx as { createSlice: <T>(value: T, name: string) => unknown }).createSlice<MilkdownMrsfController | null>(null, "milkdownMrsfController");
const editorViewCtx = (milkdownCore as { editorViewCtx: unknown }).editorViewCtx;
const prosePluginsCtx = (milkdownCore as { prosePluginsCtx: unknown }).prosePluginsCtx;
const inlineDecorationKey = new PluginKey("MRSF_MILKDOWN_INLINE_HIGHLIGHTS");
const lifecyclePluginKey = new PluginKey("MRSF_MILKDOWN_LIFECYCLE");

export function createMilkdownMrsfPlugin(
  host: MilkdownMrsfHostAdapter,
  options: MilkdownMrsfPluginOptions,
): MilkdownPlugin[] {
  const binding: MilkdownPlugin = (ctx) => {
    if (!ctx.isInjected(milkdownMrsfControllerCtx)) {
      ctx.inject(milkdownMrsfControllerCtx, null);
    }

    let controller: MilkdownMrsfController | null = null;
    let activeView: MilkdownEditorViewLike | null = null;
    let overlay: MilkdownMrsfOverlay | null = null;
    let initialLoadStarted = false;
    let refreshScheduled = false;
    let decorationsEnabled = false;

    const requestDecorationRefresh = (): void => {
      overlay?.update();

      if (!activeView || refreshScheduled) {
        return;
      }

      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        if (!activeView) {
          return;
        }

        const transaction = activeView.state.tr.setMeta(inlineDecorationKey, { refresh: true });
        activeView.dispatch(transaction);
      });
    };

    const ensureController = (): MilkdownMrsfController => {
      if (controller) {
        return controller;
      }

      controller = new MilkdownMrsfController(host, {
        ...options,
        onStateChange: (event) => {
          options.onStateChange?.(event);
          requestDecorationRefresh();
        },
      });
      ctx.set(milkdownMrsfControllerCtx, controller);
      return controller;
    };

    const startInitialLoad = (documentText?: string): void => {
      if (options.autoLoad === false || initialLoadStarted) {
        return;
      }

      initialLoadStarted = true;

      const loadText = documentText
        ? Promise.resolve(documentText)
        : Promise.resolve(host.getDocumentText(options.resourceId));

      void loadText.then((text) => {
        const nextController = ensureController();
        return nextController.load({
          documentText: text,
          geometry: geometryFromText(text),
        });
      });
    };

    const inlineDecorationPlugin = new Plugin({
      key: inlineDecorationKey,
      props: {
        decorations(state) {
          if (options.inlineHighlights === false || !decorationsEnabled) {
            return DecorationSet.empty;
          }

          const nextController = ctx.get<MilkdownMrsfController | null>(milkdownMrsfControllerCtx);
          const snapshot = nextController?.getState()?.snapshot ?? null;
          const text = getDocumentText(state.doc);
          return buildInlineDecorations(state.doc, snapshot, text);
        },
      },
    });

    const lifecyclePlugin = new Plugin({
      key: lifecyclePluginKey,
      view: (view) => {
        activeView = view as unknown as MilkdownEditorViewLike;
        decorationsEnabled = false;
        overlay = new MilkdownMrsfOverlay(
          view,
          () => controller?.getState() ?? null,
          () => controller,
          {
            inlineHighlights: options.inlineHighlights,
            interactive: options.interactive,
            showSelectionAddButton: options.showSelectionAddButton,
            onCommentSelect: options.onCommentSelect,
            composeAdd: options.composeAdd,
            composeReply: options.composeReply,
            composeEdit: options.composeEdit,
            confirmDelete: options.confirmDelete,
          },
        );
        const nextController = ensureController();

        if (options.autoLoad !== false) {
          const text = getDocumentText(view.state.doc);
          if (!nextController.getState()?.loaded) {
            startInitialLoad(text);
          } else {
            nextController.refresh(text);
          }
        }

        overlay.update();
        requestAnimationFrame(() => {
          if (!activeView || activeView !== (view as unknown as MilkdownEditorViewLike)) {
            return;
          }

          decorationsEnabled = true;
          requestDecorationRefresh();
        });

        return {
          update: (nextView, previousState) => {
            activeView = nextView as unknown as MilkdownEditorViewLike;
            overlay?.setView(nextView);
            overlay?.update();
            if (!controller?.getState()?.loaded || previousState.doc.eq(nextView.state.doc)) {
              return;
            }

            controller.applyTextUpdate(getDocumentText(previousState.doc), getDocumentText(nextView.state.doc));
          },
          destroy: () => {
            overlay?.destroy();
            overlay = null;
            activeView = null;
            refreshScheduled = false;
            decorationsEnabled = false;
            controller?.dispose();
            controller = null;
            ctx.set(milkdownMrsfControllerCtx, null);
          },
        };
      },
    });

    ensureController();

    const prosePluginsToRegister = options.inlineHighlights === false
      ? [lifecyclePlugin]
      : [inlineDecorationPlugin, lifecyclePlugin];

    const hadProsePluginsCtx = ctx.isInjected(prosePluginsCtx);
    if (!hadProsePluginsCtx) {
      ctx.inject(prosePluginsCtx, []);
    }

    ctx.update<unknown[]>(prosePluginsCtx, (plugins) => [...plugins, ...prosePluginsToRegister]);

    return async () => {
      return () => {
        overlay?.destroy();
        overlay = null;
        activeView = null;
        refreshScheduled = false;
        decorationsEnabled = false;
        controller?.dispose();
        controller = null;
        ctx.set(milkdownMrsfControllerCtx, null);
        if (hadProsePluginsCtx) {
          ctx.update<unknown[]>(prosePluginsCtx, (plugins) =>
            plugins.filter((plugin) => !prosePluginsToRegister.includes(plugin as Plugin)),
          );
        } else {
          ctx.remove(prosePluginsCtx);
        }
      };
    };
  };

  return [binding];
}

export function getMilkdownMrsfController(editor: MilkdownEditorLike): MilkdownMrsfController | null {
  return editor.action((ctx) => {
    if (!ctx.isInjected(milkdownMrsfControllerCtx)) {
      return null;
    }

    return ctx.get<MilkdownMrsfController | null>(milkdownMrsfControllerCtx);
  });
}

export function getMilkdownMrsfSelection(editor: MilkdownEditorLike): EditorSelection | null {
  return editor.action((ctx) => {
    if (!ctx.isInjected(editorViewCtx)) {
      return null;
    }

    const view = ctx.get<MilkdownEditorViewLike>(editorViewCtx);
    return selectionToEditorSelection(view.state.selection, view.state.doc);
  });
}

export function getMilkdownMrsfSelectedText(editor: MilkdownEditorLike): string {
  return editor.action((ctx) => {
    if (!ctx.isInjected(editorViewCtx)) {
      return "";
    }

    return getSelectedText(ctx.get<MilkdownEditorViewLike>(editorViewCtx).state as Parameters<typeof getSelectedText>[0]);
  });
}

export function getMilkdownMrsfDecorationState(editor: MilkdownEditorLike) {
  return editor.action((ctx) => {
    if (!ctx.isInjected(editorViewCtx)) {
      return {
        snapshot: null,
        decorations: DecorationSet.empty,
      };
    }

    const controller = ctx.get<MilkdownMrsfController | null>(milkdownMrsfControllerCtx);
    const view = ctx.get<MilkdownEditorViewLike>(editorViewCtx);
    const snapshot = controller?.getState()?.snapshot ?? null;
    const text = getDocumentText(view.state.doc);

    return {
      snapshot,
      decorations: buildInlineDecorations(view.state.doc, snapshot, text),
    };
  });
}
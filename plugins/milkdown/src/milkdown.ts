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
import type { DecorationSnapshot, EditorSelection, MilkdownMrsfControllerOptions } from "./types.js";
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
const inlineDecorationKey = new PluginKey<InlineDecorationPluginState>("MRSF_MILKDOWN_INLINE_HIGHLIGHTS");
const lifecyclePluginKey = new PluginKey("MRSF_MILKDOWN_LIFECYCLE");

interface InlineDecorationPluginState {
  decorations: DecorationSet;
  snapshot: DecorationSnapshot | null;
  enabled: boolean;
}

interface InlineDecorationMeta {
  refresh?: boolean;
  enabled?: boolean;
}

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
    let lastDispatchedSnapshot: DecorationSnapshot | null | undefined;

    const requestDecorationRefresh = (): void => {
      if (options.inlineHighlights === false || !activeView || refreshScheduled) {
        return;
      }

      const snapshot = controller?.getState()?.snapshot ?? null;
      // Skip dispatch if the snapshot reference hasn't changed since the last
      // dispatch — the existing decorations are still valid (they get mapped
      // through transactions automatically).
      if (snapshot === lastDispatchedSnapshot) {
        return;
      }

      refreshScheduled = true;
      requestAnimationFrame(() => {
        refreshScheduled = false;
        if (!activeView) {
          return;
        }

        lastDispatchedSnapshot = controller?.getState()?.snapshot ?? null;
        const transaction = activeView.state.tr.setMeta(inlineDecorationKey, { refresh: true } satisfies InlineDecorationMeta);
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
          if (event.source !== "content") {
            overlay?.update();
          }
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

    const buildSnapshotDecorations = (doc: ProsemirrorNode, snapshot: DecorationSnapshot | null): DecorationSet => {
      if (options.inlineHighlights === false || !snapshot) {
        return DecorationSet.empty;
      }
      // The text argument is unused now (the cached PM model carries it),
      // but keep the public function signature intact.
      return buildInlineDecorations(doc, snapshot, "");
    };

    const inlineDecorationPlugin = new Plugin<InlineDecorationPluginState>({
      key: inlineDecorationKey,
      state: {
        init: (_config, state) => {
          const snapshot = controller?.getState()?.snapshot ?? null;
          return {
            decorations: decorationsEnabled
              ? buildSnapshotDecorations(state.doc, snapshot)
              : DecorationSet.empty,
            snapshot,
            enabled: decorationsEnabled,
          };
        },
        apply: (tr, value, _oldState, newState) => {
          const meta = tr.getMeta(inlineDecorationKey) as InlineDecorationMeta | undefined;
          let next = value;

          if (meta?.enabled !== undefined && meta.enabled !== next.enabled) {
            next = { ...next, enabled: meta.enabled };
          }

          if (meta?.refresh) {
            const snapshot = controller?.getState()?.snapshot ?? null;
            next = {
              decorations: next.enabled
                ? buildSnapshotDecorations(newState.doc, snapshot)
                : DecorationSet.empty,
              snapshot,
              enabled: next.enabled,
            };
            return next;
          }

          if (tr.docChanged) {
            // Map existing decorations forward through the transaction. This
            // is O(decorations + ops), not O(decorations × |doc|) like a
            // full rebuild would be.
            next = {
              ...next,
              decorations: next.decorations.map(tr.mapping, tr.doc),
            };
          }

          return next;
        },
      },
      props: {
        decorations(state) {
          if (options.inlineHighlights === false) {
            return DecorationSet.empty;
          }
          const pluginState = inlineDecorationKey.getState(state);
          if (!pluginState || !pluginState.enabled) {
            return DecorationSet.empty;
          }
          return pluginState.decorations;
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
          // Force a refresh now that decorations are enabled.
          lastDispatchedSnapshot = undefined;
          const enableTr = activeView.state.tr.setMeta(inlineDecorationKey, {
            enabled: true,
            refresh: true,
          } satisfies InlineDecorationMeta);
          lastDispatchedSnapshot = controller?.getState()?.snapshot ?? null;
          activeView.dispatch(enableTr);
        });

        return {
          update: (nextView, previousState) => {
            activeView = nextView as unknown as MilkdownEditorViewLike;
            overlay?.setView(nextView);
            overlay?.update();
            if (!controller?.getState()?.loaded || previousState.doc.eq(nextView.state.doc)) {
              return;
            }

            controller.queueTextUpdate(getDocumentText(previousState.doc), getDocumentText(nextView.state.doc));
          },
          destroy: () => {
            overlay?.destroy();
            overlay = null;
            activeView = null;
            refreshScheduled = false;
            decorationsEnabled = false;
            lastDispatchedSnapshot = undefined;
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
        lastDispatchedSnapshot = undefined;
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
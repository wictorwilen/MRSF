import * as milkdownCore from "@milkdown/kit/core";
import type { ToolbarFeatureConfig } from "@milkdown/crepe/feature/toolbar";
import type { EditorView } from "@milkdown/prose/view";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { MilkdownMrsfController } from "./MilkdownMrsfController.js";
import type { MilkdownMrsfHostAdapter } from "./host/HostAdapter.js";
import type { EditorSelection } from "./types.js";
import type { MilkdownEditorLike, MilkdownMrsfPluginOptions } from "./milkdown.js";
import {
  createMilkdownMrsfPlugin,
  getMilkdownMrsfController,
  getMilkdownMrsfDecorationState,
  getMilkdownMrsfSelectedText,
  getMilkdownMrsfSelection,
  milkdownMrsfControllerCtx,
} from "./milkdown.js";
import { addCrepeMrsfToolbarItem, runCrepeAddComment } from "./ui/crepeCommentAction.js";
import { CrepeMrsfMenuBridge } from "./ui/crepeMenuBridge.js";

export interface CrepeLike {
  editor: MilkdownEditorLike;
}

interface CrepeFeatureEditorLike {
  config?(configure: (ctx: MilkdownCtxLike) => void): unknown;
  use(plugins: unknown): unknown;
}

interface MilkdownCtxLike {
  isInjected<T, N extends string = string>(sliceType: unknown | N): boolean;
  inject<T, N extends string = string>(sliceType: unknown | N, value?: T): unknown;
  remove<T, N extends string = string>(sliceType: unknown | N): unknown;
  get<T, N extends string = string>(sliceType: unknown | N): T;
  set<T, N extends string = string>(sliceType: unknown | N, value: T): void;
  update<T, N extends string = string>(sliceType: unknown | N, updater: (prev: T) => T): void;
}

type CrepePlugin = (ctx: MilkdownCtxLike) => () => void | Promise<void>;

const editorViewCtx = (milkdownCore as { editorViewCtx: unknown }).editorViewCtx;
const prosePluginsCtx = (milkdownCore as { prosePluginsCtx: unknown }).prosePluginsCtx;
const crepeMenuBridgePluginKey = new PluginKey("MRSF_CREPE_MENU_BRIDGE");

function createCrepeMenuBridgePlugin(options: MilkdownMrsfPluginOptions): CrepePlugin[] {
  const binding: CrepePlugin = (ctx) => {
    const lifecyclePlugin = new Plugin({
      key: crepeMenuBridgePluginKey,
      view: (view) => {
        const bridge = new CrepeMrsfMenuBridge(
          view,
          () => ctx.get<MilkdownMrsfController | null>(milkdownMrsfControllerCtx),
          {
            interactive: options.interactive,
            onCommentSelect: options.onCommentSelect,
            composeAdd: options.composeAdd,
          },
        );

        return {
          update: (nextView) => {
            bridge.setView(nextView);
          },
          destroy: () => {
            bridge.destroy();
          },
        };
      },
    });

    const hadProsePluginsCtx = ctx.isInjected(prosePluginsCtx);
    if (!hadProsePluginsCtx) {
      ctx.inject(prosePluginsCtx, []);
    }

    ctx.update<unknown[]>(prosePluginsCtx, (plugins) => [...plugins, lifecyclePlugin]);

    return () => {
      if (hadProsePluginsCtx) {
        ctx.update<unknown[]>(prosePluginsCtx, (plugins) =>
          plugins.filter((plugin) => plugin !== lifecyclePlugin),
        );
      } else {
        ctx.remove(prosePluginsCtx);
      }
    };
  };

  return [binding];
}

export function createCrepeMrsfFeature(host: MilkdownMrsfHostAdapter, options: MilkdownMrsfPluginOptions) {
  return (editor: CrepeFeatureEditorLike): void => {
    editor.use(createMilkdownMrsfPlugin(host, {
      ...options,
      showSelectionAddButton: false,
    }));
    editor.use(createCrepeMenuBridgePlugin(options));
  };
}

export function createCrepeMrsfToolbarConfig(
  options: Pick<MilkdownMrsfPluginOptions, "interactive" | "composeAdd" | "onCommentSelect">,
): ToolbarFeatureConfig {
  return {
    buildToolbar: (builder) => {
      if (options.interactive === false) {
        return;
      }

      addCrepeMrsfToolbarItem(builder, (ctx) => {
        const view = ctx.get(editorViewCtx) as EditorView;
        const controller = ctx.get<MilkdownMrsfController | null>(milkdownMrsfControllerCtx);
        void runCrepeAddComment(view, controller, {
          composeAdd: options.composeAdd,
          onCommentSelect: options.onCommentSelect,
        });
      });
    },
  };
}

export function getCrepeMrsfController(crepe: CrepeLike): MilkdownMrsfController | null {
  return getMilkdownMrsfController(crepe.editor);
}

export function getCrepeMrsfSelection(crepe: CrepeLike): EditorSelection | null {
  return getMilkdownMrsfSelection(crepe.editor);
}

export function getCrepeMrsfSelectedText(crepe: CrepeLike): string {
  return getMilkdownMrsfSelectedText(crepe.editor);
}

export function getCrepeMrsfDecorationState(crepe: CrepeLike) {
  return getMilkdownMrsfDecorationState(crepe.editor);
}
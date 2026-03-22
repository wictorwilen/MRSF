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
} from "./milkdown.js";

export interface CrepeLike {
  editor: MilkdownEditorLike;
}

interface CrepeFeatureEditorLike {
  use(plugins: unknown): unknown;
}

export function createCrepeMrsfFeature(host: MilkdownMrsfHostAdapter, options: MilkdownMrsfPluginOptions) {
  return (editor: CrepeFeatureEditorLike): void => {
    editor.use(createMilkdownMrsfPlugin(host, options));
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
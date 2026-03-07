/**
 * Shared logic for @mrsf/markdown-it-mrsf.
 *
 * Contains the plugin factory using shared comment loading/grouping logic.
 */

import type MarkdownIt from "markdown-it";
import type { MrsfPluginOptions, CommentLoader } from "./types.js";
import { resolveComments } from "@mrsf/plugin-shared";
import { installCoreRule } from "./rules/core.js";
import { installRendererRules } from "./rules/renderer.js";

/**
 * Create a markdown-it plugin function with the given comment loader.
 *
 * @param loader - Function that resolves sidecar data from plugin options
 * @returns A markdown-it plugin function
 */
export function createMrsfPlugin(loader: CommentLoader) {
  return function mrsfPlugin(md: MarkdownIt, options: MrsfPluginOptions = {}): void {
    installCoreRule(
      md,
      (state) => resolveComments(loader, options, state.env),
      { lineHighlight: options.lineHighlight ?? false },
    );
    installRendererRules(md, {
      dataContainer: options.dataContainer,
      dataElementId: options.dataElementId,
    });
  };
}

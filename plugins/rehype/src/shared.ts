/**
 * Shared logic for @mrsf/rehype-mrsf.
 *
 * Contains the plugin factory using shared comment loading/grouping logic.
 */

import type { Root } from "hast";
import type { MrsfPluginOptions, CommentLoader } from "./types.js";
import { resolveComments } from "@mrsf/plugin-shared";
import { transformTree } from "./transform.js";

/**
 * Create a rehype plugin function with the given comment loader.
 *
 * @param loader - Function that resolves sidecar data from plugin options
 * @returns A rehype plugin function
 */
export function createRehypeMrsf(loader: CommentLoader) {
  return function rehypeMrsf(options: MrsfPluginOptions = {}) {
    const interactive = options.interactive ?? false;
    const gutterPosition = options.gutterPosition ?? "right";
    const gutterForInline = options.gutterForInline ?? true;
    const inlineHighlights = options.inlineHighlights ?? true;

    return (tree: Root) => {
      const result = resolveComments(loader, options);
      if (!result) return;

      transformTree(tree, result.lineMap, {
        interactive,
        gutterPosition,
        gutterForInline,
        inlineHighlights,
      });
    };
  };
}

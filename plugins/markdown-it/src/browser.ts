/**
 * Browser-safe entry point for @mrsf/markdown-it-mrsf.
 *
 * This entry is automatically selected by bundlers (Vite, webpack, esbuild)
 * via the `"browser"` export condition in package.json. It supports the
 * `comments` and `loader` provisioning modes — no Node.js file-system APIs.
 *
 * You do NOT need to import this directly. Just use:
 *   import { mrsfPlugin } from "@mrsf/markdown-it-mrsf";
 *
 * Your bundler will resolve to this file automatically when targeting
 * a browser environment.
 */

import type { MrsfPluginOptions } from "./types.js";
import { createMrsfPlugin } from "./shared.js";

export type { MrsfPluginOptions, SlimComment, CommentThread, LineMap, CommentLoader } from "./types.js";

/**
 * The markdown-it plugin function (browser-safe).
 *
 * Supports `comments` (inline data) and `loader` (custom function) options.
 */
export const mrsfPlugin = createMrsfPlugin((options: MrsfPluginOptions) => {
  if (options.comments) {
    return options.comments;
  }

  if (options.loader) {
    try {
      return options.loader();
    } catch {
      return null;
    }
  }

  if (options.sidecarPath || options.documentPath) {
    console.warn(
      "[@mrsf/markdown-it-mrsf] sidecarPath and documentPath require Node.js. " +
      "Use `comments` or `loader` options in browser environments."
    );
  }

  return null;
});

export default mrsfPlugin;

/**
 * Browser-safe entry point for @mrsf/marked-mrsf.
 */

import type { MrsfPluginOptions } from "./types.js";
import { createMarkedMrsf } from "./shared.js";

export type { MrsfPluginOptions, SlimComment, CommentThread, LineMap, CommentLoader } from "./types.js";

export const markedMrsf = createMarkedMrsf((options: MrsfPluginOptions, env?: unknown) => {
  if (options.comments) {
    return options.comments;
  }

  if (options.loader) {
    try {
      return options.loader(options, env);
    } catch {
      return null;
    }
  }

  if (options.sidecarPath || options.documentPath) {
    console.warn(
      "[@mrsf/marked-mrsf] sidecarPath and documentPath require Node.js. " +
      "Use `comments` or `loader` options in browser environments.",
    );
  }

  return null;
});

export default markedMrsf;
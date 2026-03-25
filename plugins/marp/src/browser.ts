import type { MrsfPluginOptions } from "./types.js";
import { createMarpPlugin } from "./shared.js";
import type { MrsfMarpPlugin } from "./shared.js";

export type { MrsfPluginOptions, SlimComment, CommentThread, LineMap, CommentLoader } from "./types.js";
export type { MrsfMarpPlugin, MarpitLike, MarpitPluginContext } from "./shared.js";

export const mrsfPlugin: MrsfMarpPlugin = createMarpPlugin((options: MrsfPluginOptions, env?: unknown) => {
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
      "[@mrsf/marp-mrsf] sidecarPath and documentPath require Node.js. " +
      "Use `comments` or `loader` options in browser environments.",
    );
  }

  return null;
});

export default mrsfPlugin;
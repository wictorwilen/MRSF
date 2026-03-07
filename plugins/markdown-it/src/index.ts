/**
 * @mrsf/markdown-it-mrsf — markdown-it plugin for MRSF review comments.
 *
 * This is the full-featured Node.js entry point. It supports all four
 * sidecar provisioning modes: `comments`, `loader`, `sidecarPath`, and
 * `documentPath`. The latter two require Node.js file-system APIs.
 *
 * In browser / bundler environments, the `"browser"` export condition in
 * package.json automatically resolves to the browser-safe entry, so you
 * never need to import a different path — just use:
 *
 * @example
 * ```ts
 * import MarkdownIt from "markdown-it";
 * import { mrsfPlugin } from "@mrsf/markdown-it-mrsf";
 *
 * const md = new MarkdownIt();
 * md.use(mrsfPlugin, { documentPath: "docs/guide.md" });
 * const html = md.render(markdownSource);
 * ```
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSidecarContent } from "@mrsf/cli";
import type { MrsfPluginOptions } from "./types.js";
import { createMrsfPlugin } from "./shared.js";

// Re-export types for consumers
export type { MrsfPluginOptions, SlimComment, CommentThread, LineMap, CommentLoader } from "./types.js";

/**
 * The markdown-it plugin function (Node.js — full feature set).
 */
export const mrsfPlugin = createMrsfPlugin((options: MrsfPluginOptions, env?: unknown) => {
  // Priority 1: inline data
  if (options.comments) {
    return options.comments;
  }

  // Priority 2: custom loader function
  if (options.loader) {
    try {
      return options.loader(options, env);
    } catch {
      return null;
    }
  }

  // Priority 3: explicit sidecar path
  if (options.sidecarPath) {
    try {
      const abs = path.resolve(options.cwd || process.cwd(), options.sidecarPath);
      const content = readFileSync(abs, "utf-8");
      return parseSidecarContent(content, abs);
    } catch {
      return null;
    }
  }

  // Priority 4: auto-discover from documentPath
  if (options.documentPath) {
    try {
      const cwd = options.cwd || process.cwd();
      const abs = path.resolve(cwd, options.documentPath);
      const yamlPath = abs + ".review.yaml";
      const jsonPath = abs + ".review.json";

      let raw: string | null = null;
      let hint: string | null = null;
      try {
        raw = readFileSync(yamlPath, "utf-8");
        hint = yamlPath;
      } catch {
        try {
          raw = readFileSync(jsonPath, "utf-8");
          hint = jsonPath;
        } catch {
          return null;
        }
      }

      if (!raw) return null;
      return parseSidecarContent(raw, hint!);
    } catch {
      return null;
    }
  }

  return null;
});

export default mrsfPlugin;

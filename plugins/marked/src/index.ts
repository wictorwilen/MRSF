/**
 * @mrsf/marked-mrsf — Marked plugin for MRSF review comments.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSidecarContent } from "@mrsf/cli";
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

  if (options.sidecarPath) {
    try {
      const abs = path.resolve(options.cwd || process.cwd(), options.sidecarPath);
      const content = readFileSync(abs, "utf-8");
      return parseSidecarContent(content, abs);
    } catch {
      return null;
    }
  }

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

export default markedMrsf;
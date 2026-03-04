/**
 * @mrsf/markdown-it-mrsf — markdown-it plugin for MRSF review comments.
 *
 * Renders Sidemark review comments (badges, inline highlights, tooltips)
 * directly into the HTML output during the markdown-it pipeline.
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

import type MarkdownIt from "markdown-it";
import {
  discoverSidecar,
  parseSidecar,
  parseSidecarContent,
} from "@mrsf/cli";
import type { MrsfDocument } from "@mrsf/cli";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MrsfPluginOptions, SlimComment, CommentThread, LineMap } from "./types.js";
import { installCoreRule } from "./rules/core.js";
import { installRendererRules } from "./rules/renderer.js";

// Re-export types for consumers
export type { MrsfPluginOptions, SlimComment, CommentThread, LineMap } from "./types.js";
export type { MrsfAction, MrsfActionDetail } from "./controller.js";

/**
 * Convert an MrsfDocument into a slim comment array.
 */
function toSlimComments(doc: MrsfDocument): SlimComment[] {
  return doc.comments.map((c) => ({
    id: c.id,
    author: c.author || "Unknown",
    text: c.text || "",
    line: c.line ?? null,
    end_line: c.end_line ?? null,
    start_column: c.start_column ?? null,
    end_column: c.end_column ?? null,
    selected_text: c.selected_text || null,
    resolved: !!c.resolved,
    reply_to: c.reply_to || null,
    severity: c.severity || null,
    type: c.type || null,
    timestamp: c.timestamp || null,
  }));
}

/**
 * Group comments by line number, threading replies under parents.
 */
function groupByLine(comments: SlimComment[]): LineMap {
  const rootComments = comments.filter((c) => !c.reply_to && c.line != null);
  const replies = comments.filter((c) => c.reply_to);

  // Build reply map: parentId → replies
  const replyMap = new Map<string, SlimComment[]>();
  for (const r of replies) {
    const list = replyMap.get(r.reply_to!) || [];
    list.push(r);
    replyMap.set(r.reply_to!, list);
  }

  // Group by line
  const lineMap: LineMap = new Map();
  for (const c of rootComments) {
    const line = c.line!;
    const threads = lineMap.get(line) || [];
    threads.push({
      comment: c,
      replies: replyMap.get(c.id) || [],
    });
    lineMap.set(line, threads);
  }

  return lineMap;
}

/**
 * Load sidecar data synchronously based on plugin options.
 */
function loadComments(options: MrsfPluginOptions): MrsfDocument | null {
  // Priority 1: inline data
  if (options.comments) {
    return options.comments;
  }

  // Priority 2: explicit sidecar path
  if (options.sidecarPath) {
    try {
      const abs = path.resolve(options.cwd || process.cwd(), options.sidecarPath);
      const content = readFileSync(abs, "utf-8");
      return parseSidecarContent(content, abs);
    } catch {
      return null;
    }
  }

  // Priority 3: auto-discover from documentPath
  if (options.documentPath) {
    try {
      const cwd = options.cwd || process.cwd();
      const abs = path.resolve(cwd, options.documentPath);
      // Synchronous discovery: check for co-located .review.yaml/.review.json
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
}

/**
 * The markdown-it plugin function.
 *
 * @param md - markdown-it instance
 * @param options - plugin options
 */
export function mrsfPlugin(md: MarkdownIt, options: MrsfPluginOptions = {}): void {
  const showResolved = options.showResolved ?? true;
  const interactive = options.interactive ?? false;

  // Load sidecar data
  const doc = loadComments(options);
  if (!doc || !doc.comments || doc.comments.length === 0) {
    return; // Nothing to render
  }

  // Convert and filter
  let comments = toSlimComments(doc);
  if (!showResolved) {
    comments = comments.filter((c) => !c.resolved);
  }

  if (comments.length === 0) return;

  // Group by line
  const lineMap = groupByLine(comments);

  // Install rules
  installCoreRule(md, lineMap, interactive);
  installRendererRules(md);
}

export default mrsfPlugin;

/**
 * Browser-safe entry point for @mrsf/markdown-it-mrsf.
 *
 * This export only supports the `comments` (inline data) and `loader`
 * provisioning modes — no file-system access. Safe for use in browsers,
 * bundlers, and environments without Node.js APIs.
 */

import type MarkdownIt from "markdown-it";
import type { MrsfDocument } from "@mrsf/cli";
import type { MrsfPluginOptions, SlimComment, CommentThread, LineMap } from "./types.js";
import { installCoreRule } from "./rules/core.js";
import { installRendererRules } from "./rules/renderer.js";

export type { MrsfPluginOptions, SlimComment, CommentThread, LineMap } from "./types.js";

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

function groupByLine(comments: SlimComment[]): LineMap {
  const rootComments = comments.filter((c) => !c.reply_to && c.line != null);
  const replies = comments.filter((c) => c.reply_to);

  const replyMap = new Map<string, SlimComment[]>();
  for (const r of replies) {
    const list = replyMap.get(r.reply_to!) || [];
    list.push(r);
    replyMap.set(r.reply_to!, list);
  }

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
 * Browser-safe markdown-it plugin function.
 *
 * Only supports `comments` (inline data) and `loader` options.
 * For file-system–based loading, use the main entry point instead.
 */
export function mrsfPlugin(md: MarkdownIt, options: MrsfPluginOptions = {}): void {
  const showResolved = options.showResolved ?? true;
  const interactive = options.interactive ?? false;

  // Load data — browser-safe modes only
  let doc: MrsfDocument | null = null;
  if (options.comments) {
    doc = options.comments;
  } else if (options.loader) {
    try {
      doc = options.loader();
    } catch {
      return;
    }
  }

  if (!doc || !doc.comments || doc.comments.length === 0) return;

  let comments = toSlimComments(doc);
  if (!showResolved) {
    comments = comments.filter((c) => !c.resolved);
  }
  if (comments.length === 0) return;

  const lineMap = groupByLine(comments);
  installCoreRule(md, lineMap, interactive);
  installRendererRules(md);
}

export default mrsfPlugin;

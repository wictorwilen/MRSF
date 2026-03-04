/**
 * Shared comment loading and grouping logic for MRSF rendering plugins.
 */

import type { MrsfDocument } from "@mrsf/cli";
import type { MrsfPluginOptions, SlimComment, CommentThread, LineMap } from "./types.js";

/**
 * A function that loads sidecar data from plugin options.
 */
export type CommentLoader = (options: MrsfPluginOptions) => MrsfDocument | null;

/**
 * Convert an MrsfDocument into a slim comment array.
 */
export function toSlimComments(doc: MrsfDocument): SlimComment[] {
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
export function groupByLine(comments: SlimComment[]): LineMap {
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
 * Resolve options into a filtered LineMap ready for rendering.
 * Returns null if there are no comments to render.
 */
export function resolveComments(
  loader: CommentLoader,
  options: MrsfPluginOptions,
): { lineMap: LineMap; comments: SlimComment[] } | null {
  const showResolved = options.showResolved ?? true;

  const doc = loader(options);
  if (!doc || !doc.comments || doc.comments.length === 0) {
    return null;
  }

  let comments = toSlimComments(doc);
  if (!showResolved) {
    comments = comments.filter((c) => !c.resolved);
  }

  if (comments.length === 0) return null;

  const lineMap = groupByLine(comments);
  return { lineMap, comments };
}

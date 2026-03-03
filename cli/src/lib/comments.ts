/**
 * MRSF Comment Operations — CRUD for sidecar comments.
 */

import { randomUUID } from "node:crypto";
import type {
  AddCommentOptions,
  Comment,
  CommentFilter,
  MrsfDocument,
} from "./types.js";
import { computeHash } from "./writer.js";
import { getCurrentCommit, findRepoRoot, isGitAvailable } from "./git.js";

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

/**
 * Add a new comment to a document. Mutates doc.comments in place.
 * Returns the created comment.
 */
export async function addComment(
  doc: MrsfDocument,
  opts: AddCommentOptions,
  repoRoot?: string,
): Promise<Comment> {
  const id = opts.id ?? randomUUID();
  const timestamp = opts.timestamp ?? new Date().toISOString();

  // Auto-detect commit from HEAD when git is available
  let commit = opts.commit;
  if (!commit && repoRoot && (await isGitAvailable())) {
    commit = (await getCurrentCommit(repoRoot)) ?? undefined;
  }

  const comment: Comment = {
    id,
    author: opts.author,
    timestamp,
    text: opts.text,
    resolved: false,
  };

  // Optional anchoring fields
  if (opts.line != null) comment.line = opts.line;
  if (opts.end_line != null) comment.end_line = opts.end_line;
  if (opts.start_column != null) comment.start_column = opts.start_column;
  if (opts.end_column != null) comment.end_column = opts.end_column;
  if (opts.type) comment.type = opts.type;
  if (opts.severity) comment.severity = opts.severity;
  if (opts.reply_to) comment.reply_to = opts.reply_to;
  if (commit) comment.commit = commit;

  doc.comments.push(comment);
  return comment;
}

/**
 * Populate selected_text from document lines (reads the file content region).
 * Should be called after addComment if the caller provides line info but not selected_text.
 */
export function populateSelectedText(
  comment: Comment,
  documentLines: string[],
): void {
  if (comment.selected_text) return; // already set
  if (comment.line == null) return;

  const startIdx = comment.line - 1;
  const endIdx = (comment.end_line ?? comment.line) - 1;

  if (startIdx < 0 || endIdx >= documentLines.length) return;

  if (startIdx === endIdx) {
    let line = documentLines[startIdx];
    if (comment.start_column != null && comment.end_column != null) {
      line = line.slice(comment.start_column, comment.end_column);
    }
    comment.selected_text = line;
  } else {
    const lines: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      let l = documentLines[i];
      if (i === startIdx && comment.start_column != null) {
        l = l.slice(comment.start_column);
      }
      if (i === endIdx && comment.end_column != null) {
        l = l.slice(0, comment.end_column);
      }
      lines.push(l);
    }
    comment.selected_text = lines.join("\n");
  }

  // Also set the hash
  if (comment.selected_text) {
    comment.selected_text_hash = computeHash(comment.selected_text);
  }
}

// ---------------------------------------------------------------------------
// Resolve / Unresolve
// ---------------------------------------------------------------------------

/**
 * Resolve a comment by id. Per §9, resolving a parent does NOT
 * automatically resolve its replies.
 *
 * Returns true if the comment was found and updated.
 */
export function resolveComment(
  doc: MrsfDocument,
  commentId: string,
  cascade = false,
): boolean {
  const comment = doc.comments.find((c) => c.id === commentId);
  if (!comment) return false;

  comment.resolved = true;

  if (cascade) {
    // Cascade to direct replies only
    for (const c of doc.comments) {
      if (c.reply_to === commentId) {
        c.resolved = true;
      }
    }
  }

  return true;
}

/**
 * Unresolve a comment by id.
 */
export function unresolveComment(
  doc: MrsfDocument,
  commentId: string,
): boolean {
  const comment = doc.comments.find((c) => c.id === commentId);
  if (!comment) return false;
  comment.resolved = false;
  return true;
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Remove a comment by id. Returns true if found and removed.
 */
export function removeComment(
  doc: MrsfDocument,
  commentId: string,
): boolean {
  const idx = doc.comments.findIndex((c) => c.id === commentId);
  if (idx === -1) return false;
  doc.comments.splice(idx, 1);
  return true;
}

// ---------------------------------------------------------------------------
// List / Filter
// ---------------------------------------------------------------------------

/**
 * Filter comments based on criteria.
 */
export function filterComments(
  comments: Comment[],
  filter: CommentFilter,
): Comment[] {
  return comments.filter((c) => {
    if (filter.open === true && c.resolved) return false;
    if (filter.resolved === true && !c.resolved) return false;
    if (filter.author && c.author !== filter.author) return false;
    if (filter.type && c.type !== filter.type) return false;
    if (filter.severity && c.severity !== filter.severity) return false;
    if (filter.orphaned === true && c.x_reanchor_status !== "orphaned") return false;
    if (filter.orphaned === false && c.x_reanchor_status === "orphaned") return false;
    return true;
  });
}

/**
 * Get a list of threads — groups of comments by their root ID via reply_to.
 * Returns a map of root comment ID → [root, ...replies in order].
 */
export function getThreads(
  comments: Comment[],
): Map<string, Comment[]> {
  const threads = new Map<string, Comment[]>();
  const replyMap = new Map<string, string>(); // child id → root id

  // First pass: find all roots and build reply chains
  for (const c of comments) {
    if (!c.reply_to) {
      threads.set(c.id, [c]);
    } else {
      replyMap.set(c.id, c.reply_to);
    }
  }

  // Resolve transitive reply_to chains to roots
  function findRoot(id: string): string {
    const parent = replyMap.get(id);
    if (!parent) return id;
    return findRoot(parent);
  }

  // Second pass: attach replies to their root thread
  for (const c of comments) {
    if (c.reply_to) {
      const rootId = findRoot(c.id);
      if (!threads.has(rootId)) {
        threads.set(rootId, []);
      }
      threads.get(rootId)!.push(c);
    }
  }

  return threads;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface CommentSummary {
  total: number;
  open: number;
  resolved: number;
  orphaned: number;
  threads: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

/**
 * Generate summary statistics for a comment list.
 */
export function summarize(comments: Comment[]): CommentSummary {
  const summary: CommentSummary = {
    total: comments.length,
    open: 0,
    resolved: 0,
    orphaned: 0,
    threads: 0,
    byType: {},
    bySeverity: {},
  };

  const roots = new Set<string>();

  for (const c of comments) {
    if (c.resolved) summary.resolved++;
    else summary.open++;

    if (c.x_reanchor_status === "orphaned") summary.orphaned++;

    if (c.type) {
      summary.byType[c.type] = (summary.byType[c.type] ?? 0) + 1;
    }
    if (c.severity) {
      summary.bySeverity[c.severity] = (summary.bySeverity[c.severity] ?? 0) + 1;
    }

    if (!c.reply_to) roots.add(c.id);
  }

  summary.threads = roots.size;
  return summary;
}

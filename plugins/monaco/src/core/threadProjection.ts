import type { Comment, MrsfDocument } from "@mrsf/cli/browser";
import type {
  DecorationSnapshot,
  GutterMarkSnapshot,
  HoverTargetSnapshot,
  InlineDecorationSnapshot,
  LineThreadSnapshot,
  RenderedThreadSnapshot,
  ThreadProjectionOptions,
} from "../types.js";
import { commentToEditorRange, isInlineComment } from "./positions.js";

function severityRank(severity: string | null | undefined): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function maxSeverity(comments: readonly Comment[]): string | null {
  let current: string | null = null;

  for (const comment of comments) {
    if (severityRank(comment.severity) > severityRank(current)) {
      current = comment.severity ?? null;
    }
  }

  return current;
}

function resolvedState(comments: readonly Comment[]): "open" | "resolved" | "mixed" {
  const resolvedCount = comments.filter((comment) => !!comment.resolved).length;
  if (resolvedCount === 0) return "open";
  if (resolvedCount === comments.length) return "resolved";
  return "mixed";
}

export function projectDecorationSnapshot(
  document: MrsfDocument,
  options: ThreadProjectionOptions = {},
): DecorationSnapshot {
  const showResolved = options.showResolved ?? true;
  const visibleComments = showResolved
    ? document.comments
    : document.comments.filter((comment) => !comment.resolved);

  const commentsById = new Map(visibleComments.map((comment) => [comment.id, comment]));
  const repliesByParent = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  const orphanedCommentIds: string[] = [];
  const documentLevelCommentIds: string[] = [];
  const inlineRanges: InlineDecorationSnapshot[] = [];
  const lines = new Map<number, RenderedThreadSnapshot[]>();

  for (const comment of visibleComments) {
    if (comment.reply_to) {
      const replies = repliesByParent.get(comment.reply_to) ?? [];
      replies.push(comment);
      repliesByParent.set(comment.reply_to, replies);
      continue;
    }

    roots.push(comment);
  }

  for (const [parentId, replies] of repliesByParent.entries()) {
    if (!commentsById.has(parentId)) {
      orphanedCommentIds.push(...replies.map((reply) => reply.id));
    }
  }

  for (const root of roots) {
    const replies = repliesByParent.get(root.id) ?? [];
    const threadComments = [root, ...replies];

    if (root.line == null) {
      documentLevelCommentIds.push(root.id);
      continue;
    }

    const range = commentToEditorRange(root, options.geometry);
    if (options.geometry && !range) {
      orphanedCommentIds.push(root.id);
      continue;
    }

    const snapshot: RenderedThreadSnapshot = {
      line: root.line,
      rootCommentId: root.id,
      commentIds: threadComments.map((comment) => comment.id),
      replyCount: replies.length,
      resolved: threadComments.every((comment) => !!comment.resolved),
      highestSeverity: maxSeverity(threadComments),
      range,
    };

    const lineThreads = lines.get(root.line) ?? [];
    lineThreads.push(snapshot);
    lines.set(root.line, lineThreads);

    if (isInlineComment(root) && range) {
      inlineRanges.push({
        commentId: root.id,
        line: root.line,
        selectedText: root.selected_text ?? null,
        resolved: !!root.resolved,
        severity: root.severity ?? null,
        range,
      });
    }
  }

  const threadsByLine: LineThreadSnapshot[] = [...lines.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([line, threads]) => ({ line, threads }));

  const gutterMarks: GutterMarkSnapshot[] = threadsByLine.map(({ line, threads }) => {
    const threadComments = threads.flatMap((thread) =>
      thread.commentIds
        .map((commentId) => commentsById.get(commentId))
        .filter((comment): comment is Comment => !!comment),
    );

    return {
      line,
      threadCount: threads.length,
      commentCount: threadComments.length,
      resolvedState: resolvedState(threadComments),
      highestSeverity: maxSeverity(threadComments),
    };
  });

  const hoverTargets: HoverTargetSnapshot[] = threadsByLine.map(({ line, threads }) => ({
    line,
    commentIds: threads.flatMap((thread) => thread.commentIds),
    range: threads.find((thread) => thread.range)?.range,
  }));

  return {
    threadsByLine,
    gutterMarks,
    inlineRanges,
    hoverTargets,
    documentLevelCommentIds,
    orphanedCommentIds,
  };
}
import type Token from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type { LineMap, CommentThread, SlimComment } from "../types.js";

export interface CoreRuleOptions {
  lineHighlight?: boolean;
}

export interface ResolvedCommentData {
  lineMap: LineMap;
  comments: SlimComment[];
}

function buildPageLineMap(tokens: Token[]): Map<number, number> {
  const pageLineMap = new Map<number, number>();
  let pageNumber = 0;

  for (const token of tokens) {
    if (token.type !== "marpit_slide_open" || !token.map) {
      continue;
    }

    pageNumber += 1;
    pageLineMap.set(pageNumber, token.map[0] + 1);
  }

  return pageLineMap;
}

function mergePageScopedThreads(
  lineMap: LineMap,
  comments: SlimComment[],
  pageLineMap: Map<number, number>,
): LineMap {
  const merged: LineMap = new Map(
    Array.from(lineMap.entries(), ([line, threads]) => [
      line,
      threads.map((thread) => ({
        comment: thread.comment,
        replies: [...thread.replies],
      })),
    ]),
  );
  const replyMap = new Map<string, SlimComment[]>();

  for (const comment of comments) {
    if (!comment.reply_to) {
      continue;
    }

    const replies = replyMap.get(comment.reply_to) || [];
    replies.push(comment);
    replyMap.set(comment.reply_to, replies);
  }

  for (const comment of comments) {
    const pageNumber = typeof comment.x_page === "number" ? comment.x_page : null;

    if (comment.reply_to || comment.line != null || pageNumber == null) {
      continue;
    }

    const displayLine = pageLineMap.get(pageNumber);
    if (displayLine == null) {
      continue;
    }

    const threadComment: SlimComment = {
      ...comment,
      line: displayLine,
    };
    const threadReplies = (replyMap.get(comment.id) || []).map((reply) => ({
      ...reply,
      line: reply.line ?? displayLine,
    }));
    const threads = merged.get(displayLine) || [];

    threads.push({
      comment: threadComment,
      replies: threadReplies,
    });
    merged.set(displayLine, threads);
  }

  return merged;
}

export function installCoreRule(
  md: { core: { ruler: { push: (name: string, fn: (state: StateCore) => void) => void } } },
  resolveComments: (state: StateCore) => ResolvedCommentData | null,
  options: CoreRuleOptions = {},
): void {
  md.core.ruler.push("mrsf_inject", (state: StateCore) => {
    const result = resolveComments(state);
    if (!result) return;

  const pageLineMap = buildPageLineMap(state.tokens);
  const lineMap = mergePageScopedThreads(result.lineMap, result.comments, pageLineMap);
    const tokens = state.tokens;
    const TokenCtor = state.Token;
    const processed = new Set<number>();

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      const map = token.map;
      if (!map) continue;

      if (token.type === "inline") continue;

      const startLine1 = map[0] + 1;
      const endLine1 = map[1];
      token.attrSet("data-mrsf-line", String(startLine1));
      token.attrSet("data-mrsf-start-line", String(startLine1));
      token.attrSet("data-mrsf-end-line", String(endLine1));

      for (let line0 = map[0]; line0 < map[1]; line0++) {
        const line = line0 + 1;
        if (processed.has(line)) continue;
        processed.add(line);

        const threads = lineMap.get(line);
        if (threads && threads.length > 0) {
          if (options.lineHighlight) {
            const existingClass = token.attrGet("class") || "";
            if (!existingClass.includes("mrsf-line-highlight")) {
              token.attrSet(
                "class",
                existingClass ? `${existingClass} mrsf-line-highlight` : "mrsf-line-highlight",
              );
            }
          }
          token.attrSet("data-mrsf-line", String(line));
        }
      }
    }

    const allThreads: CommentThread[] = [];
    for (const threads of lineMap.values()) {
      allThreads.push(...threads);
    }
    if (allThreads.length > 0) {
      const scriptToken = new TokenCtor("mrsf_data_script", "", 0);
      scriptToken.meta = { threads: allThreads };
      tokens.push(scriptToken);
    }
  });
}
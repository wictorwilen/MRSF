/**
 * MRSF markdown-it plugin — core rule.
 *
 * Walks the parsed token stream and injects `mrsf_badge` tokens
 * at lines that have comments, and wraps `selected_text` matches
 * with `mrsf_highlight_open`/`close` tokens (with tooltip metadata).
 */

import type Token from "markdown-it/lib/token.mjs";
import type { Nesting } from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type { LineMap, CommentThread } from "../types.js";

/** Options forwarded from the plugin to the core rule. */
export interface CoreOptions {
  interactive: boolean;
  gutterPosition: "left" | "tight" | "right";
  gutterForInline: boolean;
  inlineHighlights: boolean;
}

/**
 * Find the token index for a given 1-based source line.
 * markdown-it tokens use `token.map = [startLine, endLine]` (0-based).
 */
function findTokenIndexForLine(
  tokens: Token[],
  line: number,
): number {
  const line0 = line - 1; // convert to 0-based
  for (let i = 0; i < tokens.length; i++) {
    const map = tokens[i].map;
    if (map && map[0] <= line0 && line0 < map[1]) {
      return i;
    }
  }
  return -1;
}

/**
 * Wrap occurrences of `text` inside inline token children with
 * highlight open/close tokens. Stores thread data on the tokens
 * so the renderer can produce an inline tooltip.
 */
function highlightInlineText(
  token: Token,
  thread: CommentThread,
  interactive: boolean,
  Token: new (type: string, tag: string, nesting: Nesting) => Token,
): boolean {
  if (!token.children) return false;

  const text = thread.comment.selected_text;
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  for (let i = 0; i < token.children.length; i++) {
    const child = token.children[i];
    if (child.type !== "text") continue;

    const idx = child.content.indexOf(trimmed);
    if (idx === -1) continue;

    // Split the text token into: before + highlight_open + matched + highlight_close + after
    const newTokens: Token[] = [];

    // Text before match
    if (idx > 0) {
      const before = new Token("text", "", 0);
      before.content = child.content.slice(0, idx);
      newTokens.push(before);
    }

    // Highlight open — carries thread metadata for inline tooltip
    const open = new Token("mrsf_highlight_open", "mark", 1);
    open.attrSet("class", "mrsf-highlight");
    open.attrSet("data-mrsf-comment-id", thread.comment.id);
    open.meta = { thread };
    newTokens.push(open);

    // Matched text
    const matched = new Token("text", "", 0);
    matched.content = trimmed;
    newTokens.push(matched);

    // Highlight close — carries thread metadata for inline tooltip
    const close = new Token("mrsf_highlight_close", "mark", -1);
    close.meta = { thread, interactive };
    newTokens.push(close);

    // Text after match
    if (idx + trimmed.length < child.content.length) {
      const after = new Token("text", "", 0);
      after.content = child.content.slice(idx + trimmed.length);
      newTokens.push(after);
    }

    // Replace the original child with our new tokens
    token.children.splice(i, 1, ...newTokens);
    return true;
  }

  return false;
}

/**
 * Install the MRSF core rule on a markdown-it instance.
 */
export function installCoreRule(
  md: { core: { ruler: { push: (name: string, fn: (state: StateCore) => void) => void } } },
  lineMap: LineMap,
  options: CoreOptions,
): void {
  const { interactive, gutterPosition, gutterForInline, inlineHighlights } = options;

  md.core.ruler.push("mrsf_inject", (state: StateCore) => {
    const tokens = state.tokens;
    const TokenCtor = state.Token;

    // Track which lines we've already processed (to avoid double-injection
    // when multiple tokens share the same source line).
    const processed = new Set<number>();

    // We iterate backwards so that inserting tokens doesn't shift indices
    // for tokens we haven't visited yet.
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      const map = token.map;
      if (!map) continue;

      // Skip inline tokens — they share the same map as their parent block.
      // We must process the parent block (paragraph_open, heading_open, etc.)
      // so the badge and class land on the correct rendered element.
      if (token.type === "inline") continue;

      // Check each line in this token's range for comments
      for (let line0 = map[0]; line0 < map[1]; line0++) {
        const line = line0 + 1; // 1-based
        if (processed.has(line)) continue;

        const threads = lineMap.get(line);
        if (!threads || threads.length === 0) continue;
        processed.add(line);

        // Add line-highlight class to the block token
        const existingClass = token.attrGet("class") || "";
        token.attrSet(
          "class",
          existingClass
            ? `${existingClass} mrsf-line-highlight`
            : "mrsf-line-highlight",
        );
        token.attrSet("data-mrsf-line", String(line));

        // Determine whether all threads on this line have inline highlights
        const allHaveInline = inlineHighlights &&
          threads.every((t) => !!t.comment.selected_text);

        // Inject badge unless gutterForInline is false AND all threads are inline-highlighted
        const showBadge = gutterForInline || !allHaveInline || !inlineHighlights;
        if (showBadge) {
          const badgeToken = new TokenCtor("mrsf_badge", "", 0);
          badgeToken.meta = { line, threads, interactive, gutterPosition };
          tokens.splice(i + 1, 0, badgeToken);
        }

        // Highlight selected_text in the following inline token
        if (inlineHighlights) {
          const offset = showBadge ? 2 : 1;
          const inlineAfter = tokens[i + offset];
          if (inlineAfter && inlineAfter.type === "inline") {
            for (const thread of threads) {
              if (thread.comment.selected_text) {
                highlightInlineText(inlineAfter, thread, interactive, TokenCtor);
              }
            }
          }
        }
      }
    }

    // Wrap the entire output in a gutter container when using left gutter
    if (gutterPosition === "left" && processed.size > 0) {
      const openToken = new TokenCtor("mrsf_gutter_open", "div", 1);
      openToken.attrSet("class", "mrsf-gutter-container");
      tokens.unshift(openToken);
      const closeToken = new TokenCtor("mrsf_gutter_close", "div", -1 as Nesting);
      tokens.push(closeToken);
    }
  });
}

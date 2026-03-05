/**
 * MRSF markdown-it plugin — core rule (overlay gutter architecture).
 *
 * Walks the parsed token stream and annotates block tokens with
 * `data-mrsf-line` attributes. Adds `mrsf-line-highlight` class on
 * commented lines. Appends an `mrsf_data_script` token with serialized
 * comment data for the client-side MrsfController.
 *
 * NO visual tokens are injected — all badges, tooltips, and gutter
 * elements are created at runtime by the controller.
 */

import type Token from "markdown-it/lib/token.mjs";
import type { Nesting } from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type { LineMap, CommentThread } from "../types.js";

/**
 * Install the MRSF core rule on a markdown-it instance.
 */
export function installCoreRule(
  md: { core: { ruler: { push: (name: string, fn: (state: StateCore) => void) => void } } },
  lineMap: LineMap,
): void {
  md.core.ruler.push("mrsf_inject", (state: StateCore) => {
    const tokens = state.tokens;
    const TokenCtor = state.Token;
    const processed = new Set<number>();

    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      const map = token.map;
      if (!map) continue;

      // Skip inline tokens — process their parent block tokens only.
      if (token.type === "inline") continue;

      // Annotate the element with line range
      const startLine1 = map[0] + 1;
      const endLine1 = map[1];
      token.attrSet("data-mrsf-line", String(startLine1));
      token.attrSet("data-mrsf-start-line", String(startLine1));
      token.attrSet("data-mrsf-end-line", String(endLine1));

      // Check each line in this token's range for comments
      for (let line0 = map[0]; line0 < map[1]; line0++) {
        const line = line0 + 1; // 1-based
        if (processed.has(line)) continue;
        processed.add(line);

        const threads = lineMap.get(line);
        if (threads && threads.length > 0) {
          const existingClass = token.attrGet("class") || "";
          if (!existingClass.includes("mrsf-line-highlight")) {
            token.attrSet(
              "class",
              existingClass
                ? `${existingClass} mrsf-line-highlight`
                : "mrsf-line-highlight",
            );
          }
          token.attrSet("data-mrsf-line", String(line));
        }
      }
    }

    // Append a data script token with all comment data
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

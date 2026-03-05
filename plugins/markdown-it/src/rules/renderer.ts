/**
 * MRSF markdown-it plugin — renderer rules (overlay gutter architecture).
 *
 * Adds a single custom renderer rule:
 *   - mrsf_data_script: renders a <script type="application/mrsf+json">
 *     containing serialized comment data for the MrsfController.
 */

import type { CommentThread } from "../types.js";

/**
 * Install MRSF renderer rules on a markdown-it instance.
 */
export function installRendererRules(
  md: { renderer: { rules: Record<string, ((...args: any[]) => string) | undefined> } },
): void {
  md.renderer.rules["mrsf_data_script"] = (
    tokens: { meta: { threads: CommentThread[] } }[],
    idx: number,
  ): string => {
    const { threads } = tokens[idx].meta;
    // Escape < to prevent script tag injection (XSS safety)
    const data = JSON.stringify({ threads }).replace(/</g, "\\u003c");
    return `<script type="application/mrsf+json">${data}</script>`;
  };
}

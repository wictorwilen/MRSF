/**
 * MRSF markdown-it plugin — renderer rules (overlay gutter architecture).
 *
 * Adds a single custom renderer rule:
 *   - mrsf_data_script: renders a <script type="application/mrsf+json">
 *     containing serialized comment data for the MrsfController.
 */

import type { CommentThread } from "../types.js";

export interface RendererRuleOptions {
  dataContainer?: "script" | "element";
  dataElementId?: string;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Install MRSF renderer rules on a markdown-it instance.
 */
export function installRendererRules(
  md: { renderer: { rules: Record<string, ((...args: any[]) => string) | undefined> } },
  options: RendererRuleOptions = {},
): void {
  md.renderer.rules["mrsf_data_script"] = (
    tokens: { meta: { threads: CommentThread[] } }[],
    idx: number,
  ): string => {
    const { threads } = tokens[idx].meta;
    const payload = JSON.stringify({ threads });
    if (options.dataContainer === "element") {
      const elementId = options.dataElementId || "mrsf-comment-data";
      return `<div id="${escapeAttribute(elementId)}" data-mrsf-json="${escapeAttribute(payload)}" aria-hidden="true"></div>`;
    }

    // Escape < to prevent script tag injection (XSS safety)
    const data = payload.replace(/</g, "\\u003c");
    return `<script type="application/mrsf+json">${data}</script>`;
  };
}

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

    const data = payload.replace(/</g, "\\u003c");
    return `<script type="application/mrsf+json">${data}</script>`;
  };
}
/**
 * MRSF rehype plugin — hast element factories (overlay gutter architecture).
 *
 * In the new architecture, the only element we inject into the hast tree
 * is a `<script type="application/mrsf+json">` containing serialized
 * comment data. All visual rendering is done at runtime by MrsfController.
 */

import type { Element } from "hast";
import type { CommentThread } from "./types.js";

/**
 * Create a `<script type="application/mrsf+json">` element containing
 * serialized comment thread data for the MrsfController to consume.
 */
export function createDataScript(threads: CommentThread[]): Element {
  // Escape </ sequences to prevent premature script tag termination (XSS safety)
  const data = JSON.stringify({ threads }).replace(/</g, "\\u003c");
  return {
    type: "element",
    tagName: "script",
    properties: {
      type: "application/mrsf+json",
    },
    children: [{ type: "text", value: data }],
  };
}

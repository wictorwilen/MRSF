/**
 * MRSF rehype plugin — hast tree transformation (overlay gutter architecture).
 *
 * Walks the hast tree and annotates block elements with `data-mrsf-line`
 * attributes. Adds a highlight class on commented lines. Appends a
 * `<script type="application/mrsf+json">` with serialized comment data
 * for the client-side MrsfController to consume.
 *
 * NO visual DOM is injected — all badges, tooltips, and gutter elements
 * are created at runtime by the controller.
 */

import type { Root, Element, ElementContent } from "hast";
import { visit } from "unist-util-visit";
import type { LineMap, CommentThread } from "./types.js";
import { createDataScript } from "./hast-utils.js";

/** Block-level tag names that can carry line-anchored comments. */
const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "blockquote", "pre", "table", "tr",
  "div", "section", "article", "aside",
]);

/**
 * Check whether a hast element's source position spans the given 1-based line.
 */
function elementSpansLine(node: Element, line: number): boolean {
  if (!node.position) return false;
  return node.position.start.line <= line && line <= node.position.end.line;
}

/**
 * Check whether a parent block already covers this node's position,
 * meaning we should skip this node to avoid duplicate annotations.
 */
function coveredByParentBlock(node: Element, parent: any): boolean {
  if (!parent || parent.type !== "element") return false;
  const p = parent as Element;
  if (!BLOCK_TAGS.has(p.tagName)) return false;
  if (!node.position || !p.position) return false;
  const s = node.position.start.line;
  const e = node.position.end.line;
  return p.position.start.line <= s && e <= p.position.end.line;
}

/**
 * Check whether a line is owned by a descendant block element.
 */
function lineOwnedByDescendant(node: Element, line: number): boolean {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (!child.position) continue;
    if (BLOCK_TAGS.has(child.tagName) && elementSpansLine(child, line)) {
      return true;
    }
    if (!BLOCK_TAGS.has(child.tagName) && lineOwnedByDescendant(child, line)) {
      return true;
    }
  }
  return false;
}

/**
 * Add a CSS class to a hast element.
 */
function addClass(node: Element, cls: string): void {
  const existing = node.properties?.className;
  if (Array.isArray(existing)) {
    if (!existing.includes(cls)) existing.push(cls);
  } else if (typeof existing === "string") {
    node.properties!.className = [existing, cls];
  } else {
    node.properties!.className = [cls];
  }
}

export interface TransformOptions {
  /** Whether to add mrsf-line-highlight class on commented elements. Default: false. */
  lineHighlight?: boolean;
}

/**
 * Transform a hast tree: annotate elements with data-mrsf-line and
 * append embedded comment data for the MrsfController.
 */
export function transformTree(
  tree: Root,
  lineMap: LineMap,
  options: TransformOptions = {},
): void {
  const processed = new Set<number>();

  visit(tree, "element", (node: Element, _index, parent) => {
    if (!node.position) return;
    if (!BLOCK_TAGS.has(node.tagName)) return;
    if (coveredByParentBlock(node, parent)) return;
    // Tables can't carry data attributes; let <tr> children handle their rows.
    if (node.tagName === "table") return;
    if (!node.properties) node.properties = {};

    const startLine = node.position.start.line;
    const endLine = node.position.end.line;

    // Annotate the element with line range
    node.properties["data-mrsf-line"] = String(startLine);
    node.properties["data-mrsf-start-line"] = String(startLine);
    node.properties["data-mrsf-end-line"] = String(endLine);

    // Mark lines with comments
    for (let line = startLine; line <= endLine; line++) {
      if (processed.has(line)) continue;
      if (line !== startLine && lineOwnedByDescendant(node, line)) continue;

      const threads = lineMap.get(line);
      if (threads && threads.length > 0 && options.lineHighlight) {
        addClass(node, "mrsf-line-highlight");
      }
      processed.add(line);
    }
  });

  // Collect all threads into a flat array for the data script
  const allThreads: CommentThread[] = [];
  for (const threads of lineMap.values()) {
    allThreads.push(...threads);
  }

  if (allThreads.length > 0) {
    const script = createDataScript(allThreads);
    tree.children.push(script as ElementContent);
  }
}

/**
 * MRSF rehype plugin — hast tree transformation.
 *
 * Walks the hast tree and injects badge elements at commented lines,
 * wraps `selected_text` in `<mark>` highlights, and optionally wraps
 * the whole tree in a gutter container for left gutter mode.
 */

import type { Root, Element, ElementContent, Text } from "hast";
import { visit } from "unist-util-visit";
import type { LineMap, CommentThread } from "./types.js";
import { createBadge, createHighlight, createGutterContainer, createAddControl } from "./hast-utils.js";

/** Options forwarded from the plugin to the transform. */
export interface TransformOptions {
  interactive: boolean;
  gutterPosition: "left" | "tight" | "right";
  gutterForInline: boolean;
  inlineHighlights: boolean;
}

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
  const startLine = node.position.start.line;
  const endLine = node.position.end.line;
  return startLine <= line && line <= endLine;
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

/**
 * Attempt to highlight `selected_text` within an element's text node children.
 * Splits the first matching text node into: before + highlight + after.
 * Returns true if a highlight was inserted.
 */
function highlightTextInChildren(
  node: Element,
  thread: CommentThread,
  interactive: boolean,
): boolean {
  const text = thread.comment.selected_text;
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Search direct children and children of inline elements
  return highlightInNode(node, trimmed, thread, interactive);
}

function highlightInNode(
  parent: Element,
  needle: string,
  thread: CommentThread,
  interactive: boolean,
): boolean {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];

    if (child.type === "text") {
      const idx = child.value.indexOf(needle);
      if (idx === -1) continue;

      const newNodes: ElementContent[] = [];

      // Text before match
      if (idx > 0) {
        newNodes.push({ type: "text", value: child.value.slice(0, idx) });
      }

      // Highlighted match with tooltip
      newNodes.push(createHighlight(needle, thread, interactive));

      // Text after match
      if (idx + needle.length < child.value.length) {
        newNodes.push({ type: "text", value: child.value.slice(idx + needle.length) });
      }

      parent.children.splice(i, 1, ...newNodes);
      return true;
    }

    // Recurse into inline elements (span, strong, em, a, code, etc.)
    if (child.type === "element" && !BLOCK_TAGS.has(child.tagName)) {
      if (highlightInNode(child, needle, thread, interactive)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Transform a hast tree to inject MRSF review comment UI.
 */
export function transformTree(
  tree: Root,
  lineMap: LineMap,
  options: TransformOptions,
): void {
  const { interactive, gutterPosition, gutterForInline, inlineHighlights } = options;
  const processed = new Set<number>();
  let hasComments = false;

  visit(tree, "element", (node: Element, index, parent) => {
    if (!node.position) return;
    if (!BLOCK_TAGS.has(node.tagName)) return;
    if (!node.properties) node.properties = {};

    const startLine = node.position.start.line;
    const endLine = node.position.end.line;

    for (let line = startLine; line <= endLine; line++) {
      if (processed.has(line)) continue;

      const threads = lineMap.get(line);
      const hasThreads = !!threads && threads.length > 0;
      const shouldProcess = hasThreads || interactive; // inject add button even without threads
      if (!shouldProcess) continue;

      processed.add(line);
      if (gutterPosition === "left") {
        hasComments = true; // ensure we wrap for left gutter to position add buttons
      } else if (hasThreads) {
        hasComments = true;
      }

      // Base data attributes for selection capture
      node.properties["data-mrsf-line"] = String(line);

      if (interactive) {
        addClass(node, "mrsf-line-hover-target");
      }

      if (hasThreads && threads) {
        // Add line-highlight class and data attribute
        addClass(node, "mrsf-line-highlight");

        // Determine whether all threads have inline highlights
        const allHaveInline = inlineHighlights &&
          threads.every((t) => !!t.comment.selected_text);

        // Inject badge
        const showBadge = gutterForInline || !allHaveInline || !inlineHighlights;
        if (showBadge) {
          const badge = createBadge(line, threads, interactive, gutterPosition);
          // For tight/left, prepend badge before content; for right, prepend to keep consistent
          if (gutterPosition === "tight" || gutterPosition === "left") {
            node.children.unshift(badge);
          } else {
            node.children.unshift(badge);
          }
        }

        // Highlight selected_text in children
        if (inlineHighlights) {
          for (const thread of threads) {
            if (thread.comment.selected_text) {
              highlightTextInChildren(node, thread, interactive);
            }
          }
        }
      } else if (interactive) {
        // No threads on this line: inject a gutter add control
        const addControl = createAddControl(line, gutterPosition);
        if (gutterPosition === "tight" || gutterPosition === "left") {
          node.children.unshift(addControl);
        } else {
          node.children.unshift(addControl);
        }
      }
    }
  });

  // Wrap in gutter container for left mode
  if (gutterPosition === "left" && hasComments) {
    const container = createGutterContainer([...tree.children] as ElementContent[]);
    tree.children = [container];
  }
}

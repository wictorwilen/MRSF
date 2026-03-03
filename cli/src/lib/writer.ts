/**
 * MRSF Writer — serialize MrsfDocument back to YAML or JSON.
 *
 * Preserves comment order per §10.1.
 * Auto-computes selected_text_hash when selected_text changes.
 */

import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import yaml from "js-yaml";
import type { MrsfDocument, Comment } from "./types.js";

/**
 * Compute SHA-256 hex hash of a string (UTF-8).
 */
export function computeHash(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Ensure selected_text_hash is consistent for a comment.
 * If selected_text is present, computes/updates the hash.
 * If selected_text is absent, removes the hash.
 */
export function syncHash(comment: Comment): Comment {
  if (comment.selected_text != null && comment.selected_text.length > 0) {
    comment.selected_text_hash = computeHash(comment.selected_text);
  } else {
    delete comment.selected_text_hash;
  }
  return comment;
}

/**
 * Serialize an MrsfDocument to YAML.
 */
export function toYaml(doc: MrsfDocument): string {
  return yaml.dump(doc, {
    lineWidth: -1,        // no wrapping
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
    sortKeys: false,      // preserve insertion order
  });
}

/**
 * Serialize an MrsfDocument to JSON.
 */
export function toJson(doc: MrsfDocument): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Write an MrsfDocument to disk. Detects format from file extension.
 */
export async function writeSidecar(
  filePath: string,
  doc: MrsfDocument,
): Promise<void> {
  const abs = path.resolve(filePath);
  const isJson = abs.endsWith(".review.json");

  // Sync hashes for all comments before writing
  for (const comment of doc.comments) {
    syncHash(comment);
  }

  const content = isJson ? toJson(doc) : toYaml(doc);
  await writeFile(abs, content, "utf-8");
}

/**
 * MRSF Parser — load and parse MRSF sidecar files (YAML or JSON).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MrsfDocument } from "./types.js";
import {
  parseSidecarContent,
  parseSidecarContentLenient,
  type LenientParseResult,
} from "./serialize.js";

// Re-exported from the Node-free serialize module so existing
// `@mrsf/cli` import paths keep working.
export {
  parseSidecarContent,
  parseSidecarContentLenient,
} from "./serialize.js";
export type { LenientParseResult } from "./serialize.js";

/**
 * Parse an MRSF sidecar file from disk.
 */
export async function parseSidecar(filePath: string): Promise<MrsfDocument> {
  const abs = path.resolve(filePath);
  const content = await readFile(abs, "utf-8");
  return parseSidecarContent(content, abs);
}

/**
 * Lenient parse: attempts to parse a sidecar file from disk without
 * throwing.  On complete failure, returns `{ doc: null, error }`.
 * On success, returns `{ doc }`.  For partially-corrupted YAML (where
 * the top-level parses but some comments are malformed), attempts to
 * salvage individual well-formed comments.
 */
export async function parseSidecarLenient(
  filePath: string,
): Promise<LenientParseResult> {
  const abs = path.resolve(filePath);
  let content: string;
  try {
    content = await readFile(abs, "utf-8");
  } catch (e) {
    return { doc: null, error: `Cannot read file: ${(e as Error).message}` };
  }

  return parseSidecarContentLenient(content, abs);
}

/**
 * Read a Markdown document from disk and return its lines.
 * Lines are 1-indexed in the returned array (index 0 is unused).
 */
export async function readDocumentLines(
  filePath: string,
): Promise<string[]> {
  const content = await readFile(path.resolve(filePath), "utf-8");
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  // Prepend empty element so lines[1] = first line (1-based)
  return ["", ...lines];
}

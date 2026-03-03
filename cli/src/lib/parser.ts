/**
 * MRSF Parser — load and parse MRSF sidecar files (YAML or JSON).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { MrsfDocument } from "./types.js";

/**
 * Parse an MRSF sidecar file from disk.
 */
export async function parseSidecar(filePath: string): Promise<MrsfDocument> {
  const abs = path.resolve(filePath);
  const content = await readFile(abs, "utf-8");
  return parseSidecarContent(content, abs);
}

/**
 * Parse MRSF sidecar content from a string.
 * Detects JSON vs YAML based on content or optional filename hint.
 */
export function parseSidecarContent(
  content: string,
  filenameHint?: string,
): MrsfDocument {
  const trimmed = content.trim();

  let parsed: unknown;

  // Detect JSON by content or filename
  const isJson =
    trimmed.startsWith("{") ||
    (filenameHint && filenameHint.endsWith(".review.json"));

  if (isJson) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Failed to parse JSON: ${(e as Error).message}`);
    }
  } else {
    try {
      parsed = yaml.load(trimmed);
    } catch (e) {
      throw new Error(`Failed to parse YAML: ${(e as Error).message}`);
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MRSF sidecar must be a YAML/JSON object");
  }

  return parsed as MrsfDocument;
}

/**
 * Read a Markdown document from disk and return its lines.
 * Lines are 1-indexed in the returned array (index 0 is unused).
 */
export async function readDocumentLines(
  filePath: string,
): Promise<string[]> {
  const content = await readFile(path.resolve(filePath), "utf-8");
  const lines = content.split("\n");
  // Prepend empty element so lines[1] = first line (1-based)
  return ["", ...lines];
}

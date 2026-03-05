/**
 * MRSF Discovery — resolve sidecar file paths per §3.3.
 *
 * Discovery order:
 *  1. Check for .mrsf.yaml at repo/workspace root → use sidecar_root if defined.
 *  2. Otherwise, co-located sidecar next to the Markdown file.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { MrsfConfig } from "./types.js";

const CONFIG_FILENAME = ".mrsf.yaml";
const SIDECAR_SUFFIX = ".review.yaml";
const SIDECAR_SUFFIX_JSON = ".review.json";

/**
 * Find the workspace / repo root by walking up from `startDir` looking for
 * `.mrsf.yaml` or `.git`.
 */
export function findWorkspaceRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (
      existsSync(path.join(dir, CONFIG_FILENAME)) ||
      existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(startDir);
}

/**
 * Load and validate .mrsf.yaml config. Returns null if not found.
 */
export async function loadConfig(
  workspaceRoot: string,
  configPath?: string,
): Promise<MrsfConfig | null> {
  const cfgPath = configPath
    ? path.resolve(configPath)
    : path.join(workspaceRoot, CONFIG_FILENAME);

  if (!existsSync(cfgPath)) return null;

  const raw = await readFile(cfgPath, "utf-8");
  const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown> | null;

  if (!parsed || typeof parsed !== "object") return null;

  const config: MrsfConfig = {};

  if (typeof parsed.sidecar_root === "string") {
    const sr = parsed.sidecar_root;

    // Reject absolute paths
    if (path.isAbsolute(sr)) {
      throw new Error(
        `.mrsf.yaml: sidecar_root must be a relative path (got "${sr}")`,
      );
    }

    // Reject path traversal
    if (sr.includes("..")) {
      throw new Error(
        `.mrsf.yaml: sidecar_root must not contain ".." (got "${sr}")`,
      );
    }

    config.sidecar_root = sr;
  }

  return config;
}

/**
 * Given a Markdown document path (relative to workspace root), resolve the
 * sidecar file path according to §3.3 discovery order.
 *
 * Returns an absolute path to the sidecar.
 */
export async function discoverSidecar(
  documentPath: string,
  options: { cwd?: string; configPath?: string } = {},
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const workspaceRoot = findWorkspaceRoot(cwd);
  const config = await loadConfig(workspaceRoot, options.configPath);

  // Normalize to a workspace-relative path
  const relDoc = path.isAbsolute(documentPath)
    ? path.relative(workspaceRoot, documentPath)
    : documentPath;

  if (config?.sidecar_root) {
    // §3.2 — alternate sidecar location
    return path.join(workspaceRoot, config.sidecar_root, relDoc + SIDECAR_SUFFIX);
  }

  // §3.1 — co-located
  return path.join(workspaceRoot, relDoc + SIDECAR_SUFFIX);
}

/**
 * Given a sidecar file path, resolve the Markdown document path.
 * Strips .review.yaml or .review.json suffix.
 * Returns an absolute path to the document.
 */
export function sidecarToDocument(
  sidecarPath: string,
  options: { cwd?: string } = {},
): string {
  const abs = path.resolve(sidecarPath);

  if (abs.endsWith(SIDECAR_SUFFIX)) {
    return abs.slice(0, -SIDECAR_SUFFIX.length);
  } else if (abs.endsWith(SIDECAR_SUFFIX_JSON)) {
    return abs.slice(0, -SIDECAR_SUFFIX_JSON.length);
  }

  return abs;
}

/**
 * Discover all sidecar files in a directory (recursive).
 */
export async function discoverAllSidecars(
  dirPath: string,
): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(full);
      } else if (
        entry.name.endsWith(SIDECAR_SUFFIX) ||
        entry.name.endsWith(SIDECAR_SUFFIX_JSON)
      ) {
        results.push(full);
      }
    }
  }

  const s = await stat(dirPath);
  if (s.isFile()) {
    results.push(path.resolve(dirPath));
  } else {
    await walk(path.resolve(dirPath));
  }

  return results;
}

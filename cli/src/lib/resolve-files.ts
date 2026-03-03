/**
 * Shared helper for resolving CLI file arguments.
 *
 * When a user passes a Markdown document path (e.g. `docs/api.md`) instead of
 * a sidecar path, we auto-discover the corresponding sidecar.  This avoids
 * the confusing "Failed to parse YAML" error on raw Markdown files.
 */

import path from "node:path";
import { discoverSidecar, findWorkspaceRoot, discoverAllSidecars } from "../lib/discovery.js";

const SIDECAR_EXTENSIONS = [".review.yaml", ".review.json"];

function isSidecarPath(file: string): boolean {
  return SIDECAR_EXTENSIONS.some((ext) => file.endsWith(ext));
}

/**
 * Resolve a list of CLI file arguments to sidecar paths.
 *
 * - If `files` is empty, discover all sidecars from the workspace root.
 * - If a file already looks like a sidecar (`.review.yaml`/`.review.json`),
 *   resolve it to an absolute path.
 * - If a file ends in `.md` (or any non-sidecar extension), treat it as a
 *   document path and discover its sidecar via §3.3.
 */
export async function resolveSidecarPaths(
  files: string[],
  cwd: string,
): Promise<string[]> {
  if (files.length === 0) {
    const root = findWorkspaceRoot(cwd);
    return discoverAllSidecars(root ?? cwd);
  }

  const resolved: string[] = [];
  for (const f of files) {
    const abs = path.resolve(cwd, f);
    if (isSidecarPath(abs)) {
      resolved.push(abs);
    } else {
      // Treat as a document path → discover its sidecar
      const sidecar = await discoverSidecar(abs, { cwd });
      resolved.push(sidecar);
    }
  }
  return resolved;
}

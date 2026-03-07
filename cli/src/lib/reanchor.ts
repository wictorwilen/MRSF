/**
 * MRSF Re-anchor Engine — §7.4 Anchoring Resolution Procedure.
 *
 * Implements a four-step algorithm to re-locate each comment's
 * anchor within the current document revision:
 *
 *   Step 0  – diff-based shift (git + commit available)
 *   Step 1  – exact text match
 *   Step 1.5– fuzzy match ≥ high threshold (0.8)
 *   Step 2  – line/column fallback (commit-aware staleness)
 *   Step 3  – lower-threshold fuzzy ≥ configured threshold (0.6)
 *   Step 4  – orphan
 */

import type {
  MrsfDocument,
  ReanchorOptions,
  ReanchorResult,
  DiffHunk,
} from "./types.js";
import {
  findRepoRoot,
  getCurrentCommit,
  getDiff,
  getFileAtCommit,
  getLineShift,
  isGitAvailable,
  parseDiffHunks,
} from "./git.js";
import {
  applyReanchorResults,
  DEFAULT_THRESHOLD,
  reanchorComment,
  reanchorDocumentLines,
} from "./reanchor-core.js";
import { readDocumentLines } from "./parser.js";
import { discoverSidecar, sidecarToDocument } from "./discovery.js";
import { parseSidecar } from "./parser.js";
import { writeSidecar } from "./writer.js";
import path from "node:path";

export {
  applyReanchorResults,
  DEFAULT_THRESHOLD,
  HIGH_THRESHOLD,
  reanchorComment,
  reanchorDocumentLines,
  reanchorDocumentText,
  toReanchorLines,
} from "./reanchor-core.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batch re-anchoring
// ---------------------------------------------------------------------------

/**
 * Re-anchor all comments in an MRSF document.
 */
export async function reanchorDocument(
  doc: MrsfDocument,
  documentLines: string[],
  opts: ReanchorOptions & {
    documentPath?: string;
    repoRoot?: string;
  } = {},
): Promise<ReanchorResult[]> {
  const results: ReanchorResult[] = [];
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  // Determine git context
  let diffHunks: DiffHunk[] | undefined;
  let commitIsStale = false;

  if (!opts.noGit && (await isGitAvailable())) {
    const repoRoot = opts.repoRoot ?? (await findRepoRoot(opts.cwd));
    if (repoRoot && opts.documentPath) {
      const relPath = path.relative(repoRoot, opts.documentPath);
      const head = await getCurrentCommit(repoRoot);

      // Use a shared fromCommit for all comments, or per-comment
      const globalFrom = opts.fromCommit;

      for (const comment of doc.comments) {
        const commentCommit = globalFrom ?? comment.commit;
        if (commentCommit && head && commentCommit !== head) {
          commitIsStale = true;
          // Get diff for this commit range
          const hunks = await getDiff(commentCommit, head, relPath, repoRoot);
          const result = reanchorComment(comment, documentLines, {
            diffHunks: hunks,
            threshold,
            commitIsStale: true,
          });
          results.push(result);
          continue;
        }

        // non-stale or no commit
        results.push(
          reanchorComment(comment, documentLines, { threshold, commitIsStale: false }),
        );
      }

      return results;
    }
  }

  return reanchorDocumentLines(doc, documentLines, { threshold });
}

/**
 * High-level re-anchor for a single sidecar file path.
 */
export async function reanchorFile(
  sidecarPath: string,
  opts: ReanchorOptions = {},
): Promise<{
  results: ReanchorResult[];
  changed: number;
  written: boolean;
}> {
  const doc = await parseSidecar(sidecarPath);
  const docPath = sidecarToDocument(sidecarPath);
  const documentLines = await readDocumentLines(docPath);

  const repoRoot = !opts.noGit ? await findRepoRoot(opts.cwd) : null;
  const headCommit = repoRoot ? await getCurrentCommit(repoRoot) : undefined;

  const results = await reanchorDocument(doc, documentLines, {
    ...opts,
    documentPath: docPath,
    repoRoot: repoRoot ?? undefined,
  });

  let changed = 0;
  let written = false;

  if (!opts.dryRun) {
    changed = applyReanchorResults(doc, results, {
      updateText: opts.updateText,
      force: opts.force,
      headCommit: headCommit ?? undefined,
    });
    if (changed > 0 || opts.autoUpdate) {
      await writeSidecar(sidecarPath, doc);
      written = true;
    }
  }

  return { results, changed, written };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

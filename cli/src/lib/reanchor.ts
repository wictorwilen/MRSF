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
  resolveCommit,
} from "./git.js";
import {
  applyReanchorResults,
  DEFAULT_THRESHOLD,
  reanchorComment,
  reanchorDocumentLines,
  toReanchorLines,
} from "./reanchor-core.js";
import {
  createRevisionProjection,
  type RevisionProjectionIndex,
} from "./revision-projection.js";
import {
  createAnchorContextIndex,
  type AnchorContextIndex,
} from "./anchor-context.js";
import {
  createFuzzySearchIndex,
  type FuzzySearchIndex,
} from "./fuzzy.js";
import { reconcileCommentAnchors } from "./global-reconciliation.js";
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
  resolveAnchor,
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
  const proximityWindow = opts.proximityWindow;
  let fuzzySearchIndex: FuzzySearchIndex | undefined;
  const getFuzzySearchIndex = (): FuzzySearchIndex => {
    fuzzySearchIndex ??= createFuzzySearchIndex(documentLines);
    return fuzzySearchIndex;
  };

  if (!opts.noGit && (await isGitAvailable())) {
    const repoRoot = opts.repoRoot ?? (await findRepoRoot(opts.cwd));
    if (repoRoot && opts.documentPath) {
      const relPath = path.relative(repoRoot, opts.documentPath);
      const head = await getCurrentCommit(repoRoot);

      // Use a shared fromCommit for all comments, or per-comment
      const globalFrom = opts.fromCommit;
      const diffCache = new Map<string, DiffHunk[]>();
      const projectionCache = new Map<
        string,
        RevisionProjectionIndex | undefined
      >();
      const contextCache = new Map<string, AnchorContextIndex | undefined>();
      const canonicalCommitCache = new Map<string, string>();
      const reconciliationGroups = new Map<
        string,
        {
          comments: MrsfDocument["comments"];
          resultIndexes: number[];
          anchorContext: AnchorContextIndex;
        }
      >();

      for (const comment of doc.comments) {
        const rawCommentCommit = globalFrom ?? comment.commit;
        if (rawCommentCommit && head) {
          const cachedCommit = canonicalCommitCache.get(rawCommentCommit);
          const commentCommit = cachedCommit
            ?? await resolveCommit(rawCommentCommit, repoRoot)
            ?? rawCommentCommit;
          if (!cachedCommit) {
            canonicalCommitCache.set(rawCommentCommit, commentCommit);
          }
          if (commentCommit === head) {
            results.push(
              reanchorComment(comment, documentLines, {
                threshold,
                commitIsStale: false,
                proximityWindow,
                getFuzzySearchIndex,
              }),
            );
            continue;
          }
          let hunks = diffCache.get(commentCommit);
          if (!hunks) {
            hunks = await getDiff(commentCommit, head, relPath, repoRoot);
            diffCache.set(commentCommit, hunks);
          }
          let revisionProjection = projectionCache.get(commentCommit);
          let anchorContext = contextCache.get(commentCommit);
          if (!projectionCache.has(commentCommit)) {
            const sourceText = await getFileAtCommit(
              commentCommit,
              relPath,
              repoRoot,
            );
            revisionProjection = sourceText == null
              ? undefined
              : createRevisionProjection(
                toReanchorLines(sourceText),
                documentLines,
              );
            anchorContext = sourceText == null
              ? undefined
              : createAnchorContextIndex(
                toReanchorLines(sourceText),
                documentLines,
              );
            projectionCache.set(commentCommit, revisionProjection);
            contextCache.set(commentCommit, anchorContext);
          }
          const result = reanchorComment(comment, documentLines, {
            diffHunks: hunks,
            threshold,
            commitIsStale: true,
            proximityWindow,
            revisionProjection,
            anchorContext,
            getFuzzySearchIndex,
          });
          const resultIndex = results.length;
          results.push(result);
          if (anchorContext) {
            const group = reconciliationGroups.get(commentCommit);
            if (group) {
              group.comments.push(comment);
              group.resultIndexes.push(resultIndex);
            } else {
              reconciliationGroups.set(commentCommit, {
                comments: [comment],
                resultIndexes: [resultIndex],
                anchorContext,
              });
            }
          }
          continue;
        }

        // non-stale or no commit
        results.push(
          reanchorComment(comment, documentLines, {
            threshold,
            commitIsStale: false,
            proximityWindow,
            getFuzzySearchIndex,
          }),
        );
      }

      for (const group of reconciliationGroups.values()) {
        const reconciled = reconcileCommentAnchors(
          group.comments,
          group.resultIndexes.map((index) => results[index]),
          group.anchorContext,
        );
        for (const [offset, resultIndex] of group.resultIndexes.entries()) {
          results[resultIndex] = reconciled[offset];
        }
      }
      return results;
    }
  }

  return reanchorDocumentLines(doc, documentLines, { threshold, proximityWindow });
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

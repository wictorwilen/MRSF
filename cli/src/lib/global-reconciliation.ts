import {
  findContextAnchorCandidates,
  getAnchorContextScope,
  type AnchorContextIndex,
  type ContextAnchorCandidate,
} from "./anchor-context.js";
import type { Comment, ReanchorResult } from "./types.js";

const LOCAL_LANDMARK_WINDOW = 30;
const MIN_LANDMARK_SUPPORT = 0.65;
const MIN_SUPPORTING_LANDMARKS = 2;
const MIN_GLOBAL_MARGIN = 0.08;
const MAX_RECONCILIATION_ROUNDS = 4;

interface Landmark {
  sourceLine: number;
  targetLine: number;
  scope: string;
}

interface ScoredCandidate {
  candidate: ContextAnchorCandidate;
  globalScore: number;
  support: number;
  supportingLandmarks: number;
}

/**
 * Resolve uncertain comments from nearby high-confidence anchors.
 *
 * Each landmark votes for a local source-to-target displacement rather than
 * global document order, allowing whole sections to move independently.
 * Newly confirmed exact anchors become landmarks in subsequent rounds.
 */
export function reconcileCommentAnchors(
  comments: Comment[],
  results: ReanchorResult[],
  anchorContext: AnchorContextIndex,
): ReanchorResult[] {
  const reconciled = results.map((result) => ({ ...result }));
  if (
    comments.length < MIN_SUPPORTING_LANDMARKS + 1
    || !reconciled.some((result) => result.status === "ambiguous")
  ) {
    return reconciled;
  }
  const resultIndexes = new Map(
    reconciled.map((result, index) => [result.commentId, index]),
  );
  const landmarks = collectLandmarks(comments, reconciled, anchorContext);
  const landmarkCounts = new Map<string, number>();
  for (const landmark of landmarks) {
    landmarkCounts.set(
      landmark.scope,
      (landmarkCounts.get(landmark.scope) ?? 0) + 1,
    );
  }

  for (let round = 0; round < MAX_RECONCILIATION_ROUNDS; round += 1) {
    let changed = false;
    for (const comment of comments) {
      if (comment.line == null || !comment.selected_text) continue;
      const scope = getAnchorContextScope(comment, anchorContext);
      if (scope == null) continue;
      if ((landmarkCounts.get(scope) ?? 0) < MIN_SUPPORTING_LANDMARKS) {
        continue;
      }
      const resultIndex = resultIndexes.get(comment.id);
      if (resultIndex == null) continue;
      const result = reconciled[resultIndex];
      if (result.status !== "ambiguous") continue;

      const candidates = deduplicateCandidates(
        findContextAnchorCandidates(comment, anchorContext),
      ).slice(0, 8);
      if (candidates.length < 2) continue;
      const ranked = candidates
        .map((candidate) =>
          scoreWithLandmarks(
            comment.line as number,
            scope,
            candidate,
            landmarks,
          )
        )
        .sort((left, right) =>
          right.globalScore - left.globalScore
          || right.candidate.score - left.candidate.score
          || left.candidate.line - right.candidate.line
        );
      const best = ranked[0];
      const second = ranked[1];
      if (
        !best.candidate.exact
        || best.supportingLandmarks < MIN_SUPPORTING_LANDMARKS
        || best.support < MIN_LANDMARK_SUPPORT
        || best.globalScore - second.globalScore < MIN_GLOBAL_MARGIN
      ) {
        continue;
      }

      reconciled[resultIndex] = {
        commentId: comment.id,
        status: "anchored",
        score: Math.min(0.99, 0.8 + best.support * 0.19),
        newLine: best.candidate.line,
        newEndLine: best.candidate.endLine,
        newStartColumn: best.candidate.startColumn,
        newEndColumn: best.candidate.endColumn,
        reason:
          `Global reconciliation selected this candidate from `
          + `${best.supportingLandmarks} nearby landmark(s) `
          + `(support ${best.support.toFixed(3)}, margin `
          + `${(best.globalScore - second.globalScore).toFixed(3)}).`,
      };
      changed = true;

      landmarks.push({
        sourceLine: comment.line,
        targetLine: best.candidate.line,
        scope,
      });
      landmarkCounts.set(scope, (landmarkCounts.get(scope) ?? 0) + 1);
    }
    if (!changed) break;
  }

  return reconciled;
}

function collectLandmarks(
  comments: Comment[],
  results: ReanchorResult[],
  anchorContext: AnchorContextIndex,
): Landmark[] {
  const resultMap = new Map(results.map((result) => [result.commentId, result]));
  return comments.flatMap((comment): Landmark[] => {
    const result = resultMap.get(comment.id);
    if (
      comment.line == null
      || result?.newLine == null
      || (result.status !== "anchored" && result.status !== "shifted")
      || result.score < 0.99
    ) {
      return [];
    }
    const scope = getAnchorContextScope(comment, anchorContext);
    return scope == null
      ? []
      : [{ sourceLine: comment.line, targetLine: result.newLine, scope }];
  });
}

function scoreWithLandmarks(
  sourceLine: number,
  scope: string,
  candidate: ContextAnchorCandidate,
  landmarks: Landmark[],
): ScoredCandidate {
  let weightedSupport = 0;
  let totalWeight = 0;
  let supportingLandmarks = 0;
  const candidateShift = candidate.line - sourceLine;

  for (const landmark of landmarks) {
    if (landmark.scope !== scope) continue;
    const sourceDistance = Math.abs(sourceLine - landmark.sourceLine);
    if (sourceDistance === 0 || sourceDistance > LOCAL_LANDMARK_WINDOW) continue;
    const landmarkShift = landmark.targetLine - landmark.sourceLine;
    const shiftError = Math.abs(candidateShift - landmarkShift);
    const agreement = Math.max(0, 1 - shiftError / 8);
    const weight = 1 / (1 + sourceDistance / 4);
    weightedSupport += agreement * weight;
    totalWeight += weight;
    if (agreement >= MIN_LANDMARK_SUPPORT) supportingLandmarks += 1;
  }

  const support = totalWeight > 0 ? weightedSupport / totalWeight : 0;
  return {
    candidate,
    globalScore:
      candidate.score * 0.5 + support * 0.45 + (candidate.exact ? 0.05 : 0),
    support,
    supportingLandmarks,
  };
}

function deduplicateCandidates(
  candidates: ContextAnchorCandidate[],
): ContextAnchorCandidate[] {
  const unique = new Map<string, ContextAnchorCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.line,
      candidate.endLine,
      candidate.startColumn ?? "",
      candidate.endColumn ?? "",
    ].join(":");
    const existing = unique.get(key);
    if (!existing || candidate.score > existing.score) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()].sort((left, right) =>
    right.score - left.score || left.line - right.line
  );
}

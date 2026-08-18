import type { ContextAnchorResolution } from "./anchor-context.js";
import type { ProjectedAnchor } from "./revision-projection.js";
import type { ReanchorResult } from "./types.js";

export type ConfidenceBand =
  | "certain"
  | "probable"
  | "ambiguous"
  | "orphaned";

export interface CalibratedAnchor {
  band: ConfidenceBand;
  result: ReanchorResult;
}

/**
 * Calibrate independent revision and structural evidence into a public result.
 *
 * Exact evidence is certain. Edited anchors are probable only when evidence
 * agrees or one source has a decisive margin; conflicting evidence abstains.
 */
export function calibrateAnchorEvidence(
  commentId: string,
  selectedText: string,
  projected?: ProjectedAnchor,
  contextual?: ContextAnchorResolution,
): CalibratedAnchor | undefined {
  if (projected?.exact) {
    return {
      band: "certain",
      result: projectedResult(commentId, selectedText, projected),
    };
  }
  if (contextual?.status === "anchored") {
    return {
      band: "certain",
      result: contextualResult(commentId, selectedText, contextual),
    };
  }

  if (projected && contextual) {
    if (sameRange(projected, contextual)) {
      const result = contextualResult(commentId, selectedText, contextual);
      result.status = "fuzzy";
      result.score = combineIndependentScores(projected.score, contextual.score);
      result.reason =
        `Probable anchor: revision projection and Markdown context agree `
        + `(confidence ${result.score.toFixed(3)}).`;
      return { band: "probable", result };
    }

    if (contextual.status === "orphaned" && !isStrongProjection(projected)) {
      return {
        band: "orphaned",
        result: contextualResult(commentId, selectedText, contextual),
      };
    }

    if (
      contextual.status === "fuzzy"
      && contextual.candidateMargin >= 0.15
      && contextual.score >= projected.score + 0.1
    ) {
      return {
        band: "probable",
        result: contextualResult(commentId, selectedText, contextual),
      };
    }

    return {
      band: "ambiguous",
      result: {
        commentId,
        status: "ambiguous",
        score: Math.max(projected.score, contextual.score),
        reason:
          `Ambiguous evidence: revision projection points to line `
          + `${projected.line}, while Markdown context points to `
          + `${contextual.line ?? "no location"}.`,
      },
    };
  }

  if (contextual) {
    const band = contextual.status === "orphaned"
      ? "orphaned"
      : contextual.status === "ambiguous"
        ? "ambiguous"
        : "probable";
    return {
      band,
      result: contextualResult(commentId, selectedText, contextual),
    };
  }

  if (projected) {
    if (!isStrongProjection(projected)) return undefined;
    return {
      band: "probable",
      result: projectedResult(commentId, selectedText, projected),
    };
  }

  return undefined;
}

function isStrongProjection(projected: ProjectedAnchor): boolean {
  return projected.contextSupport >= 3
    || (projected.contextSupport >= 2 && projected.contextMargin >= 0.5);
}

function sameRange(
  projected: ProjectedAnchor,
  contextual: ContextAnchorResolution,
): boolean {
  return projected.line === contextual.line
    && projected.endLine === contextual.endLine;
}

function combineIndependentScores(left: number, right: number): number {
  return Math.min(0.95, (left + right) / 2 + 0.05);
}

function projectedResult(
  commentId: string,
  selectedText: string,
  projected: ProjectedAnchor,
): ReanchorResult {
  return {
    commentId,
    status: projected.exact ? "anchored" : "fuzzy",
    score: projected.score,
    newLine: projected.line,
    newEndLine: projected.endLine,
    newStartColumn: projected.startColumn,
    newEndColumn: projected.endColumn,
    anchoredText: projected.exact ? undefined : projected.text,
    previousSelectedText: projected.exact ? undefined : selectedText,
    reason: projected.reason,
  };
}

function contextualResult(
  commentId: string,
  selectedText: string,
  contextual: ContextAnchorResolution,
): ReanchorResult {
  return {
    commentId,
    status: contextual.status,
    score: contextual.score,
    newLine: contextual.line,
    newEndLine: contextual.endLine,
    newStartColumn: contextual.startColumn,
    newEndColumn: contextual.endColumn,
    anchoredText: contextual.status === "fuzzy"
      ? contextual.text
      : undefined,
    previousSelectedText: contextual.status === "fuzzy"
      ? selectedText
      : undefined,
    reason: contextual.reason,
  };
}

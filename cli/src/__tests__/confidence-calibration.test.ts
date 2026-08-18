import { describe, expect, it } from "vitest";
import { calibrateAnchorEvidence } from "../lib/confidence-calibration.js";
import type { ContextAnchorResolution } from "../lib/anchor-context.js";
import type { ProjectedAnchor } from "../lib/revision-projection.js";

function projection(
  overrides: Partial<ProjectedAnchor> = {},
): ProjectedAnchor {
  return {
    line: 10,
    endLine: 10,
    text: "Edited text.",
    score: 0.8,
    exact: false,
    contextSupport: 2,
    contextMargin: 0.5,
    reason: "Projected.",
    ...overrides,
  };
}

function context(
  overrides: Partial<ContextAnchorResolution> = {},
): ContextAnchorResolution {
  return {
    status: "fuzzy",
    score: 0.85,
    line: 10,
    endLine: 10,
    text: "Edited text.",
    candidateMargin: 0.2,
    reason: "Structural.",
    ...overrides,
  };
}

describe("anchor confidence calibration", () => {
  it("classifies agreeing independent evidence as probable", () => {
    const calibrated = calibrateAnchorEvidence(
      "comment",
      "Original text.",
      projection(),
      context(),
    );

    expect(calibrated).toMatchObject({
      band: "probable",
      result: {
        status: "fuzzy",
        newLine: 10,
        score: 0.875,
      },
    });
  });

  it("abstains when revision and structural evidence disagree", () => {
    const calibrated = calibrateAnchorEvidence(
      "comment",
      "Original text.",
      projection({ line: 10, endLine: 10 }),
      context({ line: 30, endLine: 30, candidateMargin: 0.02 }),
    );

    expect(calibrated).toMatchObject({
      band: "ambiguous",
      result: {
        status: "ambiguous",
      },
    });
  });

  it("accepts orphan evidence over a weak projection", () => {
    const calibrated = calibrateAnchorEvidence(
      "comment",
      "Original text.",
      projection({ contextSupport: 1, contextMargin: 0 }),
      context({
        status: "orphaned",
        score: 0,
        line: undefined,
        endLine: undefined,
        text: undefined,
      }),
    );

    expect(calibrated).toMatchObject({
      band: "orphaned",
      result: {
        status: "orphaned",
      },
    });
  });

  it("rejects a weak projection without corroboration", () => {
    expect(calibrateAnchorEvidence(
      "comment",
      "Original text.",
      projection({ contextSupport: 1, contextMargin: 0 }),
    )).toBeUndefined();
  });
});

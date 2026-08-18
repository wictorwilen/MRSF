import { describe, expect, it } from "vitest";
import {
  evaluateReanchorGate,
  type ReanchorGatePolicy,
  type ReanchorProfileReport,
} from "../evaluation/reanchor-gates.js";

const policy: ReanchorGatePolicy = {
  version: 1,
  correctness: {
    small: {
      minimum_pass_rate: 0.8,
      maximum_incorrect_confident_relocations: 0,
    },
  },
  performance: {
    small: {
      maximum_ms_per_comment: 2,
      maximum_p95_comment_ms: 5,
      maximum_single_comment_ms: 100,
      maximum_reconciliation_ms: 50,
    },
  },
};

function report(
  overrides: Partial<ReanchorProfileReport> = {},
): ReanchorProfileReport {
  return {
    profile: "small",
    metrics: {
      passRate: 0.802,
      incorrectConfidentRelocations: 0,
    },
    timingMs: {
      perComment: 0.4,
      p95: 1.5,
      max: 10,
      reconciliationMax: 2,
    },
    ...overrides,
  };
}

describe("reanchoring profile gates", () => {
  it("accepts metrics within correctness and performance limits", () => {
    expect(evaluateReanchorGate(report(), policy, "correctness")).toEqual([]);
    expect(evaluateReanchorGate(report(), policy, "performance")).toEqual([]);
  });

  it("reports correctness regressions without evaluating timing", () => {
    const value = report({
      metrics: {
        passRate: 0.79,
        incorrectConfidentRelocations: 1,
      },
      timingMs: {
        perComment: 20,
        p95: 50,
        max: 500,
        reconciliationMax: 500,
      },
    });

    expect(evaluateReanchorGate(value, policy, "correctness")).toEqual([
      "Pass rate 0.7900 is below 0.8000.",
      "1 incorrect confident relocations exceed the allowed 0.",
    ]);
  });

  it("reports each scheduled performance regression", () => {
    const failures = evaluateReanchorGate(
      report({
        timingMs: {
          perComment: 3,
          p95: 6,
          max: 101,
          reconciliationMax: 51,
        },
      }),
      policy,
      "performance",
    );

    expect(failures).toHaveLength(4);
  });
});

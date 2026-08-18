export type ReanchorGateMode = "correctness" | "performance";

export interface ReanchorProfileReport {
  profile: string;
  metrics: {
    passRate: number;
    incorrectConfidentRelocations: number;
  };
  timingMs: {
    perComment: number;
    p95: number;
    max: number;
  };
}

export interface ReanchorGatePolicy {
  version: 1;
  correctness: Record<
    string,
    {
      minimum_pass_rate: number;
      maximum_incorrect_confident_relocations: number;
    }
  >;
  performance: Record<
    string,
    {
      maximum_ms_per_comment: number;
      maximum_p95_comment_ms: number;
      maximum_single_comment_ms: number;
    }
  >;
}

export function evaluateReanchorGate(
  report: ReanchorProfileReport,
  policy: ReanchorGatePolicy,
  mode: ReanchorGateMode,
): string[] {
  const failures: string[] = [];
  const correctness = policy.correctness[report.profile];
  if (!correctness) {
    failures.push(`No correctness gate configured for profile "${report.profile}".`);
  } else {
    if (report.metrics.passRate < correctness.minimum_pass_rate) {
      failures.push(
        `Pass rate ${report.metrics.passRate.toFixed(4)} is below `
        + `${correctness.minimum_pass_rate.toFixed(4)}.`,
      );
    }
    if (
      report.metrics.incorrectConfidentRelocations
      > correctness.maximum_incorrect_confident_relocations
    ) {
      failures.push(
        `${report.metrics.incorrectConfidentRelocations} incorrect confident `
        + `relocations exceed the allowed `
        + `${correctness.maximum_incorrect_confident_relocations}.`,
      );
    }
  }

  if (mode === "performance") {
    const performance = policy.performance[report.profile];
    if (!performance) {
      failures.push(
        `No performance gate configured for profile "${report.profile}".`,
      );
    } else {
      if (report.timingMs.perComment > performance.maximum_ms_per_comment) {
        failures.push(
          `${report.timingMs.perComment.toFixed(3)} ms/comment exceeds `
          + `${performance.maximum_ms_per_comment.toFixed(3)} ms/comment.`,
        );
      }
      if (report.timingMs.p95 > performance.maximum_p95_comment_ms) {
        failures.push(
          `p95 ${report.timingMs.p95.toFixed(3)} ms exceeds `
          + `${performance.maximum_p95_comment_ms.toFixed(3)} ms.`,
        );
      }
      if (report.timingMs.max > performance.maximum_single_comment_ms) {
        failures.push(
          `maximum ${report.timingMs.max.toFixed(3)} ms exceeds `
          + `${performance.maximum_single_comment_ms.toFixed(3)} ms.`,
        );
      }
    }
  }

  return failures;
}

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { generateEvaluationCases } from "./generate-reanchor-cases.js";
import { evaluateCases, type LoadedEvaluationCase } from "./reanchor-eval.js";

interface WorkloadConfig {
  seed: number;
  case_count: number;
  blocks_per_case: number;
  comments_per_case: number;
  mutations_per_case: number;
}

interface WorkloadFile {
  version: 1;
  profiles: Record<string, WorkloadConfig>;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const workloads = JSON.parse(
    await readFile(path.resolve(options.workloadsPath), "utf8"),
  ) as unknown;
  assertWorkloadFile(workloads);
  const config = workloads.profiles[options.profile];
  if (!config) {
    throw new Error(
      `Unknown workload profile "${options.profile}". Available profiles: `
      + `${Object.keys(workloads.profiles).sort().join(", ")}.`,
    );
  }

  const generated = generateEvaluationCases({
    seed: config.seed,
    caseCount: config.case_count,
    blocksPerCase: config.blocks_per_case,
    commentsPerCase: config.comments_per_case,
    mutationsPerCase: config.mutations_per_case,
  });
  const cases: LoadedEvaluationCase[] = generated.map((value) => ({
    casePath: `<generated:${value.id}>`,
    value,
  }));
  const summary = await evaluateCases(cases);
  const report = {
    profile: options.profile,
    config,
    metrics: {
      cases: summary.cases,
      comments: summary.comments,
      passed: summary.passed,
      failed: summary.failed,
      passRate: summary.comments > 0
        ? summary.passed / summary.comments
        : 0,
      incorrectConfidentRelocations: summary.incorrectConfidentRelocations,
    },
    timingMs: {
      total: summary.durationMs,
      ...summary.timingMs,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Reanchoring workload: ${options.profile}`);
    console.log(
      `${report.metrics.cases} cases, ${report.metrics.comments} comments, `
      + `${report.metrics.passed} passed, ${report.metrics.failed} failed`,
    );
    console.log(
      `${report.metrics.incorrectConfidentRelocations} incorrect confident relocations`,
    );
    console.log(
      `Timing: ${report.timingMs.total.toFixed(2)} ms total, `
      + `${report.timingMs.perComment.toFixed(3)} ms/comment, `
      + `${report.timingMs.p95.toFixed(3)} ms p95`,
    );
  }
}

function parseArguments(args: string[]): {
  profile: string;
  workloadsPath: string;
  json: boolean;
} {
  let profile = "small";
  let workloadsPath = "../evaluation/reanchor/workloads.json";
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--profile" && args[index + 1]) {
      profile = args[index += 1];
    } else if (argument === "--workloads" && args[index + 1]) {
      workloadsPath = args[index += 1];
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  return { profile, workloadsPath, json };
}

function assertWorkloadFile(value: unknown): asserts value is WorkloadFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.profiles)) {
    throw new Error("Workload file must contain version 1 and a profiles object.");
  }

  for (const [name, profile] of Object.entries(value.profiles)) {
    if (
      !isRecord(profile)
      || !isNonNegativeInteger(profile.seed)
      || !isPositiveInteger(profile.case_count)
      || !isPositiveInteger(profile.blocks_per_case)
      || !isPositiveInteger(profile.comments_per_case)
      || !isPositiveInteger(profile.mutations_per_case)
    ) {
      throw new Error(`Workload profile "${name}" is invalid.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

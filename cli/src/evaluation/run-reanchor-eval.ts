#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import {
  createEvaluationBaseline,
  evaluateCases,
  findBaselineDifferences,
  loadEvaluationCases,
  type EvaluationBaseline,
} from "./reanchor-eval.js";

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const casesPath = path.resolve(options.casesPath);
  const schemaPath = path.resolve(options.schemaPath);
  const cases = await loadEvaluationCases(casesPath, schemaPath);
  const summary = await evaluateCases(cases);
  const baseline = createEvaluationBaseline(summary);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printSummary(summary);
  }

  if (options.writeBaselinePath) {
    await writeFile(
      path.resolve(options.writeBaselinePath),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    return;
  }

  if (options.baselinePath) {
    const expected = JSON.parse(
      await readFile(path.resolve(options.baselinePath), "utf8"),
    ) as EvaluationBaseline;
    const differences = findBaselineDifferences(expected, baseline);
    if (differences.length > 0) {
      for (const difference of differences) {
        console.error(`BASELINE ${difference}`);
      }
      process.exitCode = 1;
    } else if (!options.json) {
      console.log("Baseline matches.");
    }
  } else if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

function parseArguments(args: string[]): {
  casesPath: string;
  schemaPath: string;
  json: boolean;
  baselinePath?: string;
  writeBaselinePath?: string;
} {
  let casesPath = "../evaluation/reanchor/cases";
  let schemaPath = "../evaluation/reanchor/schema.json";
  let json = false;
  let baselinePath: string | undefined;
  let writeBaselinePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--cases" && args[index + 1]) {
      casesPath = args[index += 1];
    } else if (argument === "--schema" && args[index + 1]) {
      schemaPath = args[index += 1];
    } else if (argument === "--baseline" && args[index + 1]) {
      baselinePath = args[index += 1];
    } else if (argument === "--write-baseline" && args[index + 1]) {
      writeBaselinePath = args[index += 1];
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (baselinePath && writeBaselinePath) {
    throw new Error("--baseline and --write-baseline cannot be used together.");
  }

  return {
    casesPath,
    schemaPath,
    json,
    baselinePath,
    writeBaselinePath,
  };
}

function printSummary(summary: Awaited<ReturnType<typeof evaluateCases>>): void {
  const passRate = summary.comments === 0
    ? 0
    : (summary.passed / summary.comments) * 100;

  console.log(`Reanchoring evaluation (${summary.algorithm})`);
  console.log(`Cases: ${summary.cases}`);
  console.log(`Comments: ${summary.comments}`);
  console.log(`Passed: ${summary.passed}/${summary.comments} (${passRate.toFixed(1)}%)`);
  console.log(`Status matches: ${summary.statusMatches}/${summary.comments}`);
  console.log(`Exact range matches: ${summary.exactRangeMatches}/${summary.comments}`);
  console.log(`Incorrect confident relocations: ${summary.incorrectConfidentRelocations}`);
  console.log(`Duration: ${summary.durationMs.toFixed(2)} ms`);
  console.log(
    `Per-comment timing: median ${summary.timingMs.median.toFixed(3)} ms, `
    + `p95 ${summary.timingMs.p95.toFixed(3)} ms, `
    + `max ${summary.timingMs.max.toFixed(3)} ms`,
  );

  for (const result of summary.results.filter((item) => !item.passed)) {
    console.log(
      `FAIL ${result.caseId}/${result.commentId}: expected ${result.expected.status}, `
      + `received ${result.actual.status} (${result.actual.reason})`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { generateEvaluationCases } from "./generate-reanchor-cases.js";

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const outputPath = path.resolve(options.output);
  const cases = generateEvaluationCases(options);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(
    `Generated ${cases.length} reanchoring cases at ${outputPath} `
    + `(seeds ${options.seed}-${options.seed + cases.length - 1}).`,
  );
}

function parseArguments(args: string[]): {
  seed: number;
  caseCount: number;
  blocksPerCase: number;
  commentsPerCase: number;
  mutationsPerCase: number;
  output: string;
} {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value == null) {
      throw new Error(`Unknown or incomplete argument: ${name ?? ""}`);
    }
    values.set(name, value);
  }

  const supported = new Set([
    "--seed",
    "--cases",
    "--blocks",
    "--comments",
    "--mutations",
    "--output",
  ]);
  for (const name of values.keys()) {
    if (!supported.has(name)) throw new Error(`Unknown argument: ${name}`);
  }

  const seed = integerArgument(values, "--seed", 1);
  return {
    seed,
    caseCount: integerArgument(values, "--cases", 10),
    blocksPerCase: integerArgument(values, "--blocks", 12),
    commentsPerCase: integerArgument(values, "--comments", 4),
    mutationsPerCase: integerArgument(values, "--mutations", 5),
    output: values.get("--output")
      ?? `../evaluation/reanchor/generated/seed-${seed}.json`,
  };
}

function integerArgument(
  values: Map<string, string>,
  name: string,
  fallback: number,
): number {
  const raw = values.get(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

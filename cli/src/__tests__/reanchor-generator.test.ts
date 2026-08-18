import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateEvaluationCases } from "../evaluation/generate-reanchor-cases.js";
import { loadEvaluationCases } from "../evaluation/reanchor-eval.js";

describe("reanchoring mutation generator", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("reproduces identical cases from the same seed", () => {
    const options = {
      seed: 42,
      caseCount: 5,
      blocksPerCase: 10,
      commentsPerCase: 4,
      mutationsPerCase: 6,
    };

    expect(generateEvaluationCases(options)).toEqual(
      generateEvaluationCases(options),
    );
  });

  it("produces different cases from different seeds", () => {
    const first = generateEvaluationCases({ seed: 42, caseCount: 1 });
    const second = generateEvaluationCases({ seed: 43, caseCount: 1 });

    expect(first).not.toEqual(second);
  });

  it("records each seed and applied mutation sequence", () => {
    const cases = generateEvaluationCases({
      seed: 100,
      caseCount: 3,
      mutationsPerCase: 7,
    });

    expect(cases.map((item) => item.generation?.seed)).toEqual([100, 101, 102]);
    expect(cases.every(
      (item) => item.generation?.generator_version === 1,
    )).toBe(true);
    expect(cases.every(
      (item) => item.generation?.blocks_per_case === 12,
    )).toBe(true);
    expect(cases.every(
      (item) => item.generation?.comments_per_case === 4,
    )).toBe(true);
    expect(cases.every(
      (item) => item.generation?.operations.length === 7,
    )).toBe(true);
  });

  it("emits cases accepted by the shared schema", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mrsf-generated-"));
    tempDirectories.push(directory);
    const casesPath = path.join(directory, "cases");
    await mkdir(casesPath);
    await writeFile(
      path.join(casesPath, "generated.json"),
      JSON.stringify(generateEvaluationCases({
        seed: 1234,
        caseCount: 20,
        mutationsPerCase: 8,
      })),
    );

    const loaded = await loadEvaluationCases(
      casesPath,
      fileURLToPath(new URL(
        "../../../evaluation/reanchor/schema.json",
        import.meta.url,
      )),
    );

    expect(loaded).toHaveLength(20);
  });

  it("rejects invalid generator bounds", () => {
    expect(() => generateEvaluationCases({
      seed: -1,
    })).toThrow("seed must be an integer between 0 and 4294967295");
    expect(() => generateEvaluationCases({
      seed: 1,
      commentsPerCase: 0,
    })).toThrow("commentsPerCase must be a positive integer");
  });
});

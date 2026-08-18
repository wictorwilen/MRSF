import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateCases,
  loadEvaluationCases,
  type LoadedEvaluationCase,
} from "../evaluation/reanchor-eval.js";

describe("reanchoring evaluation", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  });

  it("scores an exact relocation against an acceptable range", async () => {
    const cases: LoadedEvaluationCase[] = [
      {
        casePath: "/tmp/exact-relocation.json",
        value: {
          id: "exact-relocation",
          categories: ["move"],
          source: { text: "Selected text\n" },
          target: { text: "Inserted\nSelected text\n" },
          comments: [
            {
              id: "comment-1",
              anchor: {
                line: 1,
                start_column: 0,
                end_column: 13,
                selected_text: "Selected text",
              },
              expected: {
                status: "anchored",
                ranges: [
                  {
                    line: 2,
                    end_line: 2,
                    start_column: 0,
                    end_column: 13,
                  },
                ],
              },
            },
          ],
        },
      },
    ];

    const summary = await evaluateCases(cases);

    expect(summary.comments).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.incorrectConfidentRelocations).toBe(0);
  });

  it("counts a wrong confident result as a safety failure", async () => {
    const cases: LoadedEvaluationCase[] = [
      {
        casePath: "/tmp/wrong-location.json",
        value: {
          id: "wrong-location",
          categories: ["adversarial"],
          source: { text: "Repeated text\n" },
          target: { text: "Repeated text\n" },
          comments: [
            {
              id: "comment-1",
              anchor: {
                line: 1,
                selected_text: "Repeated text",
              },
              expected: {
                status: "anchored",
                ranges: [{ line: 99 }],
              },
            },
          ],
        },
      },
    ];

    const summary = await evaluateCases(cases);

    expect(summary.failed).toBe(1);
    expect(summary.incorrectConfidentRelocations).toBe(1);
  });

  it("does not count a correct range with a status mismatch as a relocation", async () => {
    const cases: LoadedEvaluationCase[] = [
      {
        casePath: "/tmp/status-mismatch.json",
        value: {
          id: "status-mismatch",
          categories: ["confidence"],
          source: { text: "Selected text\n" },
          target: { text: "Selected text\n" },
          comments: [{
            id: "comment-1",
            anchor: { line: 1, selected_text: "Selected text" },
            expected: { status: "fuzzy", ranges: [{ line: 1 }] },
          }],
        },
      },
    ];

    const summary = await evaluateCases(cases);

    expect(summary.failed).toBe(1);
    expect(summary.incorrectConfidentRelocations).toBe(0);
  });

  it("loads multiple cases from one corpus file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mrsf-eval-"));
    tempDirectories.push(directory);
    const casesPath = path.join(directory, "cases");
    await mkdir(casesPath);
    const fixture = (id: string) => ({
      id,
      categories: ["smoke"],
      source: { text: "text" },
      target: { text: "text" },
      comments: [{
        id: `${id}-comment`,
        anchor: { line: 1, selected_text: "text" },
        expected: { status: "anchored", ranges: [{ line: 1 }] },
      }],
    });
    await writeFile(
      path.join(casesPath, "suite.json"),
      JSON.stringify([fixture("first-case"), fixture("second-case")]),
    );

    const cases = await loadEvaluationCases(
      casesPath,
      fileURLToPath(new URL("../../../evaluation/reanchor/schema.json", import.meta.url)),
    );

    expect(cases.map((item) => item.value.id)).toEqual([
      "first-case",
      "second-case",
    ]);
  });

  it("validates the shared diagnostic corpus", async () => {
    const cases = await loadEvaluationCases(
      fileURLToPath(new URL(
        "../../../evaluation/reanchor/cases",
        import.meta.url,
      )),
      fileURLToPath(new URL(
        "../../../evaluation/reanchor/schema.json",
        import.meta.url,
      )),
    );

    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(cases.map((item) => item.value.id)).size).toBe(cases.length);
  });
});

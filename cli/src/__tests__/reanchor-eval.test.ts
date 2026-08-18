import { describe, expect, it } from "vitest";
import {
  evaluateCases,
  type LoadedEvaluationCase,
} from "../evaluation/reanchor-eval.js";

describe("reanchoring evaluation", () => {
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
});

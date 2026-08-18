import { describe, expect, it } from "vitest";
import {
  createAnchorContextIndex,
  resolveContextAnchor,
} from "../lib/anchor-context.js";
import type { Comment } from "../lib/types.js";

function lines(...values: string[]): string[] {
  return ["", ...values];
}

function comment(overrides: Partial<Comment>): Comment {
  return {
    id: "comment",
    author: "tester",
    timestamp: "2025-01-01T00:00:00Z",
    text: "Review this",
    resolved: false,
    ...overrides,
  };
}

describe("Markdown anchor context", () => {
  it("uses directional context to prefer a rewritten original over a copy", () => {
    const index = createAnchorContextIndex(
      lines("Original phrase.", "", "Supporting context."),
      lines(
        "Revised original phrase.",
        "",
        "Supporting context.",
        "",
        "Original phrase.",
      ),
    );

    expect(resolveContextAnchor(
      comment({ line: 1, selected_text: "Original phrase." }),
      index,
    )).toMatchObject({
      status: "fuzzy",
      line: 1,
    });
  });

  it("matches a renamed heading from its parent and neighbors", () => {
    const index = createAnchorContextIndex(
      lines(
        "## Components",
        "",
        "### Dispatcher",
        "",
        "The dispatcher assigns each job.",
      ),
      lines(
        "## Components",
        "",
        "### Scheduler",
        "",
        "The scheduler assigns each job.",
      ),
    );

    expect(resolveContextAnchor(
      comment({ line: 3, selected_text: "### Dispatcher" }),
      index,
    )).toMatchObject({
      status: "fuzzy",
      line: 3,
    });
  });

  it("resolves a paragraph split across adjacent blocks", () => {
    const index = createAnchorContextIndex(
      lines("First idea continues into the second idea."),
      lines("First idea continues.", "", "The second idea follows."),
    );

    expect(resolveContextAnchor(
      comment({
        line: 1,
        selected_text: "First idea continues into the second idea.",
      }),
      index,
    )).toMatchObject({
      status: "fuzzy",
      line: 1,
      endLine: 3,
    });
  });

  it("marks a deleted block as orphaned", () => {
    const index = createAnchorContextIndex(
      lines("Selected paragraph that was deleted."),
      lines("Unrelated replacement."),
    );

    expect(resolveContextAnchor(
      comment({
        line: 1,
        selected_text: "Selected paragraph that was deleted.",
      }),
      index,
    )).toMatchObject({
      status: "orphaned",
    });
  });

  it("tracks an edited inline selection through its containing block", () => {
    const index = createAnchorContextIndex(
      lines("The source is primary.", "", "Another source exists."),
      lines("The origin is primary.", "", "Another source exists."),
    );

    expect(resolveContextAnchor(
      comment({
        line: 1,
        start_column: 4,
        end_column: 10,
        selected_text: "source",
      }),
      index,
    )).toMatchObject({
      status: "fuzzy",
      line: 1,
      startColumn: 4,
      endColumn: 10,
      text: "origin",
    });
  });

  it("does not mark a repeated relocated exact selection as fully anchored", () => {
    const index = createAnchorContextIndex(
      lines("Selected text.", "", "Original context."),
      lines(
        "Revised text.",
        "",
        "Original context.",
        "",
        "Selected text.",
        "",
        "Selected text.",
      ),
    );

    expect(resolveContextAnchor(
      comment({ line: 1, selected_text: "Selected text." }),
      index,
    )?.status).not.toBe("anchored");
  });

  it("retrieves a rewritten moved block from directional neighbor evidence", () => {
    const decoys = Array.from(
      { length: 200 },
      (_, index) => [`Unrelated paragraph ${index}.`, ""],
    ).flat();
    const index = createAnchorContextIndex(
      lines(
        "Stable context before.",
        "",
        "The dispatcher assigns each incoming job.",
        "",
        "Stable context after.",
      ),
      lines(
        ...decoys,
        "Stable context before.",
        "",
        "The scheduler routes every incoming task.",
        "",
        "Stable context after.",
      ),
    );

    expect(resolveContextAnchor(
      comment({
        line: 3,
        selected_text: "The dispatcher assigns each incoming job.",
      }),
      index,
    )).toMatchObject({
      status: "fuzzy",
      line: 403,
    });
  });
});

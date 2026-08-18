import { describe, expect, it } from "vitest";
import {
  createRevisionProjection,
  projectCommentAnchor,
} from "../lib/revision-projection.js";
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

describe("revision projection", () => {
  it("confirms a far exact move from neighboring line evidence", () => {
    const source = lines(
      "## Alpha",
      "Selected statement.",
      "Supporting context.",
      "## Beta",
    );
    const target = lines(
      "## Beta",
      "Other content.",
      "More content.",
      "## Alpha",
      "Selected statement.",
      "Supporting context.",
    );
    const projection = createRevisionProjection(source, target);

    const result = projectCommentAnchor(
      comment({ line: 2, selected_text: "Selected statement." }),
      projection,
      0.6,
    );

    expect(result).toMatchObject({
      line: 5,
      exact: true,
      score: 1,
    });
  });

  it("rejects a copied exact selection when context points to its rewrite", () => {
    const source = lines(
      "Selected statement.",
      "Supporting context.",
    );
    const target = lines(
      "Revised selected statement.",
      "Supporting context.",
      "Selected statement.",
    );
    const projection = createRevisionProjection(source, target);

    const result = projectCommentAnchor(
      comment({ line: 1, selected_text: "Selected statement." }),
      projection,
      0.6,
    );

    expect(result).toBeUndefined();
  });

  it("projects edited text from a nearby unchanged line", () => {
    const source = lines(
      "## Scaling",
      "Workers scale from queue depth and processing latency.",
      "Stable trailing context.",
    );
    const target = lines(
      "Other section.",
      "Other content.",
      "## Scaling",
      "Workers scale from queue depth, latency, and lease pressure.",
      "Stable trailing context.",
    );
    const projection = createRevisionProjection(source, target);

    const result = projectCommentAnchor(
      comment({
        line: 2,
        selected_text: "Workers scale from queue depth and processing latency.",
      }),
      projection,
      0.6,
    );

    expect(result).toMatchObject({
      line: 4,
      exact: false,
    });
    expect(result?.score).toBeGreaterThan(0.6);
  });

  it("does not project when the source position contradicts selected_text", () => {
    const projection = createRevisionProjection(
      lines("Different source text."),
      lines("Selected statement."),
    );

    expect(projectCommentAnchor(
      comment({ line: 1, selected_text: "Selected statement." }),
      projection,
      0.6,
    )).toBeUndefined();
  });
});

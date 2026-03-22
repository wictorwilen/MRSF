import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/prose/model";
import { buildInlineDecorations } from "../core/decorations.js";
import type { DecorationSnapshot } from "../types.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
    },
  },
  marks: {},
});

function makeDoc(text: string) {
  return schema.node("doc", undefined, [schema.node("paragraph", undefined, [schema.text(text)])]);
}

function makeSnapshot(startColumn = 0, endColumn = 5): DecorationSnapshot {
  return {
    threadsByLine: [],
    gutterMarks: [],
    inlineRanges: [{
      commentId: "c1",
      line: 1,
      selectedText: "alpha",
      resolved: false,
      severity: "medium",
      range: {
        start: { lineIndex: 0, column: startColumn },
        end: { lineIndex: 0, column: endColumn },
      },
    }],
    hoverTargets: [],
    documentLevelCommentIds: [],
    orphanedCommentIds: [],
  };
}

describe("decorations", () => {
  it("returns empty decorations when there is no snapshot, no inline ranges, or inline highlights are disabled", () => {
    const doc = makeDoc("alpha");

    expect(buildInlineDecorations(doc, null, "alpha").find()).toEqual([]);
    expect(buildInlineDecorations(doc, { ...makeSnapshot(), inlineRanges: [] }, "alpha").find()).toEqual([]);
    expect(buildInlineDecorations(doc, makeSnapshot(), "alpha", { inlineHighlights: false }).find()).toEqual([]);
  });

  it("skips invalid ranges and builds decorations for valid ranges", () => {
    const doc = makeDoc("alpha");

    expect(buildInlineDecorations(doc, makeSnapshot(3, 3), "alpha").find()).toEqual([]);
    expect(buildInlineDecorations(doc, makeSnapshot(6, 7), "alpha").find()).toEqual([]);

    const decorations = buildInlineDecorations(doc, makeSnapshot(0, 5), "alpha").find();
    expect(decorations).toHaveLength(1);
    expect(decorations[0]?.from).toBeLessThan(decorations[0]?.to ?? 0);
  });
});
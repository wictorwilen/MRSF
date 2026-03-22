import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/prose/model";
import { TextSelection } from "@milkdown/prose/state";
import {
  diffTextChange,
  getDocumentText,
  getSelectedText,
  offsetToPoint,
  pmPosToTextOffset,
  pointToOffset,
  selectionToEditorSelection,
  textOffsetToPmPos,
} from "../core/textModel.js";

const tableSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
    },
    table: {
      group: "block",
      content: "tableRow+",
      toDOM: () => ["table", ["tbody", 0]],
    },
    tableRow: {
      content: "tableCell+",
      toDOM: () => ["tr", 0],
    },
    tableCell: {
      content: "block+",
      toDOM: () => ["td", 0],
    },
  },
  marks: {},
});

function createTableDoc() {
  return tableSchema.node("doc", undefined, [
    tableSchema.node("table", undefined, [
      tableSchema.node("tableRow", undefined, [
        tableSchema.node("tableCell", undefined, [tableSchema.node("paragraph", undefined, [tableSchema.text("A1")])]),
        tableSchema.node("tableCell", undefined, [tableSchema.node("paragraph", undefined, [tableSchema.text("B1")])]),
      ]),
      tableSchema.node("tableRow", undefined, [
        tableSchema.node("tableCell", undefined, [tableSchema.node("paragraph", undefined, [tableSchema.text("A2")])]),
        tableSchema.node("tableCell", undefined, [tableSchema.node("paragraph", undefined, [tableSchema.text("B2")])]),
      ]),
    ]),
  ]);
}

function findTextNodePos(doc: ReturnType<typeof createTableDoc>, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      found = pos;
      return false;
    }

    return undefined;
  });

  if (found === -1) {
    throw new Error(`Missing text node '${text}'.`);
  }

  return found;
}

describe("textModel", () => {
  it("converts offsets to line and column points", () => {
    const text = "alpha\nbeta\ngamma";
    expect(offsetToPoint(0, text)).toEqual({ lineIndex: 0, column: 0 });
    expect(offsetToPoint(7, text)).toEqual({ lineIndex: 1, column: 1 });
    expect(pointToOffset({ lineIndex: 2, column: 2 }, text)).toBe(13);
  });

  it("creates a contiguous text change diff", () => {
    const before = "alpha\nbeta\ngamma";
    const after = "alpha\nbetter\ngamma";
    expect(diffTextChange(before, after)).toEqual([
      {
        range: {
          start: { lineIndex: 1, column: 3 },
          end: { lineIndex: 1, column: 4 },
        },
        text: "ter",
      },
    ]);
  });

  it("serializes tables as tab-separated rows", () => {
    expect(getDocumentText(createTableDoc())).toBe("A1\tB1\nA2\tB2");
  });

  it("maps table positions through the structural text model", () => {
    const doc = createTableDoc();
    const b1Pos = findTextNodePos(doc, "B1");
    expect(pmPosToTextOffset(doc, b1Pos)).toBe(3);
    expect(textOffsetToPmPos(doc, 3)).toBe(b1Pos);
  });

  it("derives selections correctly inside tables", () => {
    const doc = createTableDoc();
    const b1Pos = findTextNodePos(doc, "B1");
    const selection = TextSelection.create(doc, b1Pos, b1Pos + 2);

    expect(selectionToEditorSelection(selection, doc)).toEqual({
      start: { lineIndex: 0, column: 3 },
      end: { lineIndex: 0, column: 5 },
    });

    expect(getSelectedText({ selection, doc } as never)).toBe("B1");
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, EventEmitter, Position, Range, Selection, ThemeColor, Uri } from "vscode";

const mockEditorRangeToVscodeRange = vi.fn();
const mockBuildReviewSnapshot = vi.fn();
const mockToCommentMap = vi.fn();

vi.mock("../../util/positions.js", () => ({
  editorRangeToVscodeRange: (...args: unknown[]) => mockEditorRangeToVscodeRange(...args),
}));

vi.mock("../../util/reviewSnapshot.js", () => ({
  buildReviewSnapshot: (...args: unknown[]) => mockBuildReviewSnapshot(...args),
  toCommentMap: (...args: unknown[]) => mockToCommentMap(...args),
}));

import { InlineDecorationProvider } from "../../decorations/InlineDecorationProvider.js";

function makeEditor(uri: Uri) {
  return {
    document: {
      uri,
      languageId: "markdown",
      lineCount: 4,
      lineAt: (line: number) => ({ text: ["alpha", "beta", "gamma", "delta"][line] ?? "" }),
    },
    selection: new Selection(new Position(0, 0), new Position(0, 0)),
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
  };
}

describe("InlineDecorationProvider", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    __mock.configuration.set("sidemark.inlineHighlights", true);
    __mock.configuration.set("sidemark.showResolved", true);
    mockEditorRangeToVscodeRange.mockImplementation(
      (range: any) => new Range(range.start.lineIndex, range.start.column, range.end.lineIndex, range.end.column),
    );
  });

  it("creates the expected inline decoration types", () => {
    const store = { onDidChange: vi.fn().mockReturnValue(new vscode.Disposable()) };

    new InlineDecorationProvider(store as never);

    expect(__mock.decorations).toHaveLength(3);
    expect(__mock.decorations[0]?.options).toMatchObject({
      backgroundColor: new ThemeColor("diffEditor.insertedTextBackground"),
      borderColor: new ThemeColor("editorInfo.foreground"),
      isWholeLine: false,
    });
  });

  it("applies open, resolved, and orphaned inline highlights", () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeEditor(uri);
    const doc = { comments: [{ id: "open" }, { id: "resolved" }, { id: "orphaned" }] };
    const storeChange = new EventEmitter<Uri>();
    const store = {
      onDidChange: vi.fn().mockImplementation(storeChange.event),
      get: vi.fn().mockReturnValue(doc),
    };
    mockBuildReviewSnapshot.mockReturnValue({
      inlineRanges: [
        { commentId: "open", resolved: false, range: { start: { lineIndex: 0, column: 0 }, end: { lineIndex: 0, column: 5 } } },
        { commentId: "resolved", resolved: true, range: { start: { lineIndex: 1, column: 0 }, end: { lineIndex: 1, column: 4 } } },
        { commentId: "orphaned", resolved: false, range: { start: { lineIndex: 2, column: 1 }, end: { lineIndex: 2, column: 3 } } },
      ],
    });
    mockToCommentMap.mockReturnValue(new Map([
      ["open", { id: "open" }],
      ["resolved", { id: "resolved" }],
      ["orphaned", { id: "orphaned", x_reanchor_status: "orphaned" }],
    ]));

    const provider = new InlineDecorationProvider(store as never);
    provider.update(editor as never);

    expect(mockBuildReviewSnapshot).toHaveBeenCalledWith(editor.document, doc, true);
    expect(editor.setDecorations).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(editor.setDecorations).mock.calls;
    expect(calls[0]?.[1]).toEqual([{ range: new Range(0, 0, 0, 5) }]);
    expect(calls[1]?.[1]).toEqual([{ range: new Range(1, 0, 1, 4) }]);
    expect(calls[2]?.[1]).toEqual([{ range: new Range(2, 1, 2, 3) }]);

    vscode.window.activeTextEditor = editor as never;
    storeChange.fire(uri);
    expect(editor.setDecorations).toHaveBeenCalledTimes(6);
  });

  it("clears all inline decorations when disabled or document is missing", () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeEditor(uri);
    const store = {
      onDidChange: vi.fn().mockReturnValue(new vscode.Disposable()),
      get: vi.fn().mockReturnValue(null),
    };

    const provider = new InlineDecorationProvider(store as never);

    __mock.configuration.set("sidemark.inlineHighlights", false);
    provider.update(editor as never);
    expect(editor.setDecorations).toHaveBeenCalledTimes(3);
    for (const [, ranges] of vi.mocked(editor.setDecorations).mock.calls) {
      expect(ranges).toEqual([]);
    }

    vi.mocked(editor.setDecorations).mockClear();
    __mock.configuration.set("sidemark.inlineHighlights", true);
    provider.update(editor as never);
    expect(editor.setDecorations).toHaveBeenCalledTimes(3);
    for (const [, ranges] of vi.mocked(editor.setDecorations).mock.calls) {
      expect(ranges).toEqual([]);
    }
  });

  it("updates only markdown active editors and disposes its decoration types", () => {
    const uri = Uri.file("/workspace/doc.md");
    const editor = makeEditor(uri);
    const nonMarkdownEditor = {
      ...editor,
      document: { ...editor.document, languageId: "plaintext" },
    };
    const store = {
      onDidChange: vi.fn().mockReturnValue(new vscode.Disposable()),
      get: vi.fn().mockReturnValue(null),
    };

    const provider = new InlineDecorationProvider(store as never);
    vscode.window.activeTextEditor = nonMarkdownEditor as never;
    provider.updateActiveEditor();
    expect(editor.setDecorations).not.toHaveBeenCalled();

    vscode.window.activeTextEditor = editor as never;
    provider.updateActiveEditor();
    expect(editor.setDecorations).toHaveBeenCalledTimes(3);

    const disposeSpies = __mock.decorations.map((deco) => vi.spyOn(deco, "dispose"));
    provider.dispose();
    for (const spy of disposeSpies) {
      expect(spy).toHaveBeenCalled();
    }
  });
});
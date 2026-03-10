import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, Position, Selection, Uri } from "vscode";

import { SelectionCommentCodeLensProvider } from "../../providers/SelectionCommentCodeLensProvider.js";

function makeEditor(uri: Uri, selection: vscode.Selection, languageId = "markdown") {
  return {
    document: {
      uri,
      languageId,
      lineCount: 20,
      lineAt: (line: number) => ({ text: `line ${line}` }),
    },
    selection,
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
  };
}

describe("SelectionCommentCodeLensProvider", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
  });

  it("registers a markdown code lens provider on construction", () => {
    new SelectionCommentCodeLensProvider();

    expect(__mock.codeLensRegistrations).toHaveLength(1);
    expect(__mock.codeLensRegistrations[0]?.selector).toEqual({ language: "markdown" });
  });

  it("returns no code lens without an active markdown selection for the same document", () => {
    const uri = Uri.file("/workspace/doc.md");
    const document = { uri };
    const provider = new SelectionCommentCodeLensProvider();

    expect(provider.provideCodeLenses(document as never)).toEqual([]);

    vscode.window.activeTextEditor = makeEditor(
      uri,
      new Selection(new Position(1, 2), new Position(1, 2)),
    ) as never;
    expect(provider.provideCodeLenses(document as never)).toEqual([]);

    vscode.window.activeTextEditor = makeEditor(
      Uri.file("/workspace/other.md"),
      new Selection(new Position(1, 2), new Position(1, 5)),
    ) as never;
    expect(provider.provideCodeLenses(document as never)).toEqual([]);

    vscode.window.activeTextEditor = makeEditor(
      uri,
      new Selection(new Position(1, 2), new Position(1, 5)),
      "plaintext",
    ) as never;
    expect(provider.provideCodeLenses(document as never)).toEqual([]);
  });

  it("returns a clickable add comment code lens for a markdown selection", () => {
    const uri = Uri.file("/workspace/doc.md");
    const document = { uri };
    const provider = new SelectionCommentCodeLensProvider();
    vscode.window.activeTextEditor = makeEditor(
      uri,
      new Selection(new Position(2, 3), new Position(4, 1)),
    ) as never;

    const lenses = provider.provideCodeLenses(document as never);

    expect(lenses).toHaveLength(1);
    expect(lenses[0]).toBeInstanceOf(vscode.CodeLens);
    expect(lenses[0]?.range.start).toEqual(new Position(2, 3));
    expect(lenses[0]?.command).toEqual({
      title: "$(comment-discussion) Add comment",
      tooltip: "Add an inline MRSF comment to the current selection",
      command: "mrsf.addInlineComment",
      arguments: [uri],
    });
  });

  it("fires refresh events when markdown selection or editor state changes", () => {
    const provider = new SelectionCommentCodeLensProvider();
    const changes = vi.fn();
    provider.onDidChangeCodeLenses(changes);

    __mock.emitTextEditorSelectionChange({
      textEditor: makeEditor(
        Uri.file("/workspace/doc.md"),
        new Selection(new Position(0, 0), new Position(0, 1)),
      ),
      selections: [],
    });
    __mock.emitActiveTextEditor(makeEditor(
      Uri.file("/workspace/doc.md"),
      new Selection(new Position(0, 0), new Position(0, 1)),
    ) as never);
    __mock.emitActiveTextEditor(undefined);

    expect(changes).toHaveBeenCalledTimes(3);
  });
});
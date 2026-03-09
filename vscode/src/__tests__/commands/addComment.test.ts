import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, Position, Selection, Uri } from "vscode";

const mockVscodeSelectionToMrsf = vi.fn();

vi.mock("../../util/positions.js", () => ({
  vscodeSelectionToMrsf: (...args: unknown[]) => mockVscodeSelectionToMrsf(...args),
}));

import {
  registerAddInlineComment,
  registerAddLineComment,
} from "../../commands/addComment.js";

function getRegisteredCommand(id: string) {
  const entry = __mock.commandRegistrations.find((command) => command.id === id);
  if (!entry) {
    throw new Error(`Command not registered: ${id}`);
  }
  return entry.callback;
}

describe("addComment commands", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    __mock.configuration.set("sidemark.author", "Tester");
    mockVscodeSelectionToMrsf.mockReturnValue({
      line: 2,
      end_line: 3,
      start_column: 1,
      end_column: 4,
    });
  });

  it("adds a line comment using the active editor selection", async () => {
    const uri = Uri.file("/workspace/doc.md");
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: (line: number) => ({ text: `line ${line}` }),
      },
      selection: new Selection(new Position(4, 0), new Position(4, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      addComment: vi.fn().mockResolvedValue({ id: "c1" }),
    };

    registerAddLineComment(store as never);
    __mock.inputBoxResults.push("Comment text");
    __mock.quickPickResults.push({ label: "issue" }, { label: "high" });

    await getRegisteredCommand("mrsf.addLineComment")();

    expect(store.addComment).toHaveBeenCalledWith(uri, {
      text: "Comment text",
      author: "Tester",
      line: 5,
      type: "issue",
      severity: "high",
    });
    expect(__mock.informationMessages).toContain("Comment added on line 5.");
  });

  it("prompts for line number when no editor is available", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const store = {
      addComment: vi.fn().mockResolvedValue({ id: "c1" }),
    };

    registerAddLineComment(store as never);
    __mock.inputBoxResults.push("10", "Preview comment");
    __mock.quickPickResults.push({ label: "(none)" }, { label: "(none)" });

    await getRegisteredCommand("mrsf.addLineComment")(undefined, uri);

    expect(store.addComment).toHaveBeenCalledWith(uri, {
      text: "Preview comment",
      author: "Tester",
      line: 10,
      type: undefined,
      severity: undefined,
    });
  });

  it("adds an inline comment from the selected markdown text", async () => {
    const uri = Uri.file("/workspace/doc.md");
    const selection = new Selection(new Position(1, 1), new Position(2, 4));
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: (line: number) => ({ text: `line ${line}` }),
        getText: vi.fn().mockReturnValue("Selected text"),
      },
      selection,
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      addComment: vi.fn().mockResolvedValue({ id: "c2" }),
    };

    registerAddInlineComment(store as never);
    __mock.inputBoxResults.push("Inline feedback");
    __mock.quickPickResults.push({ label: "clarity" }, { label: "medium" });

    await getRegisteredCommand("mrsf.addInlineComment")();

    expect(mockVscodeSelectionToMrsf).toHaveBeenCalledWith(selection);
    expect(store.addComment).toHaveBeenCalledWith(uri, {
      text: "Inline feedback",
      author: "Tester",
      line: 2,
      end_line: 3,
      start_column: 1,
      end_column: 4,
      type: "clarity",
      severity: "medium",
    });
    expect(__mock.informationMessages).toContain("Inline comment added on lines 2-3.");
  });

  it("warns when inline comments are requested without a markdown selection", async () => {
    const uri = Uri.file("/workspace/doc.md");
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: (line: number) => ({ text: `line ${line}` }),
        getText: vi.fn().mockReturnValue(""),
      },
      selection: new Selection(new Position(0, 0), new Position(0, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      addComment: vi.fn(),
    };

    registerAddInlineComment(store as never);

    await getRegisteredCommand("mrsf.addInlineComment")();

    expect(store.addComment).not.toHaveBeenCalled();
    expect(__mock.warningMessages).toContain("Open a Markdown file to add review comments.");
  });

  it("shows an error when storing a new comment fails", async () => {
    const uri = Uri.file("/workspace/doc.md");
    vscode.window.activeTextEditor = {
      document: {
        uri,
        languageId: "markdown",
        lineCount: 10,
        lineAt: (line: number) => ({ text: `line ${line}` }),
      },
      selection: new Selection(new Position(0, 0), new Position(0, 0)),
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never;

    const store = {
      addComment: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    registerAddLineComment(store as never);
    __mock.inputBoxResults.push("Comment text");
    __mock.quickPickResults.push({ label: "(none)" }, { label: "(none)" });

    await getRegisteredCommand("mrsf.addLineComment")();

    expect(__mock.errorMessages).toContain("Failed to add comment: disk full");
  });
});
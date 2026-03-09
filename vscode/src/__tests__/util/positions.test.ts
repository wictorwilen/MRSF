import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Range as EditorRange } from "@mrsf/monaco-mrsf/browser";
import * as vscode from "vscode";

const mockCommentToEditorRange = vi.fn();
const mockSelectionToAnchor = vi.fn();
const mockIsInlineComment = vi.fn();
const mockIsDocumentLevelComment = vi.fn();

vi.mock("@mrsf/monaco-mrsf/browser", () => ({
  commentToEditorRange: (...args: unknown[]) => mockCommentToEditorRange(...args),
  selectionToAnchor: (...args: unknown[]) => mockSelectionToAnchor(...args),
  isInlineComment: (...args: unknown[]) => mockIsInlineComment(...args),
  isDocumentLevelComment: (...args: unknown[]) => mockIsDocumentLevelComment(...args),
}));

import {
  editorRangeToVscodeRange,
  isDocumentLevelComment,
  isInlineComment,
  mrsfToVscodeRange,
  relativeTime,
  toDocumentGeometry,
  vscodeChangeToEditorChange,
  vscodeSelectionToMrsf,
} from "../../util/positions.js";

describe("positions utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps an editor range to a VS Code range", () => {
    const range = editorRangeToVscodeRange({
      start: { lineIndex: 1, column: 2 },
      end: { lineIndex: 3, column: 4 },
    } as EditorRange);

    expect(range.start.line).toBe(1);
    expect(range.start.character).toBe(2);
    expect(range.end.line).toBe(3);
    expect(range.end.character).toBe(4);
  });

  it("converts a VS Code change into an editor change", () => {
    const change = vscodeChangeToEditorChange({
      range: new vscode.Range(2, 1, 2, 3),
      text: "abc",
    } as never);

    expect(change).toEqual({
      range: {
        start: { lineIndex: 2, column: 1 },
        end: { lineIndex: 2, column: 3 },
      },
      text: "abc",
    });
  });

  it("delegates comment range conversion through the shared browser mapper", () => {
    mockCommentToEditorRange.mockReturnValue({
      start: { lineIndex: 4, column: 0 },
      end: { lineIndex: 4, column: 10 },
    });

    const document = {
      lineCount: 6,
      lineAt: (line: number) => ({ text: ["zero", "one", "two", "three", "four text", "five"][line] ?? "" }),
    } as never;

    const range = mrsfToVscodeRange({ id: "c1" } as never, document);

    expect(mockCommentToEditorRange).toHaveBeenCalled();
    expect(range?.start.line).toBe(4);
    expect(range?.end.character).toBe(10);
  });

  it("builds document geometry from a VS Code document", () => {
    const geometry = toDocumentGeometry({
      lineCount: 2,
      lineAt: (line: number) => ({ text: ["abc", "hello"][line] ?? "" }),
    } as never);

    expect(geometry.lineCount).toBe(2);
    expect(geometry.getLineLength(1)).toBe(5);
  });

  it("converts a selection into MRSF anchor fields", () => {
    mockSelectionToAnchor.mockReturnValue({
      line: 2,
      end_line: 3,
      start_column: 1,
      end_column: 4,
    });

    const result = vscodeSelectionToMrsf(
      new vscode.Selection(new vscode.Position(1, 1), new vscode.Position(2, 4)),
    );

    expect(mockSelectionToAnchor).toHaveBeenCalledWith({
      start: { lineIndex: 1, column: 1 },
      end: { lineIndex: 2, column: 4 },
    });
    expect(result.line).toBe(2);
    expect(result.end_line).toBe(3);
  });

  it("delegates inline and document-level checks to the shared helpers", () => {
    mockIsInlineComment.mockReturnValue(true);
    mockIsDocumentLevelComment.mockReturnValue(false);

    expect(isInlineComment({ id: "c1" } as never)).toBe(true);
    expect(isDocumentLevelComment({ id: "c1" } as never)).toBe(false);
  });

  it("formats relative time across common ranges", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00Z"));

    expect(relativeTime("2026-03-09T11:59:45Z")).toBe("just now");
    expect(relativeTime("2026-03-09T11:30:00Z")).toBe("30m ago");
    expect(relativeTime("2026-03-09T09:00:00Z")).toBe("3h ago");
    expect(relativeTime("2026-03-01T12:00:00Z")).toBe("8d ago");
    expect(relativeTime("2025-12-09T12:00:00Z")).toBe("3mo ago");
    expect(relativeTime("2024-03-09T12:00:00Z")).toBe("2y ago");
    expect(relativeTime("2026-03-09T12:05:00Z")).toBe("just now");

    vi.useRealTimers();
  });
});
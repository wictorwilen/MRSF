/**
 * Position mapping between MRSF (1-based lines, 0-based columns)
 * and VS Code (0-based lines, 0-based characters).
 */
import * as vscode from "vscode";
import type { Comment } from "@mrsf/cli";
import {
  commentToEditorRange,
  selectionToAnchor,
  isInlineComment as isInlineCommentShared,
  isDocumentLevelComment as isDocumentLevelCommentShared,
  type DocumentGeometry,
  type EditorContentChange,
  type EditorRange,
} from "@mrsf/monaco-mrsf/browser";

export function toDocumentGeometry(document: vscode.TextDocument): DocumentGeometry {
  return {
    lineCount: document.lineCount,
    getLineLength(lineIndex: number): number {
      return document.lineAt(lineIndex).text.length;
    },
  };
}

export function editorRangeToVscodeRange(range: EditorRange): vscode.Range {
  return new vscode.Range(
    range.start.lineIndex,
    range.start.column,
    range.end.lineIndex,
    range.end.column,
  );
}

export function vscodeChangeToEditorChange(
  change: vscode.TextDocumentContentChangeEvent,
): EditorContentChange {
  return {
    range: {
      start: {
        lineIndex: change.range.start.line,
        column: change.range.start.character,
      },
      end: {
        lineIndex: change.range.end.line,
        column: change.range.end.character,
      },
    },
    text: change.text,
  };
}

/**
 * Convert an MRSF comment's anchor to a VS Code Range.
 * - Document-level comment (no line): returns undefined
 * - Line-only comments: full line range
 * - Column-span comments: precise character range
 *
 * Returns undefined if the line is out of document bounds.
 */
export function mrsfToVscodeRange(
  comment: Comment,
  document?: vscode.TextDocument,
): vscode.Range | undefined {
  const geometry = document ? toDocumentGeometry(document) : undefined;
  const range = commentToEditorRange(comment, geometry);
  return range ? editorRangeToVscodeRange(range) : undefined;
}

/**
 * Convert a VS Code Selection to MRSF anchoring fields.
 */
export function vscodeSelectionToMrsf(selection: vscode.Selection): {
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
} {
  return selectionToAnchor({
    start: {
      lineIndex: selection.start.line,
      column: selection.start.character,
    },
    end: {
      lineIndex: selection.end.line,
      column: selection.end.character,
    },
  });
}

/**
 * Check if a comment has column-level anchoring (inline/text-specific).
 */
export function isInlineComment(comment: Comment): boolean {
  return isInlineCommentShared(comment);
}

/**
 * Check if a comment is a document-level comment (no positioning).
 */
export function isDocumentLevelComment(comment: Comment): boolean {
  return isDocumentLevelCommentShared(comment);
}

/**
 * Format a relative time string from an ISO timestamp.
 */
export function relativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

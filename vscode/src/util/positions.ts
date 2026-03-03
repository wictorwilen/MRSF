/**
 * Position mapping between MRSF (1-based lines, 0-based columns)
 * and VS Code (0-based lines, 0-based characters).
 */
import * as vscode from "vscode";
import type { Comment } from "@mrsf/cli";

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
  if (comment.line == null) {
    return undefined; // document-level comment
  }

  const startLine = comment.line - 1; // MRSF 1-based → VS Code 0-based

  // Guard: line must be non-negative and within document bounds
  if (startLine < 0) return undefined;
  if (document && startLine >= document.lineCount) return undefined;

  if (comment.start_column != null && comment.end_column != null) {
    // Column-span (inline) comment
    let endLine =
      comment.end_line != null ? comment.end_line - 1 : startLine;
    if (document) endLine = Math.min(endLine, document.lineCount - 1);
    return new vscode.Range(
      startLine,
      comment.start_column,
      endLine,
      comment.end_column,
    );
  }

  if (comment.end_line != null) {
    // Multi-line range comment without columns — span full lines
    let endLine = comment.end_line - 1;
    if (document) {
      endLine = Math.min(endLine, document.lineCount - 1);
    }
    const endChar = document
      ? document.lineAt(endLine).text.length
      : Number.MAX_SAFE_INTEGER;
    return new vscode.Range(startLine, 0, endLine, endChar);
  }

  // Single-line comment — full line range
  const endChar = document
    ? document.lineAt(startLine).text.length
    : Number.MAX_SAFE_INTEGER;
  return new vscode.Range(startLine, 0, startLine, endChar);
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
  // Normalize so start <= end regardless of selection direction
  const start = selection.start;
  const end = selection.end;

  const line = start.line + 1; // VS Code 0-based → MRSF 1-based

  if (start.line === end.line && start.character === end.character) {
    // Cursor, no selection — line comment only
    return { line };
  }

  const result: {
    line: number;
    end_line?: number;
    start_column?: number;
    end_column?: number;
  } = { line };

  if (start.line !== end.line) {
    result.end_line = end.line + 1;
  }

  result.start_column = start.character; // both 0-based
  result.end_column = end.character;

  return result;
}

/**
 * Check if a comment has column-level anchoring (inline/text-specific).
 */
export function isInlineComment(comment: Comment): boolean {
  return comment.start_column != null && comment.end_column != null;
}

/**
 * Check if a comment is a document-level comment (no positioning).
 */
export function isDocumentLevelComment(comment: Comment): boolean {
  return comment.line == null && comment.selected_text == null;
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

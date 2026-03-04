/**
 * LiveLineTracker — adjusts comment positions in memory as the user edits.
 *
 * Applies simple line-shift and column-shift arithmetic (no fuzzy matching)
 * so that gutter decorations, hover cards, and the sidebar stay aligned with
 * the text while editing.  The real reanchor (with fuzzy matching) runs when
 * the file is saved and persists the results to the sidecar.
 *
 * Line numbers are MRSF 1-based; VS Code change events use 0-based lines.
 * Column numbers are 0-based in both MRSF and VS Code.
 */

import type { TextDocumentContentChangeEvent } from "vscode";
import type { Comment } from "@mrsf/cli";

// ── Column helpers ──────────────────────────────────────────

/**
 * Shift `start_column` / `end_column` for a single-line, same-line edit.
 *
 * Only adjusts comments whose anchor line equals the edited line and that
 * have column-level anchoring.  Three zones:
 *
 *   1. Edit entirely before the anchor columns → shift both by colDelta.
 *   2. Edit overlaps the anchor → clamp to a best-effort range
 *      (the save-time fuzzy reanchor will clean it up precisely).
 *   3. Edit entirely after the anchor columns → no change.
 *
 * Returns true if any column was adjusted.
 */
function shiftColumns(
  comments: Comment[],
  editLine0: number,
  editCol: number,
  charsRemoved: number,
  charsAdded: number,
): boolean {
  const colDelta = charsAdded - charsRemoved;
  if (colDelta === 0) return false;

  let moved = false;

  for (const comment of comments) {
    if (comment.reply_to) continue;
    if (comment.line == null) continue;
    if (comment.start_column == null || comment.end_column == null) continue;

    const commentLine0 = comment.line - 1;
    // For multi-line comments only adjust if the edit is on the start line
    if (commentLine0 !== editLine0) continue;

    const editEnd = editCol + charsRemoved;

    if (editEnd <= comment.start_column) {
      // Zone 1 — edit is entirely before the anchor
      comment.start_column += colDelta;
      comment.end_column += colDelta;
      moved = true;
    } else if (editCol < comment.start_column) {
      // Edit starts before and extends into/past the anchor
      comment.start_column = editCol + charsAdded;
      if (editEnd >= comment.end_column) {
        // Edit encompasses the entire anchor range — collapse
        comment.end_column = editCol + charsAdded;
      } else {
        comment.end_column += colDelta;
      }
      moved = true;
    } else if (editCol < comment.end_column) {
      // Edit starts inside the anchor range
      if (editEnd >= comment.end_column) {
        // …and extends past the end
        comment.end_column = editCol + charsAdded;
      } else {
        // …and stays within the range
        comment.end_column += colDelta;
      }
      moved = true;
    }
    // Zone 3 — edit is entirely after; nothing to do
  }

  return moved;
}

// ── Main entry point ────────────────────────────────────────

/**
 * Adjust all comment positions in place based on a set of document changes.
 *
 * Returns true if any comment was moved.
 */
export function applyLineShifts(
  comments: Comment[],
  changes: readonly TextDocumentContentChangeEvent[],
): boolean {
  let anyMoved = false;

  // Process changes in reverse order (bottom-up) so earlier offsets remain
  // valid after shifting.  VS Code guarantees changes are sorted by range
  // in ascending order, so we reverse.
  const sorted = [...changes].sort(
    (a, b) => b.range.start.line - a.range.start.line,
  );

  for (const change of sorted) {
    const editStartLine = change.range.start.line; // 0-based
    const linesRemoved = change.range.end.line - change.range.start.line;
    const linesAdded = change.text.split("\n").length - 1;
    const delta = linesAdded - linesRemoved;

    // ── Single-line edit with no line-count change ──────────
    // Adjust columns for inline (column-anchored) comments on the same line.
    if (delta === 0) {
      if (linesRemoved === 0) {
        // Purely intra-line edit — safe to adjust columns
        const charsRemoved =
          change.range.end.character - change.range.start.character;
        const charsAdded = change.text.length;
        if (
          shiftColumns(
            comments,
            editStartLine,
            change.range.start.character,
            charsRemoved,
            charsAdded,
          )
        ) {
          anyMoved = true;
        }
      }
      continue; // No line-count change — no line shift needed
    }

    // ── Multi-line edit — shift line numbers ────────────────
    const editEndLine = editStartLine + linesRemoved; // 0-based, exclusive

    for (const comment of comments) {
      if (comment.reply_to) continue; // Replies inherit parent's line

      if (comment.line == null) continue;

      // MRSF line is 1-based; convert to 0-based for comparison
      const commentLine0 = comment.line - 1;

      if (commentLine0 <= editStartLine) {
        // Comment is at or above the edit start — no shift needed
        continue;
      }

      if (commentLine0 < editEndLine) {
        // Comment is *within* the deleted/replaced range.
        // Preserve relative offset if the replacement has enough lines,
        // otherwise clamp to the last line of the replacement block.
        const offset = commentLine0 - editStartLine; // relative position within old range
        const clampedOffset = Math.min(offset, Math.max(linesAdded, 0));
        const newLine = editStartLine + clampedOffset + 1; // back to 1-based
        if (newLine !== comment.line) {
          comment.line = Math.max(1, newLine);
          anyMoved = true;
        }

        if (comment.end_line != null) {
          const endLine0 = comment.end_line - 1;
          const endOffset = endLine0 - editStartLine;
          const clampedEnd = Math.min(endOffset, Math.max(linesAdded, 0));
          comment.end_line = Math.max(1, editStartLine + clampedEnd + 1);
        }
        continue;
      }

      // Comment is below the entire edit range — simple shift by delta
      const newLine = comment.line + delta;
      comment.line = newLine < 1 ? 1 : newLine;

      if (comment.end_line != null) {
        const newEndLine = comment.end_line + delta;
        comment.end_line = newEndLine < 1 ? 1 : newEndLine;
      }

      anyMoved = true;
    }
  }

  return anyMoved;
}

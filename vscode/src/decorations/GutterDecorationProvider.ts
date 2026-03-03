/**
 * GutterDecorationProvider — renders gutter icons on lines that have MRSF comments.
 *
 * Visual states:
 * - Open comment (blue speech bubble)
 * - Resolved comment (green checkmark)
 * - Orphaned comment (orange warning)
 * - Multiple comments on same line (stacked bubble)
 */
import * as vscode from "vscode";
import type { Comment } from "@mrsf/cli";
import type { SidecarStore } from "../store/SidecarStore.js";
import { mrsfToVscodeRange } from "../util/positions.js";

interface LineGroup {
  line: number; // 0-based
  comments: Comment[];
  hasOpen: boolean;
  hasOrphaned: boolean;
  allResolved: boolean;
}

export class GutterDecorationProvider implements vscode.Disposable {
  private openDecoration: vscode.TextEditorDecorationType;
  private resolvedDecoration: vscode.TextEditorDecorationType;
  private orphanedDecoration: vscode.TextEditorDecorationType;
  private multipleDecoration: vscode.TextEditorDecorationType;

  private disposables: vscode.Disposable[] = [];

  constructor(
    private store: SidecarStore,
    private extensionUri: vscode.Uri,
  ) {
    const iconUri = (name: string) =>
      vscode.Uri.joinPath(extensionUri, "media", "icons", name);

    this.openDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: iconUri("comment-open.svg"),
      gutterIconSize: "contain",
    });

    this.resolvedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: iconUri("comment-resolved.svg"),
      gutterIconSize: "contain",
    });

    this.orphanedDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: iconUri("comment-orphaned.svg"),
      gutterIconSize: "contain",
    });

    this.multipleDecoration = vscode.window.createTextEditorDecorationType({
      gutterIconPath: iconUri("comment-multiple.svg"),
      gutterIconSize: "contain",
    });

    // Update decorations when store changes
    this.disposables.push(
      this.store.onDidChange(() => this.updateActiveEditor()),
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() =>
        this.updateActiveEditor(),
      ),
    );
  }

  /**
   * Re-compute and apply gutter decorations for the active editor.
   */
  updateActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }
    this.update(editor);
  }

  /**
   * Apply gutter decorations to a specific editor.
   */
  update(editor: vscode.TextEditor): void {
    const config = vscode.workspace.getConfiguration("sidemark");
    if (!config.get<boolean>("gutterIcons", true)) {
      this.clearAll(editor);
      return;
    }

    const showResolved = config.get<boolean>("showResolved", true);
    const doc = this.store.get(editor.document.uri);

    if (!doc) {
      this.clearAll(editor);
      return;
    }

    // Group comments by line
    const lineGroups = this.groupByLine(doc.comments, editor, showResolved);

    const openRanges: vscode.DecorationOptions[] = [];
    const resolvedRanges: vscode.DecorationOptions[] = [];
    const orphanedRanges: vscode.DecorationOptions[] = [];
    const multipleRanges: vscode.DecorationOptions[] = [];

    const allComments = doc.comments;
    for (const group of lineGroups.values()) {
      // Use full-line range so hover triggers anywhere on the line text
      const lineLen = editor.document.lineAt(group.line).text.length;
      const range = new vscode.Range(group.line, 0, group.line, Math.max(lineLen, 1));

      // Build a compact inline preview shown after the line text
      const preview = this.buildPreviewText(group);

      const decoOption: vscode.DecorationOptions = {
        range,
        renderOptions: {
          after: {
            contentText: preview,
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            fontStyle: "italic",
            margin: "0 0 0 3em",
          },
        },
      };

      if (group.comments.length > 1) {
        multipleRanges.push(decoOption);
      } else if (group.hasOrphaned) {
        orphanedRanges.push(decoOption);
      } else if (group.hasOpen) {
        openRanges.push(decoOption);
      } else if (group.allResolved) {
        resolvedRanges.push(decoOption);
      }
    }

    editor.setDecorations(this.openDecoration, openRanges);
    editor.setDecorations(this.resolvedDecoration, resolvedRanges);
    editor.setDecorations(this.orphanedDecoration, orphanedRanges);
    editor.setDecorations(this.multipleDecoration, multipleRanges);
  }

  private groupByLine(
    comments: Comment[],
    editor: vscode.TextEditor,
    showResolved: boolean,
  ): Map<number, LineGroup> {
    const groups = new Map<number, LineGroup>();

    for (const comment of comments) {
      if (!showResolved && comment.resolved) continue;
      if (comment.reply_to) continue; // Replies inherit parent's line

      const range = mrsfToVscodeRange(comment, editor.document);
      if (!range) continue; // Document-level comment

      const lineNum = range.start.line;
      let group = groups.get(lineNum);
      if (!group) {
        group = {
          line: lineNum,
          comments: [],
          hasOpen: false,
          hasOrphaned: false,
          allResolved: true,
        };
        groups.set(lineNum, group);
      }

      group.comments.push(comment);
      if (!comment.resolved) {
        group.hasOpen = true;
        group.allResolved = false;
      }
      if (
        (comment as Record<string, unknown>).x_reanchor_status === "orphaned"
      ) {
        group.hasOrphaned = true;
      }
    }

    return groups;
  }

  /**
   * Build a compact inline preview string for a line group.
   * Shown as faded text after the line content (like GitLens blame).
   */
  private buildPreviewText(group: LineGroup): string {
    if (group.comments.length > 1) {
      const unresolved = group.comments.filter((c) => !c.resolved).length;
      return unresolved > 0
        ? `  💬 ${group.comments.length} comments (${unresolved} open)`
        : `  ✅ ${group.comments.length} comments (all resolved)`;
    }
    const comment = group.comments[0];
    const author = comment.author.split(" ")[0]; // first name only
    const maxLen = 60;
    const text =
      comment.text.length > maxLen
        ? comment.text.substring(0, maxLen) + "…"
        : comment.text;

    if (
      (comment as Record<string, unknown>).x_reanchor_status === "orphaned"
    ) {
      return `  ⚠️ orphaned — ${author}: ${text}`;
    }
    const icon = comment.resolved ? "✅" : "💬";
    return `  ${icon} ${author}: ${text}`;
  }

  private clearAll(editor: vscode.TextEditor): void {
    editor.setDecorations(this.openDecoration, []);
    editor.setDecorations(this.resolvedDecoration, []);
    editor.setDecorations(this.orphanedDecoration, []);
    editor.setDecorations(this.multipleDecoration, []);
  }

  dispose(): void {
    this.openDecoration.dispose();
    this.resolvedDecoration.dispose();
    this.orphanedDecoration.dispose();
    this.multipleDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

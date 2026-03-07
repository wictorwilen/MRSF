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
import { buildReviewSnapshot, toCommentMap } from "../util/reviewSnapshot.js";

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

    const snapshot = buildReviewSnapshot(editor.document, doc, showResolved);
    const commentsById = toCommentMap(doc);

    const openRanges: vscode.DecorationOptions[] = [];
    const resolvedRanges: vscode.DecorationOptions[] = [];
    const orphanedRanges: vscode.DecorationOptions[] = [];
    const multipleRanges: vscode.DecorationOptions[] = [];

    for (const mark of snapshot.gutterMarks) {
      const lineIndex = mark.line - 1;
      const lineThreads = snapshot.threadsByLine.find((entry) => entry.line === mark.line);
      if (!lineThreads) continue;

      const threadComments = lineThreads.threads.flatMap((thread) =>
        thread.commentIds
          .map((commentId) => commentsById.get(commentId))
          .filter((comment): comment is Comment => !!comment),
      );
      const rootComments = lineThreads.threads
        .map((thread) => commentsById.get(thread.rootCommentId))
        .filter((comment): comment is Comment => !!comment);
      const hasOrphaned = rootComments.some(
        (comment) => (comment as Record<string, unknown>).x_reanchor_status === "orphaned",
      );

      // Use full-line range so hover triggers anywhere on the line text
      const lineLen = editor.document.lineAt(lineIndex).text.length;
      const range = new vscode.Range(lineIndex, 0, lineIndex, Math.max(lineLen, 1));

      // Build a compact inline preview shown after the line text
      const preview = this.buildPreviewText(rootComments, threadComments, hasOrphaned);

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

      if (mark.threadCount > 1) {
        multipleRanges.push(decoOption);
      } else if (hasOrphaned) {
        orphanedRanges.push(decoOption);
      } else if (mark.resolvedState === "resolved") {
        resolvedRanges.push(decoOption);
      } else {
        openRanges.push(decoOption);
      }
    }

    editor.setDecorations(this.openDecoration, openRanges);
    editor.setDecorations(this.resolvedDecoration, resolvedRanges);
    editor.setDecorations(this.orphanedDecoration, orphanedRanges);
    editor.setDecorations(this.multipleDecoration, multipleRanges);
  }

  /**
   * Build a compact inline preview string for a line group.
   * Shown as faded text after the line content (like GitLens blame).
   */
  private buildPreviewText(
    rootComments: Comment[],
    threadComments: Comment[],
    hasOrphaned: boolean,
  ): string {
    if (rootComments.length > 1) {
      const unresolved = rootComments.filter((comment) => !comment.resolved).length;
      return unresolved > 0
        ? `  💬 ${threadComments.length} comments (${unresolved} open)`
        : `  ✅ ${threadComments.length} comments (all resolved)`;
    }
    const comment = rootComments[0];
    const author = comment.author.split(" ")[0]; // first name only
    const maxLen = 60;
    const text =
      comment.text.length > maxLen
        ? comment.text.substring(0, maxLen) + "…"
        : comment.text;

    if (hasOrphaned) {
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

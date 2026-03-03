/**
 * InlineDecorationProvider — renders background highlights for
 * text-specific (inline/column-span) MRSF comments.
 *
 * Colors:
 * - Open: semi-transparent blue
 * - Resolved: semi-transparent green
 * - Orphaned: semi-transparent orange
 */
import * as vscode from "vscode";
import type { SidecarStore } from "../store/SidecarStore.js";
import { mrsfToVscodeRange, isInlineComment } from "../util/positions.js";

export class InlineDecorationProvider implements vscode.Disposable {
  private openDecoration: vscode.TextEditorDecorationType;
  private resolvedDecoration: vscode.TextEditorDecorationType;
  private orphanedDecoration: vscode.TextEditorDecorationType;

  private disposables: vscode.Disposable[] = [];

  constructor(private store: SidecarStore) {
    this.openDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor(
        "diffEditor.insertedTextBackground",
      ),
      border: "1px solid",
      borderColor: new vscode.ThemeColor("editorInfo.foreground"),
      isWholeLine: false,
    });

    this.resolvedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(40, 167, 69, 0.12)",
      border: "1px solid rgba(40, 167, 69, 0.3)",
      isWholeLine: false,
    });

    this.orphanedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(255, 152, 0, 0.12)",
      border: "1px solid rgba(255, 152, 0, 0.3)",
      isWholeLine: false,
    });

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
   * Re-compute inline decorations for the active editor.
   */
  updateActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }
    this.update(editor);
  }

  /**
   * Apply inline decorations to a specific editor.
   */
  update(editor: vscode.TextEditor): void {
    const config = vscode.workspace.getConfiguration("sidemark");
    if (!config.get<boolean>("inlineHighlights", true)) {
      this.clearAll(editor);
      return;
    }

    const showResolved = config.get<boolean>("showResolved", true);
    const doc = this.store.get(editor.document.uri);

    if (!doc) {
      this.clearAll(editor);
      return;
    }

    const openRanges: vscode.DecorationOptions[] = [];
    const resolvedRanges: vscode.DecorationOptions[] = [];
    const orphanedRanges: vscode.DecorationOptions[] = [];

    for (const comment of doc.comments) {
      if (comment.reply_to) continue; // Replies inherit parent anchor
      if (!isInlineComment(comment)) continue; // Only inline/column-span
      if (!showResolved && comment.resolved) continue;

      const range = mrsfToVscodeRange(comment, editor.document);
      if (!range) continue;

      const decoOption: vscode.DecorationOptions = { range };

      const isOrphaned =
        (comment as Record<string, unknown>).x_reanchor_status === "orphaned";

      if (isOrphaned) {
        orphanedRanges.push(decoOption);
      } else if (comment.resolved) {
        resolvedRanges.push(decoOption);
      } else {
        openRanges.push(decoOption);
      }
    }

    editor.setDecorations(this.openDecoration, openRanges);
    editor.setDecorations(this.resolvedDecoration, resolvedRanges);
    editor.setDecorations(this.orphanedDecoration, orphanedRanges);
  }

  private clearAll(editor: vscode.TextEditor): void {
    editor.setDecorations(this.openDecoration, []);
    editor.setDecorations(this.resolvedDecoration, []);
    editor.setDecorations(this.orphanedDecoration, []);
  }

  dispose(): void {
    this.openDecoration.dispose();
    this.resolvedDecoration.dispose();
    this.orphanedDecoration.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

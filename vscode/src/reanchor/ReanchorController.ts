/**
 * ReanchorController — manual reanchor command with inline diff review
 * for uncertain (fuzzy/ambiguous) results.
 *
 * Flow:
 * 1. Compute reanchor results via SidecarStore
 * 2. Auto-accept results at or above auto-accept threshold
 * 3. Queue uncertain results for interactive review
 * 4. Show old/new anchor decorations with accept/reject per item
 * 5. Apply accepted results and persist
 */
import * as vscode from "vscode";
import type { ReanchorResult } from "@mrsf/cli";
import type { SidecarStore } from "../store/SidecarStore.js";
import type { MrsfStatusBar } from "../statusBar.js";

export class ReanchorController implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private reviewSession: ReanchorReviewSession | null = null;

  /** Called after a reanchor run completes (auto-accept, review, or no-op). */
  onReanchorComplete?: (uri: vscode.Uri) => void;

  constructor(
    private store: SidecarStore,
    private statusBar: MrsfStatusBar,
  ) {}

  /**
   * Resolve the target document URI for reanchoring.
   * Tries (in order): explicit URI arg, active editor, any visible markdown editor.
   */
  private async resolveTarget(
    explicitUri?: vscode.Uri,
  ): Promise<{ doc: any; uri: vscode.Uri } | null> {
    if (explicitUri) {
      let doc = this.store.get(explicitUri);
      if (!doc) doc = await this.store.load(explicitUri);
      return doc ? { doc, uri: explicitUri } : null;
    }

    // Try active editor first
    const result = await this.store.getForActiveEditor();
    if (result) return result;

    // Fallback: any visible markdown editor (preview mode)
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === "markdown") {
        const uri = editor.document.uri;
        let doc = this.store.get(uri);
        if (!doc) doc = await this.store.load(uri);
        if (doc) return { doc, uri };
      }
    }

    // Last resort: any open markdown document (e.g. preview-only tab)
    for (const textDoc of vscode.workspace.textDocuments) {
      if (textDoc.languageId === "markdown" && textDoc.uri.scheme === "file") {
        const uri = textDoc.uri;
        let doc = this.store.get(uri);
        if (!doc) doc = await this.store.load(uri);
        if (doc) return { doc, uri };
      }
    }

    return null;
  }

  register(): vscode.Disposable {
    return vscode.commands.registerCommand("mrsf.reanchor", (uri?: vscode.Uri) =>
      this.runReanchor(uri),
    );
  }

  private async runReanchor(explicitUri?: vscode.Uri): Promise<void> {
    const active = await this.resolveTarget(explicitUri);
    if (!active) {
      vscode.window.showWarningMessage(
        "No review sidecar found for the active Markdown file.",
      );
      return;
    }

    const config = vscode.workspace.getConfiguration("sidemark");
    const threshold = config.get<number>("reanchorThreshold", 0.6);
    const autoAcceptScore = config.get<number>("reanchorAutoAcceptScore", 1.0);

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Reanchoring comments...",
        cancellable: false,
      },
      async () => {
        // Reload from disk to ensure freshness
        await this.statusBar.withProgress("Reanchoring...", () =>
          this.store.load(active.uri),
        );

        const results = await this.statusBar.withProgress(
          "Reanchoring...",
          () => this.store.reanchorComments(active.uri, { threshold }),
        );

        if (results.length === 0) {
          vscode.window.showInformationMessage("No comments need reanchoring.");
          this.onReanchorComplete?.(active.uri);
          return;
        }

        // Partition results
        const autoAccept: ReanchorResult[] = [];
        const needsReview: ReanchorResult[] = [];
        const orphaned: ReanchorResult[] = [];

        for (const r of results) {
          if (r.status === "orphaned") {
            orphaned.push(r);
          } else if (
            r.status === "anchored" ||
            r.score >= autoAcceptScore
          ) {
            autoAccept.push(r);
          } else {
            // fuzzy, shifted, ambiguous with score below threshold
            needsReview.push(r);
          }
        }

        // Apply auto-accepted immediately
        if (autoAccept.length > 0) {
          await this.store.applyReanchors(active.uri, autoAccept);
        }

        // Report orphaned
        if (orphaned.length > 0) {
          vscode.window.showWarningMessage(
            `${orphaned.length} comment(s) are orphaned — their anchored text could not be found.`,
          );
        }

        if (needsReview.length === 0) {
          const total = autoAccept.length;
          vscode.window.showInformationMessage(
            `${total} comment(s) reanchored successfully.${orphaned.length > 0 ? ` ${orphaned.length} orphaned.` : ""}`,
          );
          this.onReanchorComplete?.(active.uri);
          return;
        }

        // Enter interactive review session
        vscode.window.showInformationMessage(
          `${autoAccept.length} auto-accepted. ${needsReview.length} need(s) review.`,
        );

        this.reviewSession = new ReanchorReviewSession(
          this.store,
          active.uri,
          needsReview,
        );
        await this.reviewSession.start();
        this.onReanchorComplete?.(active.uri);
      },
    );
  }

  dispose(): void {
    this.reviewSession?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * Interactive review session for uncertain reanchor results.
 * Shows old/new positions with accept/reject per comment.
 */
class ReanchorReviewSession implements vscode.Disposable {
  private queue: ReanchorResult[];
  private accepted: ReanchorResult[] = [];
  private currentIndex = 0;
  private statusBarItem: vscode.StatusBarItem;

  private oldDecoration: vscode.TextEditorDecorationType;
  private newDecoration: vscode.TextEditorDecorationType;

  constructor(
    private store: SidecarStore,
    private documentUri: vscode.Uri,
    results: ReanchorResult[],
  ) {
    this.queue = [...results];

    this.oldDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(220, 50, 50, 0.15)",
      border: "1px dashed rgba(220, 50, 50, 0.5)",
      isWholeLine: false,
      after: {
        contentText: " ← old anchor",
        color: "rgba(220, 50, 50, 0.7)",
        fontStyle: "italic",
        margin: "0 0 0 8px",
      },
    });

    this.newDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(40, 167, 69, 0.15)",
      border: "1px dashed rgba(40, 167, 69, 0.5)",
      isWholeLine: false,
      after: {
        contentText: " ← new anchor",
        color: "rgba(40, 167, 69, 0.7)",
        fontStyle: "italic",
        margin: "0 0 0 8px",
      },
    });

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
  }

  async start(): Promise<void> {
    if (this.queue.length === 0) return;
    await this.reviewItem(0);
  }

  private async reviewItem(index: number): Promise<void> {
    if (index >= this.queue.length) {
      await this.finish();
      return;
    }

    this.currentIndex = index;
    const result = this.queue[index];
    const comment = this.store.findComment(this.documentUri, result.commentId);

    // Update status bar
    this.statusBarItem.text = `$(sync) Reanchor review: ${index + 1} of ${this.queue.length} (score: ${result.score.toFixed(2)})`;
    this.statusBarItem.show();

    // Show decorations
    const editor = await vscode.window.showTextDocument(this.documentUri);
    this.showDecorations(editor, comment, result);

    // Scroll to the new position
    if (result.newLine != null) {
      const newPos = new vscode.Position(result.newLine - 1, 0);
      editor.revealRange(
        new vscode.Range(newPos, newPos),
        vscode.TextEditorRevealType.InCenter,
      );
    }

    // Show choice
    const commentPreview = comment
      ? comment.text.length > 50
        ? comment.text.substring(0, 50) + "…"
        : comment.text
      : result.commentId;

    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(check) Accept",
          description: `Move to line ${result.newLine ?? "?"}`,
          action: "accept" as const,
        },
        {
          label: "$(x) Reject",
          description: "Keep original position",
          action: "reject" as const,
        },
        {
          label: "$(arrow-right) Skip",
          description: "Leave unchanged for now",
          action: "skip" as const,
        },
        {
          label: "$(check-all) Accept All Remaining",
          description: `Accept all ${this.queue.length - index} remaining`,
          action: "acceptAll" as const,
        },
        {
          label: "$(close-all) Reject All Remaining",
          description: "Keep all original positions",
          action: "rejectAll" as const,
        },
      ],
      {
        placeHolder: `Review: "${commentPreview}" — ${result.status} (score ${result.score.toFixed(2)})`,
        ignoreFocusOut: true,
      },
    );

    this.clearDecorations(editor);

    if (!choice) {
      // User cancelled — finish with what we have
      await this.finish();
      return;
    }

    switch (choice.action) {
      case "accept":
        this.accepted.push(result);
        await this.reviewItem(index + 1);
        break;
      case "reject":
        // Skip, don't add to accepted
        await this.reviewItem(index + 1);
        break;
      case "skip":
        await this.reviewItem(index + 1);
        break;
      case "acceptAll":
        for (let i = index; i < this.queue.length; i++) {
          this.accepted.push(this.queue[i]);
        }
        await this.finish();
        break;
      case "rejectAll":
        await this.finish();
        break;
    }
  }

  private showDecorations(
    editor: vscode.TextEditor,
    comment: { line?: number; end_line?: number; start_column?: number; end_column?: number } | undefined,
    result: ReanchorResult,
  ): void {
    const oldRanges: vscode.DecorationOptions[] = [];
    const newRanges: vscode.DecorationOptions[] = [];

    // Old position
    if (comment?.line != null) {
      const startLine = comment.line - 1;
      const endLine = comment.end_line != null ? comment.end_line - 1 : startLine;
      const startCol = comment.start_column ?? 0;
      const endCol =
        comment.end_column ??
        (editor.document.lineAt(Math.min(endLine, editor.document.lineCount - 1)).text
          .length);
      const safeEndLine = Math.min(endLine, editor.document.lineCount - 1);
      const safeEndCol = Math.min(
        endCol,
        editor.document.lineAt(safeEndLine).text.length,
      );
      oldRanges.push({
        range: new vscode.Range(startLine, startCol, safeEndLine, safeEndCol),
        hoverMessage: new vscode.MarkdownString(
          `**Old anchor** (line ${comment.line})`,
        ),
      });
    }

    // New position
    if (result.newLine != null) {
      const startLine = result.newLine - 1;
      const endLine =
        result.newEndLine != null ? result.newEndLine - 1 : startLine;
      const startCol = result.newStartColumn ?? 0;
      const endCol =
        result.newEndColumn ??
        (editor.document.lineAt(Math.min(endLine, editor.document.lineCount - 1)).text
          .length);
      const safeEndLine = Math.min(endLine, editor.document.lineCount - 1);
      const safeEndCol = Math.min(
        endCol,
        editor.document.lineAt(safeEndLine).text.length,
      );

      const scoreStr = result.score.toFixed(2);
      newRanges.push({
        range: new vscode.Range(startLine, startCol, safeEndLine, safeEndCol),
        hoverMessage: new vscode.MarkdownString(
          `**New anchor** (line ${result.newLine}, score: ${scoreStr})  \n${result.reason}`,
        ),
      });
    }

    editor.setDecorations(this.oldDecoration, oldRanges);
    editor.setDecorations(this.newDecoration, newRanges);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.oldDecoration, []);
    editor.setDecorations(this.newDecoration, []);
  }

  private async finish(): Promise<void> {
    this.statusBarItem.hide();

    // Clear any lingering decorations
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.clearDecorations(editor);
    }

    if (this.accepted.length > 0) {
      const changed = await this.store.applyReanchors(
        this.documentUri,
        this.accepted,
      );
      vscode.window.showInformationMessage(
        `Reanchor complete: ${changed} comment(s) updated.`,
      );
    } else {
      vscode.window.showInformationMessage("Reanchor review complete. No changes applied.");
    }
  }

  dispose(): void {
    this.oldDecoration.dispose();
    this.newDecoration.dispose();
    this.statusBarItem.dispose();
  }
}

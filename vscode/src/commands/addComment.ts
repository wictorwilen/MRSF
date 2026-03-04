/**
 * Add comment commands — line comments and inline (selection) comments.
 */
import * as vscode from "vscode";
import type { SidecarStore } from "../store/SidecarStore.js";
import { vscodeSelectionToMrsf } from "../util/positions.js";

const COMMENT_TYPES = [
  { label: "suggestion", description: "Suggest an improvement" },
  { label: "issue", description: "Report a problem" },
  { label: "question", description: "Ask for clarification" },
  { label: "accuracy", description: "Flag factual concern" },
  { label: "style", description: "Style or formatting" },
  { label: "clarity", description: "Clarity improvement" },
  { label: "(none)", description: "No type" },
];

const SEVERITY_LEVELS = [
  { label: "high", description: "Must address" },
  { label: "medium", description: "Should address" },
  { label: "low", description: "Nice to have" },
  { label: "(none)", description: "No severity" },
];

async function getAuthor(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("sidemark");
  let author = config.get<string>("author");

  if (!author) {
    author = await vscode.window.showInputBox({
      prompt: "Enter your author name (e.g., 'Your Name (username)')",
      placeHolder: "Name (identifier)",
    });
    if (author) {
      // Save for future use
      await config.update("author", author, vscode.ConfigurationTarget.Global);
    }
  }

  return author;
}

export function registerAddLineComment(store: SidecarStore): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.addLineComment",
    async (lineArg?: number, uriArg?: vscode.Uri) => {
      let editor = vscode.window.activeTextEditor;

      // Fallback: when a preview is focused, find a visible markdown editor
      if (!editor || editor.document.languageId !== "markdown") {
        editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.languageId === "markdown",
        ) as vscode.TextEditor | undefined;
      }

      // Determine the target URI and line
      const docUri = editor?.document.languageId === "markdown"
        ? editor.document.uri
        : uriArg;

      if (!docUri) {
        vscode.window.showWarningMessage(
          "Open a Markdown file to add review comments.",
        );
        return;
      }

      let line = lineArg;
      if (line == null && editor && editor.document.uri.toString() === docUri.toString()) {
        line = editor.selection.active.line + 1; // 1-based
      }
      if (line == null) {
        // No editor available (fullscreen preview) — prompt for line
        const input = await vscode.window.showInputBox({
          prompt: "Line number to add comment on",
          placeHolder: "e.g. 10",
          validateInput: (v) => /^\d+$/.test(v.trim()) ? null : "Enter a valid line number",
        });
        if (!input) return;
        line = parseInt(input, 10);
      }

      const text = await vscode.window.showInputBox({
        prompt: `Add comment on line ${line}`,
        placeHolder: "Enter your comment...",
      });
      if (!text) return;

      const typePick = await vscode.window.showQuickPick(COMMENT_TYPES, {
        placeHolder: "Select comment type (optional)",
      });
      const type =
        typePick && typePick.label !== "(none)" ? typePick.label : undefined;

      const sevPick = await vscode.window.showQuickPick(SEVERITY_LEVELS, {
        placeHolder: "Select severity (optional)",
      });
      const severity =
        sevPick && sevPick.label !== "(none)"
          ? (sevPick.label as "low" | "medium" | "high")
          : undefined;

      const author = await getAuthor();
      if (!author) return;

      try {
        await store.addComment(docUri, {
          text,
          author,
          line,
          type,
          severity,
        });
        vscode.window.showInformationMessage(
          `Comment added on line ${line}.`,
        );
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to add comment: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

export function registerAddInlineComment(
  store: SidecarStore,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.addInlineComment",
    async () => {
      let editor = vscode.window.activeTextEditor;

      // Fallback: find a visible markdown editor with a selection
      if (!editor || editor.document.languageId !== "markdown") {
        editor = vscode.window.visibleTextEditors.find(
          (e) =>
            e.document.languageId === "markdown" && !e.selection.isEmpty,
        ) as vscode.TextEditor | undefined;
      }

      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage(
          "Open a Markdown file to add review comments.",
        );
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage(
          "Select text to add an inline comment.",
        );
        return;
      }

      const anchor = vscodeSelectionToMrsf(selection);
      const selectedText = editor.document.getText(selection);

      const text = await vscode.window.showInputBox({
        prompt: `Comment on "${selectedText.length > 50 ? selectedText.substring(0, 50) + "…" : selectedText}"`,
        placeHolder: "Enter your comment...",
      });
      if (!text) return;

      const typePick = await vscode.window.showQuickPick(COMMENT_TYPES, {
        placeHolder: "Select comment type (optional)",
      });
      const type =
        typePick && typePick.label !== "(none)" ? typePick.label : undefined;

      const sevPick = await vscode.window.showQuickPick(SEVERITY_LEVELS, {
        placeHolder: "Select severity (optional)",
      });
      const severity =
        sevPick && sevPick.label !== "(none)"
          ? (sevPick.label as "low" | "medium" | "high")
          : undefined;

      const author = await getAuthor();
      if (!author) return;

      try {
        await store.addComment(editor.document.uri, {
          text,
          author,
          ...anchor,
          type,
          severity,
        });
        const lineStr = anchor.end_line
          ? `lines ${anchor.line}-${anchor.end_line}`
          : `line ${anchor.line}`;
        vscode.window.showInformationMessage(
          `Inline comment added on ${lineStr}.`,
        );
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to add comment: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

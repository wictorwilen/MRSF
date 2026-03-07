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

function toUri(uriArg?: vscode.Uri | string | { fsPath?: string; path?: string }): vscode.Uri | undefined {
  if (!uriArg) return undefined;
  if (uriArg instanceof vscode.Uri) return uriArg;
  if (typeof uriArg === "string") {
    try {
      return uriArg.includes("://") ? vscode.Uri.parse(uriArg) : vscode.Uri.file(uriArg);
    } catch {
      return undefined;
    }
  }
  if (typeof uriArg === "object") {
    if (typeof uriArg.fsPath === "string") return vscode.Uri.file(uriArg.fsPath);
    if (typeof uriArg.path === "string") return vscode.Uri.file(uriArg.path);
  }
  return undefined;
}

function findMarkdownEditor(
  docUri?: vscode.Uri,
  requireSelection = false,
): vscode.TextEditor | undefined {
  const matches = (editor: vscode.TextEditor): boolean => {
    if (editor.document.languageId !== "markdown") return false;
    if (docUri && editor.document.uri.toString() !== docUri.toString()) return false;
    if (requireSelection && editor.selection.isEmpty) return false;
    return true;
  };

  const active = vscode.window.activeTextEditor;
  if (active && matches(active)) return active;

  return vscode.window.visibleTextEditors.find(matches);
}

function normalizeLineCommandArgs(
  lineArg?: unknown,
  uriArg?: unknown,
): { lineArg?: number; uriArg?: vscode.Uri | string | { fsPath?: string; path?: string } } {
  if (Array.isArray(lineArg)) {
    const [line, uri] = lineArg;
    return {
      lineArg: typeof line === "number" ? line : typeof line === "string" ? parseInt(line, 10) : undefined,
      uriArg: uri as vscode.Uri | string | { fsPath?: string; path?: string } | undefined,
    };
  }

  if (lineArg && typeof lineArg === "object" && !(lineArg instanceof vscode.Uri)) {
    const value = lineArg as { line?: unknown; uri?: unknown; documentUri?: unknown };
    const line = value.line;
    return {
      lineArg: typeof line === "number" ? line : typeof line === "string" ? parseInt(line, 10) : undefined,
      uriArg: (value.uri ?? value.documentUri) as vscode.Uri | string | { fsPath?: string; path?: string } | undefined,
    };
  }

  return {
    lineArg: typeof lineArg === "number" ? lineArg : typeof lineArg === "string" ? parseInt(lineArg, 10) : undefined,
    uriArg: uriArg as vscode.Uri | string | { fsPath?: string; path?: string } | undefined,
  };
}

function normalizeInlineCommandArg(
  uriArg?: unknown,
): vscode.Uri | string | { fsPath?: string; path?: string } | undefined {
  if (Array.isArray(uriArg)) {
    return uriArg[0] as vscode.Uri | string | { fsPath?: string; path?: string } | undefined;
  }

  if (uriArg && typeof uriArg === "object" && !(uriArg instanceof vscode.Uri)) {
    const value = uriArg as { uri?: unknown; documentUri?: unknown; fsPath?: string; path?: string };
    return (value.uri ?? value.documentUri ?? value) as vscode.Uri | string | { fsPath?: string; path?: string };
  }

  return uriArg as vscode.Uri | string | { fsPath?: string; path?: string } | undefined;
}

export function registerAddLineComment(store: SidecarStore): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.addLineComment",
    async (lineArg?: unknown, uriArg?: unknown) => {
      const normalized = normalizeLineCommandArgs(lineArg, uriArg);
      const requestedUri = toUri(normalized.uriArg);
      let editor = findMarkdownEditor(requestedUri, false);

      // Determine the target URI and line
      const docUri = editor?.document.languageId === "markdown"
        ? editor.document.uri
        : requestedUri;

      if (!docUri) {
        vscode.window.showWarningMessage(
          "Open a Markdown file to add review comments.",
        );
        return;
      }

      let line = normalized.lineArg;
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
    async (uriArg?: unknown) => {
      const requestedUri = toUri(normalizeInlineCommandArg(uriArg));
      const editor = findMarkdownEditor(requestedUri, true);

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

import * as vscode from "vscode";

export const MARKDOWN_PREVIEW = "vscode.markdown.preview.editor";

export function isLegacyMarkdownPreview(input: unknown): input is vscode.TabInputWebview {
  return input instanceof vscode.TabInputWebview && input.viewType === "mainThreadWebview-markdown.preview";
}

export function resolveDocumentUri(fallback?: vscode.Uri): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
  if (input instanceof vscode.TabInputCustom) {
    return input.viewType === MARKDOWN_PREVIEW ? input.uri : undefined;
  }
  if (input instanceof vscode.TabInputText) {
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === input.uri.toString());
    return document?.languageId === "markdown" ? input.uri : undefined;
  }
  if (input && !isLegacyMarkdownPreview(input)) {
    return undefined;
  }
  const editor = vscode.window.activeTextEditor;
  if (!input && editor) return editor.document.languageId === "markdown" ? editor.document.uri : undefined;
  if (!input && fallback) return fallback;
  const candidates = new Map<string, vscode.Uri>();
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === "markdown") candidates.set(document.uri.toString(), document.uri);
  }
  for (const visible of vscode.window.visibleTextEditors) {
    if (visible.document.languageId === "markdown") candidates.set(visible.document.uri.toString(), visible.document.uri);
  }
  return candidates.size === 1 ? candidates.values().next().value : undefined;
}

export function onDidChangeDocumentContext(listener: () => void): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.window.tabGroups.onDidChangeTabs(listener),
    vscode.window.tabGroups.onDidChangeTabGroups(listener),
    vscode.window.onDidChangeActiveTextEditor(listener),
  );
}
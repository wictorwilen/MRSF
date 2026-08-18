import * as vscode from "vscode";
import { findRepoRoot, getGitUserName } from "@mrsf/cli";
import * as path from "node:path";

export function getConfiguredAuthor(documentUri?: vscode.Uri): string | undefined {
  const author = vscode.workspace
    .getConfiguration("sidemark", documentUri)
    .get<string>("author")
    ?.trim();
  return author || undefined;
}

export async function resolveAuthor(
  documentUri: vscode.Uri,
  prompt = true,
): Promise<string | undefined> {
  const configured = getConfiguredAuthor(documentUri);
  if (configured) return configured;

  if (documentUri.scheme === "file") {
    const repoRoot = await findRepoRoot(path.dirname(documentUri.fsPath));
    if (repoRoot) {
      const gitAuthor = await getGitUserName(repoRoot);
      if (gitAuthor) return gitAuthor;
    }
  }

  if (!prompt) return undefined;

  const author = (
    await vscode.window.showInputBox({
      prompt: "Enter your author name (e.g., 'Your Name (username)')",
      placeHolder: "Name (identifier)",
    })
  )?.trim();

  return author || undefined;
}

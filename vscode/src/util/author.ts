import * as vscode from "vscode";
import { findRepoRoot, getGitUserName } from "@mrsf/cli";
import * as path from "node:path";

const repoRootCache = new Map<string, Promise<string | null>>();
const gitAuthorCache = new Map<string, Promise<string | null>>();

function findCachedRepoRoot(directory: string): Promise<string | null> {
  const cacheKey = path.resolve(directory);
  let repoRoot = repoRootCache.get(cacheKey);
  if (!repoRoot) {
    repoRoot = findRepoRoot(cacheKey);
    repoRootCache.set(cacheKey, repoRoot);
  }
  return repoRoot;
}

function getCachedGitAuthor(repoRoot: string): Promise<string | null> {
  let author = gitAuthorCache.get(repoRoot);
  if (!author) {
    author = getGitUserName(repoRoot);
    gitAuthorCache.set(repoRoot, author);
  }
  return author;
}

export function clearAuthorCache(): void {
  repoRootCache.clear();
  gitAuthorCache.clear();
}

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
    const repoRoot = await findCachedRepoRoot(path.dirname(documentUri.fsPath));
    if (repoRoot) {
      const gitAuthor = await getCachedGitAuthor(repoRoot);
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

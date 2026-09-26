/**
 * Reply, resolve/unresolve, and delete comment commands.
 */
import * as vscode from "vscode";
import type { Comment } from "@mrsf/cli";
import type { SidecarStore } from "../store/SidecarStore.js";
import { resolveAuthor } from "../util/author.js";

/**
 * Dismiss and re-show the hover so the user sees updated state
 * after a resolve/unresolve/reply/delete action triggered from a hover link.
 */
async function refreshHover(uri: vscode.Uri, position?: [number, number]): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uri.toString()) return;
  const selections = editor.selections;
  const target = Array.isArray(position) && position.length === 2
    && position.every((value) => Number.isSafeInteger(value) && value >= 0)
    && position[0] < editor.document.lineCount
    ? new vscode.Position(position[0], Math.min(position[1], editor.document.lineAt(position[0]).text.length))
    : undefined;
  await vscode.commands.executeCommand("editor.action.hideHover");
  if (vscode.window.activeTextEditor !== editor) return;
  const temporarySelection = target ? new vscode.Selection(target, target) : undefined;
  if (temporarySelection) editor.selection = temporarySelection;
  try {
    await vscode.commands.executeCommand("editor.action.showHover", { focus: "noAutoFocus" });
  } finally {
    if (temporarySelection && vscode.window.activeTextEditor === editor
      && editor.selection.isEqual(temporarySelection)) {
      editor.selections = selections;
    }
  }
}

/**
 * Prompt the user to select a comment from the active document.
 */
async function pickComment(
  sourceComments: readonly Comment[],
  label: string,
  filterResolved?: boolean,
): Promise<string | undefined> {
  const comments = sourceComments.filter((c) => {
    if (filterResolved === true) return !c.resolved;
    if (filterResolved === false) return c.resolved;
    return true;
  });

  if (comments.length === 0) {
    vscode.window.showInformationMessage("No matching comments found.");
    return undefined;
  }

  const items = comments.map((c) => ({
    label: c.text.length > 60 ? c.text.substring(0, 60) + "…" : c.text,
    description: `by ${c.author}${c.line ? ` · L${c.line}` : ""}`,
    detail: c.resolved ? "✅ resolved" : "💬 open",
    commentId: c.id,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: label,
  });

  return pick?.commentId;
}

async function getTarget(store: SidecarStore, uriArg?: string | vscode.Uri) {
  if (uriArg === undefined) return store.getForActiveOrVisible();
  try {
    const uri = typeof uriArg === "string" ? vscode.Uri.parse(uriArg) : uriArg;
    return uri.scheme === "file" ? store.getForActiveOrVisible(uri) : null;
  } catch {
    return null;
  }
}

export function registerReplyToComment(
  store: SidecarStore,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.replyToComment",
    async (commentIdArg?: string, documentUri?: string | vscode.Uri, hoverPosition?: [number, number]) => {
      const active = await getTarget(store, documentUri);
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ?? (await pickComment(active.doc.comments, "Select comment to reply to"));
      if (!commentId) return;

      const parent = store.findComment(active.uri, commentId);
      if (!parent) {
        vscode.window.showErrorMessage("Comment not found.");
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: `Reply to "${parent.text.length > 40 ? parent.text.substring(0, 40) + "…" : parent.text}"`,
        placeHolder: "Enter your reply...",
      });
      if (!text) return;

      const author = await resolveAuthor(active.uri);
      if (!author) return;

      try {
        await store.replyToComment(active.uri, commentId, text, author);
        await refreshHover(active.uri, hoverPosition);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to reply: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

export function registerResolveComment(
  store: SidecarStore,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.resolveComment",
    async (commentIdArg?: string, documentUri?: string | vscode.Uri, hoverPosition?: [number, number]) => {
      const active = await getTarget(store, documentUri);
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ??
        (await pickComment(active.doc.comments, "Select comment to resolve", true));
      if (!commentId) return;

      // Check if there are direct replies → offer cascade
      const threads = store.getCommentThreads(active.uri);
      const thread = threads.get(commentId);
      let cascade = false;
      if (thread && thread.length > 1) {
        const choice = await vscode.window.showQuickPick(
          [
            { label: "This comment only", cascade: false },
            { label: "This comment + direct replies", cascade: true },
          ],
          { placeHolder: "Resolve scope" },
        );
        if (!choice) return;
        cascade = choice.cascade;
      }

      const result = await store.resolveComment(
        active.uri,
        commentId,
        cascade,
      );
      if (result) {
        await refreshHover(active.uri, hoverPosition);
      } else {
        vscode.window.showErrorMessage("Comment not found.");
      }
    },
  );
}

export function registerUnresolveComment(
  store: SidecarStore,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.unresolveComment",
    async (commentIdArg?: string, documentUri?: string | vscode.Uri, hoverPosition?: [number, number]) => {
      const active = await getTarget(store, documentUri);
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ??
        (await pickComment(active.doc.comments, "Select comment to unresolve", false));
      if (!commentId) return;

      const result = await store.unresolveComment(active.uri, commentId);
      if (result) {
        await refreshHover(active.uri, hoverPosition);
      } else {
        vscode.window.showErrorMessage("Comment not found.");
      }
    },
  );
}

export function registerDeleteComment(
  store: SidecarStore,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.deleteComment",
    async (commentIdArg?: string, documentUri?: string | vscode.Uri) => {
      const active = await getTarget(store, documentUri);
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ?? (await pickComment(active.doc.comments, "Select comment to delete"));
      if (!commentId) return;

      // Check if there are direct replies → offer cascade vs promote
      const threads = store.getCommentThreads(active.uri);
      const thread = threads.get(commentId);
      let cascade = false;

      if (thread && thread.length > 1) {
        const choice = await vscode.window.showQuickPick(
          [
            {
              label: "Delete this comment only",
              description: "Replies will be promoted and re-anchored",
              cascade: false,
            },
            {
              label: "Delete with all replies",
              description: "Remove this comment and its direct replies",
              cascade: true,
            },
          ],
          { placeHolder: "This comment has replies — how should they be handled?" },
        );
        if (!choice) return;
        cascade = choice.cascade;
      }

      const confirmed = await vscode.window.showWarningMessage(
        cascade
          ? "Delete this comment and its replies?"
          : "Are you sure you want to delete this comment?",
        { modal: true },
        "Delete",
      );
      if (confirmed !== "Delete") return;

      const result = await store.deleteComment(active.uri, commentId, cascade);
      if (result) {
        vscode.window.showInformationMessage("Comment deleted.");
      } else {
        vscode.window.showErrorMessage("Comment not found.");
      }
    },
  );
}

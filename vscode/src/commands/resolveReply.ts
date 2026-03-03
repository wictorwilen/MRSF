/**
 * Reply, resolve/unresolve, and delete comment commands.
 */
import * as vscode from "vscode";
import type { SidecarStore } from "../store/SidecarStore.js";

/**
 * Dismiss and re-show the hover so the user sees updated state
 * after a resolve/unresolve/reply/delete action triggered from a hover link.
 */
function refreshHover(): void {
  // Small delay lets the store's onDidChange fire and decorations update first
  setTimeout(() => {
    vscode.commands.executeCommand("editor.action.showHover");
  }, 120);
}

/**
 * Prompt the user to select a comment from the active document.
 */
async function pickComment(
  store: SidecarStore,
  label: string,
  filterResolved?: boolean,
): Promise<string | undefined> {
  const active = await store.getForActiveEditor();
  if (!active) {
    vscode.window.showWarningMessage("No review sidecar found for this file.");
    return undefined;
  }

  const comments = active.doc.comments.filter((c) => {
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

export function registerReplyToComment(
  store: SidecarStore,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "mrsf.replyToComment",
    async (commentIdArg?: string) => {
      const active = await store.getForActiveEditor();
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ?? (await pickComment(store, "Select comment to reply to"));
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

      const config = vscode.workspace.getConfiguration("sidemark");
      let author = config.get<string>("author");
      if (!author) {
        author = await vscode.window.showInputBox({
          prompt: "Enter your author name",
          placeHolder: "Name (identifier)",
        });
        if (!author) return;
        await config.update(
          "author",
          author,
          vscode.ConfigurationTarget.Global,
        );
      }

      try {
        await store.replyToComment(active.uri, commentId, text, author);
        refreshHover();
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
    async (commentIdArg?: string) => {
      const active = await store.getForActiveEditor();
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ??
        (await pickComment(store, "Select comment to resolve", true));
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
        refreshHover();
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
    async (commentIdArg?: string) => {
      const active = await store.getForActiveEditor();
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ??
        (await pickComment(store, "Select comment to unresolve", false));
      if (!commentId) return;

      const result = await store.unresolveComment(active.uri, commentId);
      if (result) {
        refreshHover();
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
    async (commentIdArg?: string) => {
      const active = await store.getForActiveEditor();
      if (!active) {
        vscode.window.showWarningMessage("No review sidecar found.");
        return;
      }

      const commentId =
        commentIdArg ?? (await pickComment(store, "Select comment to delete"));
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

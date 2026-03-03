/**
 * MrsfHoverProvider — shows rich comment cards when hovering over
 * lines or text ranges that have MRSF comments anchored to them.
 */
import * as vscode from "vscode";
import type { Comment } from "@mrsf/cli";
import type { SidecarStore } from "../store/SidecarStore.js";
import { mrsfToVscodeRange, relativeTime } from "../util/positions.js";

export class MrsfHoverProvider implements vscode.HoverProvider, vscode.Disposable {
  private registration: vscode.Disposable;

  constructor(private store: SidecarStore) {
    this.registration = vscode.languages.registerHoverProvider(
      { language: "markdown" },
      this,
    );
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.Hover | null {
    const mrsfDoc = this.store.get(document.uri);
    if (!mrsfDoc) return null;

    const config = vscode.workspace.getConfiguration("sidemark");
    const showResolved = config.get<boolean>("showResolved", true);

    // Find comments whose anchor range contains the hover position
    const matchingRoots: Comment[] = [];
    for (const comment of mrsfDoc.comments) {
      if (comment.reply_to) continue; // Only show root comments as entry points
      if (!showResolved && comment.resolved) continue;
      const range = mrsfToVscodeRange(comment, document);
      if (!range) continue;
      if (range.contains(position)) {
        matchingRoots.push(comment);
      }
    }

    if (matchingRoots.length === 0) return null;

    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.supportHtml = true;

    for (let i = 0; i < matchingRoots.length; i++) {
      if (i > 0) md.appendMarkdown("\n---\n\n");
      const root = matchingRoots[i];
      this.renderThread(md, root, mrsfDoc.comments);
    }

    return new vscode.Hover(md);
  }

  private renderThread(
    md: vscode.MarkdownString,
    root: Comment,
    allComments: Comment[],
  ): void {
    // Root comment
    this.renderComment(md, root, true);

    // Replies
    const replies = allComments
      .filter((c) => c.reply_to === root.id)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

    for (const reply of replies) {
      md.appendMarkdown("> ");
      this.renderComment(md, reply, false);
    }

    // Actions
    md.appendMarkdown("\n");
    const idArg = encodeURIComponent(JSON.stringify(root.id));
    if (!root.resolved) {
      md.appendMarkdown(
        `[$(check) Resolve](command:mrsf.resolveComment?${idArg}) `,
      );
    } else {
      md.appendMarkdown(
        `[$(circle-slash) Unresolve](command:mrsf.unresolveComment?${idArg}) `,
      );
    }
    md.appendMarkdown(
      `[$(comment-discussion) Reply](command:mrsf.replyToComment?${idArg}) `,
    );
    md.appendMarkdown(
      `[$(trash) Delete](command:mrsf.deleteComment?${idArg}) `,
    );
    md.appendMarkdown("\n");
  }

  private renderComment(
    md: vscode.MarkdownString,
    comment: Comment,
    isRoot: boolean,
  ): void {
    const time = relativeTime(comment.timestamp);
    const status = comment.resolved ? "✅" : "💬";
    const badges: string[] = [];
    if (comment.type) badges.push(`\`${comment.type}\``);
    if (comment.severity) badges.push(`\`${comment.severity}\``);
    const badgeStr = badges.length > 0 ? " " + badges.join(" ") : "";

    if (isRoot) {
      md.appendMarkdown(
        `${status} **${this.esc(comment.author)}** · ${time}${badgeStr}  \n`,
      );
    } else {
      md.appendMarkdown(
        `**${this.esc(comment.author)}** · ${time}  \n`,
      );
    }
    md.appendMarkdown(`${this.esc(comment.text)}  \n\n`);
  }

  private esc(text: string): string {
    return text.replace(/([*_`~[\]()\\])/g, "\\$1");
  }

  dispose(): void {
    this.registration.dispose();
  }
}

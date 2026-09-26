/**
 * FileWatcher — watches for sidecar file and Markdown file changes
 * and triggers SidecarStore cache invalidation.
 */
import * as vscode from "vscode";
import type { SidecarStore } from "./SidecarStore.js";

export class FileWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  constructor(private store: SidecarStore) {
    // Watch sidecar files for changes
    const sidecarWatcher = vscode.workspace.createFileSystemWatcher(
      "**/*.review.{yaml,json}",
    );

    sidecarWatcher.onDidChange((uri) => this.onSidecarChanged(uri));
    sidecarWatcher.onDidCreate((uri) => this.onSidecarChanged(uri));
    sidecarWatcher.onDidDelete((uri) => this.onSidecarDeleted(uri));

    this.disposables.push(sidecarWatcher);

    // Watch markdown files for renames
    const mdWatcher = vscode.workspace.createFileSystemWatcher("**/*.md");
    mdWatcher.onDidDelete((uri) => this.onMarkdownDeleted(uri));
    this.disposables.push(mdWatcher);
  }

  private onSidecarChanged(sidecarUri: vscode.Uri): void {
    // Skip if this change was caused by our own save
    if (this.store.isSaving(sidecarUri.fsPath)) return;

    void this.store.reloadSidecar(sidecarUri).catch(() => {});
  }

  private onSidecarDeleted(sidecarUri: vscode.Uri): void {
    void this.store.reloadSidecar(sidecarUri).catch(() => {});
  }

  private onMarkdownDeleted(_uri: vscode.Uri): void {
    // When a Markdown file is deleted, invalidate its sidecar cache  
    this.store.invalidate(_uri);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

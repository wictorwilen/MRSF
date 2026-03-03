/**
 * MRSF Status Bar — shows a persistent status indicator with
 * a spinner animation while long-running operations are in progress,
 * and an orange warning when reanchoring is recommended.
 */
import * as vscode from "vscode";

const IDLE_ICON = "$(comment-discussion)";
const SPINNER_ICON = "$(sync~spin)";
const WARNING_ICON = "$(warning)";

export class MrsfStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private activeOps = 0;
  private commentCount = 0;
  private staleCount = 0;
  private dirtyAnchors = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.item.command = "mrsf.refreshComments";
    this.setIdle();
    this.item.show();
  }

  /** Update the resting comment count shown in the status bar. */
  setCommentCount(count: number): void {
    this.commentCount = count;
    if (this.activeOps === 0) {
      this.setIdle();
    }
  }

  /**
   * Set the number of stale comments that need reanchoring.
   * When > 0, shows an orange warning and changes the click command to reanchor.
   */
  setStaleCount(count: number): void {
    this.staleCount = count;
    if (this.activeOps === 0) {
      this.setIdle();
    }
  }

  /**
   * Indicate that the current document has unsaved line changes
   * causing comment anchors to drift. Cleared after save + reanchor.
   */
  setDirtyAnchors(dirty: boolean): void {
    this.dirtyAnchors = dirty;
    if (this.activeOps === 0) {
      this.setIdle();
    }
  }

  /**
   * Wrap an async operation so the status bar shows a spinner
   * and tooltip while it runs. Supports concurrent operations —
   * the spinner stays active until all complete.
   */
  async withProgress<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.activeOps++;
    this.setBusy(label);
    try {
      return await fn();
    } finally {
      this.activeOps--;
      if (this.activeOps <= 0) {
        this.activeOps = 0;
        this.setIdle();
      }
    }
  }

  private setIdle(): void {
    if (this.staleCount > 0) {
      this.item.text = `${WARNING_ICON} Sidemark: ${this.staleCount} stale`;
      this.item.tooltip = `${this.staleCount} comment(s) may have drifted — click to reanchor`;
      this.item.command = "mrsf.reanchor";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else if (this.dirtyAnchors) {
      this.item.text = `${WARNING_ICON} Sidemark: anchors drifted`;
      this.item.tooltip = "Lines changed — save to reanchor comments";
      this.item.command = "mrsf.refreshComments";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else {
      this.item.text =
        this.commentCount > 0
          ? `${IDLE_ICON} Sidemark: ${this.commentCount}`
          : `${IDLE_ICON} Sidemark`;
      this.item.tooltip = "Sidemark — Click to refresh comments";
      this.item.command = "mrsf.refreshComments";
      this.item.backgroundColor = undefined;
    }
  }

  private setBusy(label: string): void {
    this.item.text = `${SPINNER_ICON} Sidemark: ${label}`;
    this.item.tooltip = `Sidemark — ${label}`;
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

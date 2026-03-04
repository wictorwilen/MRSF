/**
 * SidecarStore — central data model for loaded MRSF sidecar documents.
 *
 * Manages parsing, caching, mutation, and persistence of sidecar files,
 * delegating all MRSF logic to @mrsf/cli.
 */
import * as vscode from "vscode";
import {
  type MrsfDocument,
  type Comment,
  type AddCommentOptions,
  type ReanchorResult,
  type ReanchorOptions,
  type CommentFilter,
  type CommentSummary,
  discoverSidecar,
  parseSidecar,
  readDocumentLines,
  writeSidecar,
  addComment as cliAddComment,
  populateSelectedText,
  resolveComment as cliResolveComment,
  unresolveComment as cliUnresolveComment,
  removeComment as cliRemoveComment,
  filterComments,
  getThreads,
  summarize,
  reanchorDocument,
  applyReanchorResults,
  findWorkspaceRoot,
  findRepoRoot,
  getCurrentCommit,
  isStale,
} from "@mrsf/cli";
import { applyLineShifts } from "./LiveLineTracker.js";
import * as path from "node:path";
import * as fs from "node:fs";

interface CacheEntry {
  doc: MrsfDocument;
  sidecarPath: string;
  documentPath: string;
}

export class SidecarStore implements vscode.Disposable {
  private cache = new Map<string, CacheEntry>();
  private workspaceRoot: string | undefined;
  private repoRoot: string | undefined;

  /** Guard: skip FileWatcher invalidation for our own saves. */
  private _savingPaths = new Set<string>();

  /**
   * Documents whose in-memory comment positions have been shifted by
   * live edits but not yet persisted to disk.  Cleared after a successful
   * save + reanchor cycle.
   */
  private _pendingShifts = new Set<string>();

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private readonly _onDidCreate = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidCreate = this._onDidCreate.event;

  private readonly _onDidDelete = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidDelete = this._onDidDelete.event;

  private _rootsReady: Promise<void>;

  constructor() {
    this._rootsReady = this.detectRoots();
  }

  private async detectRoots(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const root = folders[0].uri.fsPath;
      try {
        this.workspaceRoot = findWorkspaceRoot(root);
      } catch {
        this.workspaceRoot = root;
      }
      try {
        this.repoRoot = (await findRepoRoot(root)) ?? undefined;
      } catch {
        this.repoRoot = undefined;
      }
    }
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  getRepoRoot(): string | undefined {
    return this.repoRoot;
  }

  /**
   * Load (or reload) the sidecar for a given Markdown document.
   * Returns the parsed MrsfDocument or null if no sidecar exists.
   */
  async load(documentUri: vscode.Uri): Promise<MrsfDocument | null> {
    await this._rootsReady;
    const docPath = documentUri.fsPath;
    try {
      const sidecarPath = await discoverSidecar(docPath, {
        cwd: this.workspaceRoot,
      });

      if (!fs.existsSync(sidecarPath)) {
        this.cache.delete(docPath);
        return null;
      }

      const doc = await parseSidecar(sidecarPath);
      const entry: CacheEntry = { doc, sidecarPath, documentPath: docPath };
      this.cache.set(docPath, entry);
      this._onDidChange.fire(documentUri);
      return doc;
    } catch {
      this.cache.delete(docPath);
      return null;
    }
  }

  /**
   * Get the cached MrsfDocument for a document URI, or null.
   */
  get(documentUri: vscode.Uri): MrsfDocument | null {
    return this.cache.get(documentUri.fsPath)?.doc ?? null;
  }

  /**
   * Get the sidecar file path for a document URI.
   */
  getSidecarPath(documentUri: vscode.Uri): string | null {
    return this.cache.get(documentUri.fsPath)?.sidecarPath ?? null;
  }

  /**
   * Save the sidecar document to disk.
   */
  async save(documentUri: vscode.Uri): Promise<void> {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry) return;
    // Mark path so FileWatcher skips invalidation for our own write
    this._savingPaths.add(entry.sidecarPath);
    try {
      await writeSidecar(entry.sidecarPath, entry.doc);
    } finally {
      // Clear after a short delay so the FileWatcher event has time to arrive
      setTimeout(() => this._savingPaths.delete(entry.sidecarPath), 500);
    }
    this._onDidChange.fire(documentUri);
  }

  /** Check if a sidecar path is currently being saved by us. */
  isSaving(sidecarPath: string): boolean {
    return this._savingPaths.has(sidecarPath);
  }

  /**
   * Invalidate cache for a document, triggering a reload on next access.
   */
  invalidate(documentUri: vscode.Uri): void {
    this.cache.delete(documentUri.fsPath);
    this._onDidChange.fire(documentUri);
  }

  /**
   * Invalidate cache entry by sidecar path (used by FileWatcher).
   */
  invalidateBySidecarPath(sidecarPath: string): void {
    for (const [docPath, entry] of this.cache.entries()) {
      if (entry.sidecarPath === sidecarPath) {
        this.cache.delete(docPath);
        this._onDidChange.fire(vscode.Uri.file(docPath));
        return;
      }
    }
  }

  // ── Live editing ──────────────────────────────────────────────

  /**
   * Apply line-shift adjustments to in-memory comment positions based on
   * document edits.  This keeps decorations aligned in real-time without
   * touching the sidecar file on disk.
   *
   * Returns true if any comment was shifted (so the caller can update
   * decorations).
   */
  applyLiveEdits(
    documentUri: vscode.Uri,
    changes: readonly import("vscode").TextDocumentContentChangeEvent[],
  ): boolean {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry || entry.doc.comments.length === 0) return false;

    const moved = applyLineShifts(entry.doc.comments, changes);
    if (moved) {
      this._pendingShifts.add(documentUri.fsPath);
      this._onDidChange.fire(documentUri);
    }
    return moved;
  }

  /**
   * Whether a document has in-memory position shifts that haven't been
   * persisted yet.
   */
  hasPendingShifts(documentUri: vscode.Uri): boolean {
    return this._pendingShifts.has(documentUri.fsPath);
  }

  /**
   * Clear the pending-shifts flag for a document (after a successful
   * save + reanchor cycle).
   */
  clearPendingShifts(documentUri: vscode.Uri): void {
    this._pendingShifts.delete(documentUri.fsPath);
  }

  /**
   * Reload comment positions from the on-disk sidecar, discarding any
   * in-memory line shifts.  Called before full reanchor on save.
   */
  async reloadFromDisk(documentUri: vscode.Uri): Promise<void> {
    await this.load(documentUri);
    this._pendingShifts.delete(documentUri.fsPath);
  }

  /**
   * Get the MrsfDocument for the current active editor, loading if needed.
   */
  async getForActiveEditor(): Promise<{
    doc: MrsfDocument;
    uri: vscode.Uri;
  } | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") return null;

    const uri = editor.document.uri;
    let doc = this.get(uri);
    if (!doc) {
      doc = await this.load(uri);
    }
    if (!doc) return null;
    return { doc, uri };
  }

  // ── Comment operations ──────────────────────────────────────

  /**
   * Add a new comment to the sidecar for a document.
   * Creates the sidecar file if it doesn't exist.
   */
  async addComment(
    documentUri: vscode.Uri,
    opts: AddCommentOptions,
  ): Promise<Comment> {
    const docPath = documentUri.fsPath;
    let entry = this.cache.get(docPath);

    if (!entry) {
      // Create new sidecar
      await this._rootsReady;
      const sidecarPath = await discoverSidecar(docPath, {
        cwd: this.workspaceRoot,
      });
      const relativePath = this.workspaceRoot
        ? path.relative(this.workspaceRoot, docPath)
        : path.basename(docPath);
      const doc: MrsfDocument = {
        mrsf_version: "1.0",
        document: relativePath,
        comments: [],
      };
      entry = { doc, sidecarPath, documentPath: docPath };
      this.cache.set(docPath, entry);
    }

    const comment = await cliAddComment(entry.doc, opts, this.repoRoot);

    // Populate selected_text from document content when line info is present
    if (comment.line != null) {
      try {
        const lines = await readDocumentLines(docPath);
        populateSelectedText(comment, lines);
      } catch {
        // Best effort — file may not be saved yet
      }
    }

    await this.save(documentUri);
    this._onDidCreate.fire(documentUri);
    return comment;
  }

  /**
   * Resolve a comment by ID.
   */
  async resolveComment(
    documentUri: vscode.Uri,
    commentId: string,
    cascade?: boolean,
  ): Promise<boolean> {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry) return false;
    const result = resolveComment(entry.doc, commentId, cascade);
    if (result) await this.save(documentUri);
    return result;
  }

  /**
   * Unresolve a comment by ID.
   */
  async unresolveComment(
    documentUri: vscode.Uri,
    commentId: string,
  ): Promise<boolean> {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry) return false;
    const result = unresolveComment(entry.doc, commentId);
    if (result) await this.save(documentUri);
    return result;
  }

  /**
   * Delete a comment by ID.
   */
  async deleteComment(
    documentUri: vscode.Uri,
    commentId: string,
    cascade?: boolean,
  ): Promise<boolean> {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry) return false;
    const result = removeComment(entry.doc, commentId, cascade);
    if (result) {
      await this.save(documentUri);
      this._onDidDelete.fire(documentUri);
    }
    return result;
  }

  /**
   * Reply to an existing comment.
   */
  async replyToComment(
    documentUri: vscode.Uri,
    parentId: string,
    text: string,
    author: string,
  ): Promise<Comment> {
    return this.addComment(documentUri, {
      text,
      author,
      reply_to: parentId,
    });
  }

  // ── Query operations ────────────────────────────────────────

  /**
   * Get filtered comments for a document.
   */
  getComments(
    documentUri: vscode.Uri,
    filter?: CommentFilter,
  ): Comment[] {
    const doc = this.get(documentUri);
    if (!doc) return [];
    return filter ? filterComments(doc.comments, filter) : doc.comments;
  }

  /**
   * Get threaded comments (root → replies map).
   */
  getCommentThreads(
    documentUri: vscode.Uri,
  ): Map<string, Comment[]> {
    const doc = this.get(documentUri);
    if (!doc) return new Map();
    return getThreads(doc.comments);
  }

  /**
   * Get comment summary statistics.
   */
  getSummary(documentUri: vscode.Uri): CommentSummary | null {
    const doc = this.get(documentUri);
    if (!doc) return null;
    return summarize(doc.comments);
  }

  /**
   * Find a comment by ID.
   */
  findComment(
    documentUri: vscode.Uri,
    commentId: string,
  ): Comment | undefined {
    const doc = this.get(documentUri);
    if (!doc) return undefined;
    return doc.comments.find((c) => c.id === commentId);
  }

  /**
   * Check if any comments in the sidecar for a document are stale
   * (their commit differs from HEAD). Returns the count of stale comments.
   */
  async checkStaleness(documentUri: vscode.Uri): Promise<number> {
    if (!this.repoRoot) return 0;
    const doc = this.get(documentUri);
    if (!doc || doc.comments.length === 0) return 0;

    let staleCount = 0;
    for (const comment of doc.comments) {
      if (comment.commit) {
        const stale = await isStale(comment.commit, this.repoRoot);
        if (stale) staleCount++;
      }
    }
    return staleCount;
  }

  // ── Reanchor ────────────────────────────────────────────────

  /**
   * Reanchor all comments for a document.
   * Returns raw results for review; does NOT auto-apply.
   */
  async reanchorComments(
    documentUri: vscode.Uri,
    opts?: Partial<ReanchorOptions>,
  ): Promise<ReanchorResult[]> {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry) return [];

    const lines = await readDocumentLines(entry.documentPath);

    return reanchorDocument(entry.doc, lines, {
      ...opts,
      documentPath: entry.documentPath,
      repoRoot: this.repoRoot,
    } as ReanchorOptions & {
      documentPath?: string;
      repoRoot?: string;
    });
  }

  /**
   * Apply accepted reanchor results and persist.
   * Also updates each affected comment's `commit` to the current HEAD
   * so that subsequent reanchor runs don't re-process them.
   */
  async applyReanchors(
    documentUri: vscode.Uri,
    results: ReanchorResult[],
    updateText?: boolean,
  ): Promise<number> {
    const entry = this.cache.get(documentUri.fsPath);
    if (!entry) return 0;
    const changed = applyReanchorResults(entry.doc, results, { updateText });

    // Always update commit hash on accepted reanchor results so they are no
    // longer stale, even when positions didn't move (changed === 0).
    let commitUpdated = false;
    let headCommit: string | undefined;
    if (this.repoRoot) {
      try {
        headCommit = (await getCurrentCommit(this.repoRoot)) ?? undefined;
      } catch {
        // best effort
      }
    }
    if (headCommit) {
      const acceptedIds = new Set(results.map((r) => r.commentId));
      for (const comment of entry.doc.comments) {
        if (acceptedIds.has(comment.id) && comment.commit && comment.commit !== headCommit) {
          comment.commit = headCommit;
          commitUpdated = true;
        }
      }
    }

    if (changed > 0 || commitUpdated) {
      await this.save(documentUri);
    }
    return changed;
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidCreate.dispose();
    this._onDidDelete.dispose();
    this.cache.clear();
  }
}

// Helper: wrap the CLI functions that use different import names
function resolveComment(
  doc: MrsfDocument,
  id: string,
  cascade?: boolean,
): boolean {
  return cliResolveComment(doc, id, cascade);
}

function unresolveComment(doc: MrsfDocument, id: string): boolean {
  return cliUnresolveComment(doc, id);
}

function removeComment(doc: MrsfDocument, id: string, cascade?: boolean): boolean {
  return cliRemoveComment(doc, id, cascade ? { cascade: true } : undefined);
}

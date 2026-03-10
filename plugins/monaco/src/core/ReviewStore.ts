import {
  applyReanchorResults,
  reanchorDocumentLines,
} from "@mrsf/cli/browser";
import type { Comment, MrsfDocument } from "@mrsf/cli/browser";
import type { MonacoMrsfHostAdapter } from "../host/HostAdapter.js";
import { splitDocumentLines } from "../host/HostAdapter.js";
import type {
  CommentDraft,
  DocumentGeometry,
  EditorContentChange,
  ReviewLoadOptions,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
} from "../types.js";
import {
  addComment as addBrowserComment,
  populateSelectedText,
  removeComment,
  resolveComment,
  setSelectedText,
  unresolveComment,
} from "./browserComments.js";
import { applyLineShifts } from "./liveLineTracker.js";
import { projectDecorationSnapshot } from "./threadProjection.js";

function geometryFromLines(lines: string[]): DocumentGeometry {
  return {
    lineCount: lines.length,
    getLineLength: (lineIndex: number) => lines[lineIndex]?.length ?? 0,
  };
}

function createEmptyDocument(documentPath: string | null, resourceId: string): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: documentPath ?? resourceId,
    comments: [],
  };
}

export class ReviewStore {
  private states = new Map<string, ReviewState>();
  private listeners = new Set<(state: ReviewState) => void>();

  constructor(
    private readonly host: MonacoMrsfHostAdapter,
    private readonly options: { showResolved?: boolean } = {},
  ) {}

  getHostAdapter(): MonacoMrsfHostAdapter {
    return this.host;
  }

  subscribe(listener: (state: ReviewState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(resourceId: string): ReviewState | null {
    return this.states.get(resourceId) ?? null;
  }

  getThreadsAtLine(resourceId: string, line: number): ReviewThread[] {
    const state = this.requireState(resourceId);
    const lineSnapshot = state.snapshot.threadsByLine.find((entry) => entry.line === line);
    if (!lineSnapshot) return [];

    const commentsById = new Map(state.document.comments.map((comment) => [comment.id, comment]));

    return lineSnapshot.threads
      .map((thread) => {
        const rootComment = commentsById.get(thread.rootCommentId);
        if (!rootComment) return null;
        const replies = thread.commentIds
          .slice(1)
          .map((id) => commentsById.get(id))
          .filter((comment): comment is Comment => !!comment);

        return {
          line,
          rootComment,
          replies,
        } satisfies ReviewThread;
      })
      .filter((thread): thread is ReviewThread => !!thread);
  }

  async load(resourceId: string, options: ReviewLoadOptions = {}): Promise<ReviewState> {
    const documentText = options.documentText ?? await this.host.getDocumentText(resourceId);
    const documentPath = this.host.getDocumentPath
      ? await this.host.getDocumentPath(resourceId)
      : null;
    const sidecarPath = await this.host.discoverSidecar(resourceId);
    const loaded = sidecarPath ? await this.host.readSidecar(sidecarPath) : null;
    const document = loaded ?? createEmptyDocument(documentPath, resourceId);
    const documentLines = splitDocumentLines(documentText);
    const geometry = options.geometry ?? geometryFromLines(documentLines);
    const snapshot = projectDecorationSnapshot(document, {
      showResolved: this.options.showResolved,
      geometry,
    });

    const state: ReviewState = {
      resourceId,
      document,
      sidecarPath,
      documentPath,
      documentLines,
      snapshot,
      loaded: true,
      dirty: false,
      hasPendingShifts: false,
      lastReanchorResults: [],
    };

    this.states.set(resourceId, state);
    this.emit(state);
    return state;
  }

  refresh(resourceId: string, documentText: string, geometry?: DocumentGeometry): ReviewState {
    const state = this.requireState(resourceId);
    state.documentLines = splitDocumentLines(documentText);
    state.snapshot = projectDecorationSnapshot(state.document, {
      showResolved: this.options.showResolved,
      geometry: geometry ?? geometryFromLines(state.documentLines),
    });
    this.emit(state);
    return state;
  }

  applyLiveEdits(
    resourceId: string,
    changes: readonly EditorContentChange[],
    documentText: string,
    geometry?: DocumentGeometry,
  ): ReviewState {
    const state = this.requireState(resourceId);
    const moved = applyLineShifts(state.document.comments, changes);
    state.documentLines = splitDocumentLines(documentText);
    state.snapshot = projectDecorationSnapshot(state.document, {
      showResolved: this.options.showResolved,
      geometry: geometry ?? geometryFromLines(state.documentLines),
    });
    state.dirty = state.dirty || moved;
    state.hasPendingShifts = state.hasPendingShifts || moved;
    this.emit(state);
    return state;
  }

  async addComment(resourceId: string, draft: CommentDraft): Promise<Comment> {
    const state = this.requireState(resourceId);
    const comment = await addBrowserComment(state.document, {
      text: draft.text,
      author: draft.author ?? "Unknown",
      line: draft.line,
      end_line: draft.end_line,
      start_column: draft.start_column,
      end_column: draft.end_column,
      type: draft.type,
      severity: draft.severity,
    });

    if (!draft.selected_text) {
      await populateSelectedText(comment, state.documentLines);
    } else {
      await setSelectedText(comment, draft.selected_text);
    }

    this.recomputeState(state);
    return comment;
  }

  async reply(resourceId: string, parentId: string, draft: Omit<CommentDraft, "line">): Promise<Comment> {
    const state = this.requireState(resourceId);
    const parent = state.document.comments.find((comment) => comment.id === parentId);
    if (!parent) {
      throw new Error(`Unknown parent comment '${parentId}'.`);
    }

    const comment = await addBrowserComment(state.document, {
      text: draft.text,
      author: draft.author ?? "Unknown",
      reply_to: parentId,
      line: parent.line,
      end_line: draft.end_line ?? parent.end_line,
      start_column: draft.start_column ?? parent.start_column,
      end_column: draft.end_column ?? parent.end_column,
      type: draft.type,
      severity: draft.severity,
    });

    if (draft.selected_text) {
      await setSelectedText(comment, draft.selected_text);
    } else if (parent.selected_text) {
      await setSelectedText(comment, parent.selected_text);
    }

    this.recomputeState(state);
    return comment;
  }

  edit(resourceId: string, commentId: string, draft: Partial<CommentDraft> & { text: string }): Comment {
    const state = this.requireState(resourceId);
    const comment = state.document.comments.find((entry) => entry.id === commentId);
    if (!comment) {
      throw new Error(`Unknown comment '${commentId}'.`);
    }

    comment.text = draft.text;
    if (draft.type !== undefined) {
      comment.type = draft.type;
    }
    if (draft.severity !== undefined) {
      comment.severity = draft.severity;
    }
    if (draft.selected_text !== undefined) {
      comment.selected_text = draft.selected_text;
    }

    this.recomputeState(state);
    return comment;
  }

  resolve(resourceId: string, commentId: string): boolean {
    const state = this.requireState(resourceId);
    const changed = resolveComment(state.document, commentId);
    if (changed) this.recomputeState(state);
    return changed;
  }

  unresolve(resourceId: string, commentId: string): boolean {
    const state = this.requireState(resourceId);
    const changed = unresolveComment(state.document, commentId);
    if (changed) this.recomputeState(state);
    return changed;
  }

  remove(resourceId: string, commentId: string): boolean {
    const state = this.requireState(resourceId);
    const changed = removeComment(state.document, commentId);
    if (changed) this.recomputeState(state);
    return changed;
  }

  async save(resourceId: string): Promise<void> {
    const state = this.requireState(resourceId);
    if (!state.sidecarPath) {
      throw new Error("No sidecar path is available for this resource.");
    }

    await this.host.writeSidecar(state.sidecarPath, state.document);
    state.dirty = false;
    state.hasPendingShifts = false;
    this.emit(state);
  }

  async reanchor(resourceId: string, options: ReviewReanchorOptions = {}): Promise<ReviewState> {
    const state = this.requireState(resourceId);
    const results = reanchorDocumentLines(state.document, ["", ...state.documentLines], {
      threshold: options.threshold,
    });

    applyReanchorResults(state.document, results, {
      updateText: options.updateText,
      force: options.force,
    });

    state.lastReanchorResults = results;
    state.dirty = true;
    state.hasPendingShifts = false;
    this.recomputeState(state, geometryFromLines(state.documentLines));

    if (options.autoSave) {
      await this.save(resourceId);
    }

    return state;
  }

  private requireState(resourceId: string): ReviewState {
    const state = this.states.get(resourceId);
    if (!state) {
      throw new Error(`No review state loaded for '${resourceId}'.`);
    }
    return state;
  }

  private recomputeState(state: ReviewState, geometry?: DocumentGeometry): void {
    state.snapshot = projectDecorationSnapshot(state.document, {
      showResolved: this.options.showResolved,
      geometry: geometry ?? geometryFromLines(state.documentLines),
    });
    state.dirty = true;
    this.emit(state);
  }

  private emit(state: ReviewState): void {
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
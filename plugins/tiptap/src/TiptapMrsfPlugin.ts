import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Comment } from "@mrsf/cli/browser";
import type { TiptapMrsfHostAdapter } from "./host/HostAdapter.js";
import { ReviewStore } from "./core/ReviewStore.js";
import { diffTextChange, geometryFromText, getDocumentText, getSelectedText, selectionToEditorSelection } from "./core/textModel.js";
import { selectionToAnchor } from "./core/positions.js";
import type {
  CommentDraft,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
  TiptapMrsfDisplayOptions,
  TiptapMrsfLiveTrackingMode,
  TiptapMrsfPluginControllerOptions,
  TiptapMrsfPluginSaveOptions,
  TiptapMrsfStateChangeSource,
} from "./types.js";

const LIVE_TRACKING_DEBOUNCE_MS = 120;

export class TiptapMrsfPlugin {
  private readonly store: ReviewStore;
  private unsubscribeStore: (() => void) | null = null;
  private readonly options: TiptapMrsfPluginControllerOptions;
  private pendingStateSource: TiptapMrsfStateChangeSource = "load";
  private pendingTextUpdate: { previousText: string; nextText: string } | null = null;
  private pendingTextUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly editor: Editor,
    host: TiptapMrsfHostAdapter,
    options: TiptapMrsfPluginControllerOptions,
  ) {
    this.options = {
      interactive: options.interactive ?? Boolean(options.onCommentClick),
      inlineHighlights: options.inlineHighlights ?? true,
      gutterPosition: options.gutterPosition ?? "left",
      gutterForInline: options.gutterForInline ?? true,
      lineHighlight: options.lineHighlight ?? false,
      theme: options.theme ?? "auto",
      ...options,
    };
    this.store = new ReviewStore(host, { showResolved: options.showResolved });

    this.unsubscribeStore = this.store.subscribe((state) => {
      this.options.onStateChange?.({
        resourceId: state.resourceId,
        state,
        dirty: state.dirty,
        hasPendingShifts: state.hasPendingShifts,
        source: this.pendingStateSource,
      });
      this.pendingStateSource = "external";
    });
  }

  async loadCurrent(source: TiptapMrsfStateChangeSource = "load"): Promise<ReviewState> {
    this.clearPendingTextUpdate();
    this.pendingStateSource = source;
    return this.store.load(this.options.resourceId, {
      geometry: this.getGeometry(),
      documentText: this.getText(),
    });
  }

  async reloadFromHost(): Promise<ReviewState> {
    return this.loadCurrent("external");
  }

  refresh(): ReviewState {
    this.clearPendingTextUpdate();
    this.pendingStateSource = "refresh";
    return this.store.refresh(this.options.resourceId, this.getText(), this.getGeometry());
  }

  handleViewUpdate(previousState: EditorState, nextState: EditorState): ReviewState | null {
    if (previousState.doc.eq(nextState.doc)) {
      return null;
    }

    const before = getDocumentText(previousState.doc);
    const after = getDocumentText(nextState.doc);
    this.queueTextUpdate(before, after);
    return null;
  }

  queueTextUpdate(previousText: string, nextText: string): void {
    if (previousText === nextText) {
      return;
    }

    this.pendingTextUpdate = this.pendingTextUpdate
      ? { previousText: this.pendingTextUpdate.previousText, nextText }
      : { previousText, nextText };

    const mode = this.getLiveTrackingMode();
    if (mode === "save-only") {
      return;
    }

    if (mode === "eager") {
      this.flushPendingTextUpdate();
      return;
    }

    this.schedulePendingTextUpdate();
  }

  flushPendingTextUpdate(): ReviewState | null {
    if (!this.pendingTextUpdate) {
      return null;
    }

    const pending = this.pendingTextUpdate;
    this.clearPendingTextUpdate();
    const changes = diffTextChange(pending.previousText, pending.nextText);
    this.pendingStateSource = "content";
    return this.store.applyLiveEdits(this.options.resourceId, changes, pending.nextText, geometryFromText(pending.nextText));
  }

  getState(): ReviewState | null {
    return this.store.getState(this.options.resourceId);
  }

  getThreadsAtLine(line: number): ReviewThread[] {
    return this.store.getThreadsAtLine(this.options.resourceId, line);
  }

  getThreadForComment(commentId: string): ReviewThread | null {
    const comment = this.getCommentById(commentId);
    if (!comment) {
      return null;
    }

    const rootId = comment.reply_to ?? comment.id;
    const rootComment = this.getCommentById(rootId);
    if (!rootComment?.line) {
      return null;
    }

    return this.getThreadsAtLine(rootComment.line).find((thread) => thread.rootComment.id === rootId) ?? null;
  }

  getCommentById(commentId: string): Comment | null {
    const state = this.getState();
    if (!state) {
      return null;
    }

    return state.projectedDocument.comments.find((comment) => comment.id === commentId) ?? null;
  }

  getDisplayOptions(): Required<TiptapMrsfDisplayOptions> {
    return {
      interactive: this.options.interactive ?? Boolean(this.options.onCommentClick),
      inlineHighlights: this.options.inlineHighlights ?? true,
      gutterPosition: this.options.gutterPosition ?? "left",
      gutterForInline: this.options.gutterForInline ?? true,
      lineHighlight: this.options.lineHighlight ?? false,
      theme: this.options.theme ?? "auto",
    };
  }

  getCurrentSelection() {
    return selectionToEditorSelection(this.editor.state.selection, this.editor.state.doc);
  }

  async addCommentFromSelection(draft: Omit<CommentDraft, "line" | "text"> & { text: string }): Promise<Comment> {
    const selection = this.getCurrentSelection();
    const selectedText = getSelectedText(this.editor.state);
    const anchor = selectionToAnchor(selection);
    return this.store.addComment(this.options.resourceId, {
      ...draft,
      ...anchor,
      text: draft.text,
      author: draft.author ?? this.options.defaultAuthor,
      selected_text: (draft.selected_text ?? selectedText) || undefined,
    });
  }

  async addComment(draft: CommentDraft): Promise<Comment> {
    return this.store.addComment(this.options.resourceId, {
      ...draft,
      author: draft.author ?? this.options.defaultAuthor,
    });
  }

  async reply(parentId: string, draft: Omit<CommentDraft, "line">): Promise<Comment> {
    return this.store.reply(this.options.resourceId, parentId, {
      ...draft,
      author: draft.author ?? this.options.defaultAuthor,
    });
  }

  async replyToComment(parentId: string, text: string, draft: Omit<Partial<CommentDraft>, "line" | "text"> = {}): Promise<Comment> {
    return this.reply(parentId, {
      ...draft,
      text,
    });
  }

  edit(commentId: string, draft: Partial<CommentDraft> & { text: string }): Comment {
    return this.store.edit(this.options.resourceId, commentId, draft);
  }

  editComment(commentId: string, text: string, draft: Partial<Omit<CommentDraft, "text">> = {}): Comment {
    return this.edit(commentId, {
      ...draft,
      text,
    });
  }

  resolve(commentId: string): boolean {
    return this.store.resolve(this.options.resourceId, commentId);
  }

  unresolve(commentId: string): boolean {
    return this.store.unresolve(this.options.resourceId, commentId);
  }

  toggleResolved(commentId: string): boolean {
    const comment = this.getCommentById(commentId);
    if (!comment) {
      return false;
    }

    return comment.resolved ? this.unresolve(commentId) : this.resolve(commentId);
  }

  remove(commentId: string): boolean {
    return this.store.remove(this.options.resourceId, commentId);
  }

  deleteComment(commentId: string): boolean {
    return this.remove(commentId);
  }

  async save(options: TiptapMrsfPluginSaveOptions = {}): Promise<void> {
    this.flushPendingTextUpdate();
    const state = this.store.getState(this.options.resourceId);
    if (!state) {
      return;
    }

    const defaultSave = async (): Promise<void> => {
      this.pendingStateSource = "save";
      await this.store.save(this.options.resourceId);
    };

    if (this.options.onSaveRequest) {
      await this.options.onSaveRequest({
        resourceId: this.options.resourceId,
        state,
        reason: options.reason ?? "manual",
        defaultSave,
      });
      return;
    }

    await defaultSave();
  }

  async reanchor(options: ReviewReanchorOptions = {}): Promise<ReviewState> {
    this.clearPendingTextUpdate();
    this.pendingStateSource = "reanchor";
    return this.store.reanchor(this.options.resourceId, options);
  }

  handleCommentClick(commentId: string, anchorRect?: DOMRect | null): boolean {
    const state = this.getState();
    const comment = this.getCommentById(commentId);
    if (!state || !comment || !this.options.onCommentClick) {
      return false;
    }

    this.options.onCommentClick({
      resourceId: this.options.resourceId,
      commentId,
      comment,
      state,
      anchorRect,
    });
    return true;
  }

  dispose(): void {
    this.clearPendingTextUpdate();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

  private getLiveTrackingMode(): TiptapMrsfLiveTrackingMode {
    return this.options.liveTracking ?? "debounced";
  }

  private schedulePendingTextUpdate(): void {
    if (this.pendingTextUpdateTimer != null) {
      clearTimeout(this.pendingTextUpdateTimer);
    }

    this.pendingTextUpdateTimer = setTimeout(() => {
      this.pendingTextUpdateTimer = null;
      this.flushPendingTextUpdate();
    }, LIVE_TRACKING_DEBOUNCE_MS);
  }

  private clearPendingTextUpdate(): void {
    if (this.pendingTextUpdateTimer != null) {
      clearTimeout(this.pendingTextUpdateTimer);
      this.pendingTextUpdateTimer = null;
    }

    this.pendingTextUpdate = null;
  }

  private getText(): string {
    return getDocumentText(this.editor.state.doc);
  }

  private getGeometry() {
    return geometryFromText(this.getText());
  }
}
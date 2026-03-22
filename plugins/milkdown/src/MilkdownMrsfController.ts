import type { Comment } from "@mrsf/cli/browser";
import type { MilkdownMrsfHostAdapter } from "./host/HostAdapter.js";
import { ReviewStore } from "./core/ReviewStore.js";
import { diffTextChange, geometryFromText } from "./core/textModel.js";
import { selectionToAnchor } from "./core/positions.js";
import type {
  CommentDraft,
  EditorContentChange,
  EditorSelection,
  MilkdownMrsfControllerOptions,
  MilkdownMrsfPluginSaveOptions,
  MilkdownMrsfStateChangeSource,
  ReviewLoadOptions,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
} from "./types.js";

export class MilkdownMrsfController {
  private readonly store: ReviewStore;
  private unsubscribeStore: (() => void) | null = null;
  private pendingStateSource: MilkdownMrsfStateChangeSource = "load";

  constructor(
    host: MilkdownMrsfHostAdapter,
    private readonly options: MilkdownMrsfControllerOptions,
  ) {
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

  async load(options: ReviewLoadOptions = {}, source: MilkdownMrsfStateChangeSource = "load"): Promise<ReviewState> {
    this.pendingStateSource = source;
    return this.store.load(this.options.resourceId, options);
  }

  async reloadFromHost(documentText?: string): Promise<ReviewState> {
    return this.load(documentText ? { documentText, geometry: geometryFromText(documentText) } : {}, "external");
  }

  refresh(documentText: string): ReviewState {
    this.pendingStateSource = "refresh";
    return this.store.refresh(this.options.resourceId, documentText, geometryFromText(documentText));
  }

  applyChanges(changes: readonly EditorContentChange[], documentText: string): ReviewState {
    this.pendingStateSource = "content";
    return this.store.applyLiveEdits(this.options.resourceId, changes, documentText, geometryFromText(documentText));
  }

  applyTextUpdate(previousText: string, nextText: string): ReviewState {
    return this.applyChanges(diffTextChange(previousText, nextText), nextText);
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

  async addComment(draft: CommentDraft): Promise<Comment> {
    return this.store.addComment(this.options.resourceId, {
      ...draft,
      author: draft.author ?? this.options.defaultAuthor,
    });
  }

  async addCommentFromSelection(
    selection: EditorSelection,
    text: string,
    selectedText?: string,
    draft: Omit<Partial<CommentDraft>, "line" | "text"> = {},
  ): Promise<Comment> {
    const anchor = selectionToAnchor(selection);
    return this.addComment({
      ...draft,
      ...anchor,
      text,
      selected_text: selectedText || draft.selected_text,
    });
  }

  async reply(parentId: string, draft: Omit<CommentDraft, "line">): Promise<Comment> {
    return this.store.reply(this.options.resourceId, parentId, {
      ...draft,
      author: draft.author ?? this.options.defaultAuthor,
    });
  }

  edit(commentId: string, draft: Partial<CommentDraft> & { text: string }): Comment {
    return this.store.edit(this.options.resourceId, commentId, draft);
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

  async save(options: MilkdownMrsfPluginSaveOptions = {}): Promise<void> {
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
    this.pendingStateSource = "reanchor";
    return this.store.reanchor(this.options.resourceId, options);
  }

  dispose(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }
}
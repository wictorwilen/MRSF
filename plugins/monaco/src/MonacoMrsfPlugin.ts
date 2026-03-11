import type * as monaco from "monaco-editor";
import type { Comment } from "@mrsf/cli/browser";
import type { MonacoMrsfHostAdapter } from "./host/HostAdapter.js";
import { MonacoViewAdapter, type MonacoViewAdapterOptions } from "./MonacoViewAdapter.js";
import { registerMonacoActions } from "./MonacoActions.js";
import { createMonacoHoverProvider } from "./MonacoHover.js";
import { MonacoThreadOverlay } from "./MonacoThreadOverlay.js";
import { ReviewStore } from "./core/ReviewStore.js";
import { openMrsfConfirmDialog, openMrsfFormDialog } from "./ui/dialogs.js";
import type {
  CommentDraft,
  MonacoActionContext,
  MonacoActionHandlers,
  MonacoThreadOverlayDisplayOptions,
  MonacoMrsfPluginSaveOptions,
  MonacoMrsfPluginSaveRequest,
  MonacoMrsfStateChangeEvent,
  MonacoMrsfStateChangeSource,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
} from "./types.js";

export interface MonacoMrsfPluginControllerOptions extends MonacoViewAdapterOptions {
  autoLoad?: boolean;
  monacoApi?: typeof monaco;
  actionHandlers?: MonacoActionHandlers;
  registerActions?: boolean;
  autoSaveAfterReanchor?: boolean;
  watchHostChanges?: boolean;
  reloadOnExternalChanges?: boolean;
  threadOverlay?: MonacoThreadOverlayDisplayOptions;
  onStateChange?: (event: MonacoMrsfStateChangeEvent) => void;
  onSaveRequest?: (request: MonacoMrsfPluginSaveRequest) => void | Promise<void>;
}

export class MonacoMrsfPlugin {
  private readonly view: MonacoViewAdapter;
  private readonly store: ReviewStore;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private unsubscribeStore: (() => void) | null = null;
  private contentListener: { dispose(): void } | null = null;
  private hoverDisposable: { dispose(): void } | null = null;
  private actionDisposables: monaco.IDisposable[] = [];
  private overlay: MonacoThreadOverlay | null = null;
  private documentWatchDisposer: (() => void | Promise<void>) | null = null;
  private sidecarWatchDisposer: (() => void | Promise<void>) | null = null;
  private readonly options: MonacoMrsfPluginControllerOptions;
  private pendingStateSource: MonacoMrsfStateChangeSource = "load";

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    host: MonacoMrsfHostAdapter,
    options: MonacoMrsfPluginControllerOptions = {},
  ) {
    this.options = options;
    this.view = new MonacoViewAdapter(editor, {
      ...options,
      gutterIcons: editor.getContainerDomNode?.().ownerDocument ? false : options.gutterIcons,
    });
    this.store = new ReviewStore(host, { showResolved: options.showResolved });

    this.unsubscribeStore = this.store.subscribe((state) => {
      const current = this.view.getResourceId();
      if (current && current === state.resourceId) {
        this.view.applySnapshot(state.snapshot);
        this.overlay?.update(state);
      }
      this.options.onStateChange?.({
        resourceId: state.resourceId,
        state,
        dirty: state.dirty,
        hasPendingShifts: state.hasPendingShifts,
        source: this.pendingStateSource,
      });
      this.pendingStateSource = "external";
    });

    this.disposables.push(
      this.view.onDidChangeModel(() => {
        void this.loadCurrent("load");
        this.bindContentListener();
      }),
    );

    this.bindContentListener();
    this.bindActions(editor);
    this.bindOverlay(editor);
    this.bindHoverProvider();

    if (options.autoLoad !== false) {
      void this.loadCurrent("load");
    }
  }

  async loadCurrent(source: MonacoMrsfStateChangeSource = "load"): Promise<ReviewState | null> {
    const resourceId = this.view.getResourceId();
    if (!resourceId) return null;

    this.pendingStateSource = source;

    const state = await this.store.load(resourceId, {
      geometry: this.view.getGeometry() ?? undefined,
      documentText: this.view.getText(),
    });

    await this.bindHostWatchers(state);
    return state;
  }

  async reloadFromHost(): Promise<ReviewState | null> {
    return this.loadCurrent("external");
  }

  refresh(): ReviewState | null {
    const resourceId = this.view.getResourceId();
    if (!resourceId) return null;
    this.pendingStateSource = "refresh";
    return this.store.refresh(
      resourceId,
      this.view.getText(),
      this.view.getGeometry() ?? undefined,
    );
  }

  getState(): ReviewState | null {
    const resourceId = this.view.getResourceId();
    return resourceId ? this.store.getState(resourceId) : null;
  }

  getThreadsAtLine(line: number): ReviewThread[] {
    const resourceId = this.requireResourceId();
    return this.store.getThreadsAtLine(resourceId, line);
  }

  getActionContext(): MonacoActionContext | null {
    const resourceId = this.view.getResourceId();
    const state = resourceId ? this.store.getState(resourceId) : null;
    if (!resourceId || !state) return null;

    const selection = this.view.getSelection();
    const line = selection ? selection.start.lineIndex + 1 : 1;
    const thread = this.getThreadsAtLine(line)[0];

    return {
      resourceId,
      state,
      line,
      selection,
      thread,
    };
  }

  async addComment(draft: CommentDraft): Promise<Comment> {
    const resourceId = this.requireResourceId();
    return this.store.addComment(resourceId, draft);
  }

  async reply(parentId: string, draft: Omit<CommentDraft, "line">): Promise<Comment> {
    const resourceId = this.requireResourceId();
    return this.store.reply(resourceId, parentId, draft);
  }

  edit(commentId: string, draft: Partial<CommentDraft> & { text: string }): Comment {
    const resourceId = this.requireResourceId();
    return this.store.edit(resourceId, commentId, draft);
  }

  resolve(commentId: string): boolean {
    return this.store.resolve(this.requireResourceId(), commentId);
  }

  unresolve(commentId: string): boolean {
    return this.store.unresolve(this.requireResourceId(), commentId);
  }

  remove(commentId: string): boolean {
    return this.store.remove(this.requireResourceId(), commentId);
  }

  async save(options: MonacoMrsfPluginSaveOptions = {}): Promise<void> {
    const resourceId = this.requireResourceId();
    const state = this.store.getState(resourceId);
    if (!state) {
      return;
    }

    const defaultSave = async (): Promise<void> => {
      this.pendingStateSource = "save";
      await this.store.save(resourceId);
    };

    if (this.options.onSaveRequest) {
      await this.options.onSaveRequest({
        resourceId,
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
    return this.store.reanchor(this.requireResourceId(), options);
  }

  async saveAndReanchor(options: ReviewReanchorOptions = {}): Promise<ReviewState> {
    const state = await this.reanchor({ ...options, autoSave: false });
    await this.save({ reason: "reanchor" });
    return state;
  }

  revealLine(line: number): void {
    this.view.revealLine(line);
  }

  dispose(): void {
    this.contentListener?.dispose();
    this.hoverDisposable?.dispose();
    this.overlay?.dispose();
    for (const disposable of this.actionDisposables) {
      disposable.dispose();
    }
    void this.documentWatchDisposer?.();
    void this.sidecarWatchDisposer?.();
    this.unsubscribeStore?.();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.view.dispose();
  }

  private bindContentListener(): void {
    this.contentListener?.dispose();
    this.contentListener = this.view.onDidChangeContent((changes) => {
      const resourceId = this.view.getResourceId();
      if (!resourceId || !this.store.getState(resourceId)) return;
      this.pendingStateSource = "content";
      this.store.applyLiveEdits(
        resourceId,
        changes,
        this.view.getText(),
        this.view.getGeometry() ?? undefined,
      );
    });
  }

  private bindHoverProvider(): void {
    this.hoverDisposable?.dispose();
    if (this.overlay) {
      return;
    }

    const monacoApi = this.options.monacoApi;
    if (!monacoApi || this.options.hover === false) return;

    const languageId = this.view.getLanguageId();
    if (!languageId) return;

    this.hoverDisposable = monacoApi.languages.registerHoverProvider(
      languageId,
      createMonacoHoverProvider(
        () => this.getState(),
        (line) => this.getThreadsAtLine(line),
      ),
    );
  }

  private bindActions(editor: monaco.editor.IStandaloneCodeEditor): void {
    for (const disposable of this.actionDisposables) {
      disposable.dispose();
    }
    this.actionDisposables = [];

    if (this.options.registerActions === false) return;

    this.actionDisposables = registerMonacoActions(editor, this, {
      handlers: this.options.actionHandlers,
      autoSaveAfterReanchor: this.options.autoSaveAfterReanchor,
    });
  }

  private bindOverlay(editor: monaco.editor.IStandaloneCodeEditor): void {
    const targetDocument = this.options.targetDocument ?? editor.getContainerDomNode?.().ownerDocument;
    if (!targetDocument) {
      return;
    }

    this.overlay?.dispose();
    this.overlay = new MonacoThreadOverlay(editor, {
      targetDocument,
      interactive: true,
      display: this.options.threadOverlay,
      getState: () => this.getState(),
      getThreadsAtLine: (line) => this.getThreadsAtLine(line),
      onAddLine: async (line) => {
        const result = await openMrsfFormDialog({
          action: "add",
          targetDocument,
          themeSource: editor.getContainerDomNode?.() ?? null,
        });
        if (!result?.text) return;

        await this.addComment({
          line,
          text: result.text,
          severity: result.severity ?? undefined,
          type: result.type ?? undefined,
        });
      },
      onAction: async ({ action, commentId, line }) => {
        if (action === "edit") {
          const state = this.getState();
          const sourceComment = state?.document.comments.find((entry) => entry.id === commentId);
          if (!sourceComment) return;

          const result = await openMrsfFormDialog({
            action: "edit",
            targetDocument,
            themeSource: editor.getContainerDomNode?.() ?? null,
            initialText: sourceComment.text,
            initialType: sourceComment.type ?? null,
            initialSeverity: sourceComment.severity ?? null,
            selectionText: sourceComment.selected_text ?? null,
          });
          if (!result?.text) return;

          this.edit(commentId, {
            text: result.text,
            type: result.type ?? undefined,
            severity: result.severity ?? undefined,
            selected_text: sourceComment.selected_text,
          });
          return;
        }

        if (action === "reply") {
          const thread = this.getThreadsAtLine(line).find((entry) => entry.rootComment.id === commentId)
            ?? this.getThreadsAtLine(line)[0];
          if (!thread) return;

          const result = await openMrsfFormDialog({
            action: "reply",
            targetDocument,
            themeSource: editor.getContainerDomNode?.() ?? null,
          });
          if (!result?.text) return;

          await this.reply(thread.rootComment.id, {
            text: result.text,
            severity: result.severity ?? undefined,
            type: result.type ?? undefined,
          });
          return;
        }

        if (action === "delete") {
          const confirmed = await openMrsfConfirmDialog({
            title: "Delete comment",
            message: "Delete this comment?",
            confirmLabel: "Delete",
            targetDocument,
            themeSource: editor.getContainerDomNode?.() ?? null,
          });
          if (confirmed) {
            this.remove(commentId);
          }
          return;
        }

        if (action === "resolve" || action === "unresolve") {
          const confirmed = await openMrsfConfirmDialog({
            title: "Change status",
            message: action === "resolve"
              ? "Mark this comment as resolved?"
              : "Mark this comment as unresolved?",
            confirmLabel: "Confirm",
            targetDocument,
            themeSource: editor.getContainerDomNode?.() ?? null,
          });
          if (!confirmed) return;

          if (action === "resolve") {
            this.resolve(commentId);
          } else {
            this.unresolve(commentId);
          }
        }
      },
    });
  }

  private async bindHostWatchers(state: ReviewState): Promise<void> {
    if (this.options.watchHostChanges === false) {
      return;
    }

    await this.documentWatchDisposer?.();
    await this.sidecarWatchDisposer?.();
    this.documentWatchDisposer = null;
    this.sidecarWatchDisposer = null;
    if (this.options.reloadOnExternalChanges === false) {
      return;
    }

    const host = this.store.getHostAdapter();
    const resourceId = state.resourceId;

    this.documentWatchDisposer = await host.watchDocument?.(
      resourceId,
      async () => {
        if (this.view.getResourceId() === resourceId) {
          await this.reloadFromHost();
        }
      },
    ) ?? null;

    if (state.sidecarPath) {
      this.sidecarWatchDisposer = await host.watchSidecar?.(
        state.sidecarPath,
        async () => {
          if (this.view.getResourceId() === resourceId) {
            await this.reloadFromHost();
          }
        },
      ) ?? null;
    }
  }

  private requireResourceId(): string {
    const resourceId = this.view.getResourceId();
    if (!resourceId) {
      throw new Error("The Monaco editor has no active model.");
    }
    return resourceId;
  }
}
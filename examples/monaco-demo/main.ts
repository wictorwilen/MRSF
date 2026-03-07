import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import {
  applyLineShifts,
  type EditorContentChange,
  MemoryHostAdapter,
  MonacoThreadOverlay,
  MonacoViewAdapter,
  openMrsfConfirmDialog,
  openMrsfFormDialog,
  projectDecorationSnapshot,
  selectionToAnchor,
} from "@mrsf/monaco-mrsf/browser";
import type { ReanchorResult, ReviewState, ReviewThread } from "@mrsf/monaco-mrsf/browser";
import {
  clearPendingDocumentChanges,
  createDemoStatusState,
  markDirty,
  markSaved,
  recordPendingDocumentChanges,
  renderDemoStatus,
} from "./demoStatus.js";
import { reanchorSavedSnapshot } from "./savedSnapshot.js";

const resourceId = "file:///examples/monaco-demo/demo.md";
const documentText = `# MRSF Monaco Demo

This document shows inline and line-level comments.

- Edit this list item to see live line tracking.
- Hover a highlighted selection or gutter marker.
- Trigger an external sidecar update from the host controls.

## Notes

Keep this section around so reanchor has nearby context.
`;

const initialSidecar = {
  mrsf_version: "1.0",
  document: "/examples/monaco-demo/demo.md",
  comments: [
    {
      id: "intro-inline",
      author: "Demo Reviewer",
      timestamp: "2026-03-07T12:00:00.000Z",
      text: "This opening sentence is a good target for inline review.",
      resolved: false,
      line: 3,
      start_column: 5,
      end_column: 35,
      selected_text: "document shows inline and line-level comments",
      severity: "medium",
      type: "note",
    },
    {
      id: "list-thread-root",
      author: "Demo Reviewer",
      timestamp: "2026-03-07T12:05:00.000Z",
      text: "Try editing this line, then use reanchor to re-sync the saved sidecar.",
      resolved: false,
      line: 5,
      severity: "high",
      type: "issue",
    },
    {
      id: "list-thread-reply",
      author: "Another Reviewer",
      timestamp: "2026-03-07T12:10:00.000Z",
      text: "A reply demonstrates hover threading and resolve toggling.",
      resolved: true,
      reply_to: "list-thread-root",
    },
  ],
};

(self as typeof globalThis & {
  MonacoEnvironment?: { getWorker(): Worker };
}).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

const host = new MemoryHostAdapter({
  resources: {
    [resourceId]: {
      documentText,
      documentPath: "/examples/monaco-demo/demo.md",
      sidecarPath: "/examples/monaco-demo/demo.md.review.yaml",
      sidecar: initialSidecar,
    },
  },
});

const model = monaco.editor.createModel(
  documentText,
  "markdown",
  monaco.Uri.parse(resourceId),
);

const editorContainer = document.getElementById("editor");
const statusPill = document.getElementById("status-pill");
const saveIndicator = document.getElementById("save-indicator");
const anchorIndicator = document.getElementById("anchor-indicator");
const lastSaved = document.getElementById("last-saved");
const editorSummary = document.getElementById("editor-summary");
const statusPanel = document.getElementById("status-panel");
const stateOutput = document.getElementById("state-output");
const hostOutput = document.getElementById("host-output");

if (
  !editorContainer
  || !statusPill
  || !saveIndicator
  || !anchorIndicator
  || !lastSaved
  || !editorSummary
  || !statusPanel
  || !stateOutput
  || !hostOutput
) {
  throw new Error("Monaco demo shell is missing required DOM nodes.");
}

const editor = monaco.editor.create(editorContainer, {
  model,
  glyphMargin: true,
  theme: "vs",
  minimap: { enabled: false },
  fontSize: 14,
  lineHeight: 24,
  padding: { top: 16, bottom: 16 },
  smoothScrolling: true,
  scrollBeyondLastLine: false,
});

const view = new MonacoViewAdapter(editor, {
  injectStyles: true,
  gutterIcons: false,
});

let currentState: ReviewState | null = null;
const demoState = createDemoStatusState(initialSidecar.comments.length);
const pendingDocumentChanges: EditorContentChange[] = [];
let lastReanchorResults: ReanchorResult[] = [];

const overlay = new MonacoThreadOverlay(editor, {
  interactive: true,
  getState: () => currentState,
  getThreadsAtLine,
  onAddLine: async (line) => {
    const result = await openMrsfFormDialog({
      action: "add",
      targetDocument: document,
      themeSource: editorContainer,
    });
    if (!result?.text) {
      setStatus("Add comment cancelled");
      return;
    }

    const snapshot = host.snapshot(resourceId);
    const sidecar = snapshot.sidecar ?? {
      mrsf_version: "1.0",
      document: snapshot.documentPath ?? resourceId,
      comments: [],
    };

    sidecar.comments.push({
      id: `demo-line-${Date.now()}`,
      author: "Browser Demo",
      timestamp: new Date().toISOString(),
      text: result.text,
      resolved: false,
      line,
      severity: result.severity ?? undefined,
      type: result.type ?? "note",
    });

    await host.updateSidecar(resourceId, sidecar);
    clearReanchorResults();
    markDirty(demoState, `Added a line comment on line ${line}. Write host snapshot to persist the sidecar.`);
    setStatus(`Line comment added on ${line}`);
  },
  onAction: async ({ action, commentId, line }) => {
    if (action === "edit") {
      const snapshot = host.snapshot(resourceId);
      const sidecar = snapshot.sidecar;
      const sourceComment = sidecar?.comments.find((comment) => comment.id === commentId);
      if (!sidecar || !sourceComment) return;

      const result = await openMrsfFormDialog({
        action: "edit",
        targetDocument: document,
        themeSource: editorContainer,
        initialText: sourceComment.text,
        initialType: sourceComment.type ?? null,
        initialSeverity: sourceComment.severity ?? null,
        selectionText: sourceComment.selected_text ?? null,
      });
      if (!result?.text) return;

      sourceComment.text = result.text;
      sourceComment.type = result.type ?? undefined;
      sourceComment.severity = result.severity ?? undefined;
      await host.updateSidecar(resourceId, sidecar);
      clearReanchorResults();
      markDirty(demoState, "Updated a comment locally. Write host snapshot to persist the edited sidecar.");
      setStatus("Comment updated");
      return;
    }

    if (action === "reply") {
      const thread = getThreadsAtLine(line).find((entry) => entry.rootComment.id === commentId) ?? getThreadsAtLine(line)[0];
      if (!thread) return;

      const result = await openMrsfFormDialog({
        action: "reply",
        targetDocument: document,
        themeSource: editorContainer,
      });
      if (!result?.text) return;

      const snapshot = host.snapshot(resourceId);
      const sidecar = snapshot.sidecar;
      if (!sidecar) return;

      sidecar.comments.push({
        id: `reply-${Date.now()}`,
        author: "Browser Demo",
        timestamp: new Date().toISOString(),
        text: result.text,
        resolved: false,
        reply_to: thread.rootComment.id,
        severity: result.severity ?? undefined,
        type: result.type ?? undefined,
      });

      await host.updateSidecar(resourceId, sidecar);
  clearReanchorResults();
      markDirty(demoState, "Added a reply locally. Write host snapshot to persist the thread update.");
      setStatus("Reply added");
      return;
    }

    if (action === "delete") {
      const confirmed = await openMrsfConfirmDialog({
        title: "Delete comment",
        message: "Delete this comment?",
        confirmLabel: "Delete",
        targetDocument: document,
        themeSource: editorContainer,
      });
      if (!confirmed) return;

      const snapshot = host.snapshot(resourceId);
      const sidecar = snapshot.sidecar;
      if (!sidecar) return;

      sidecar.comments = sidecar.comments.filter((comment) => comment.id !== commentId && comment.reply_to !== commentId);
      await host.updateSidecar(resourceId, sidecar);
      clearReanchorResults();
      markDirty(demoState, "Deleted a comment locally. Write host snapshot to persist the sidecar.");
      setStatus("Comment deleted");
      return;
    }

    if (action === "resolve" || action === "unresolve") {
      const confirmed = await openMrsfConfirmDialog({
        title: "Change status",
        message: action === "resolve" ? "Mark this comment as resolved?" : "Mark this comment as unresolved?",
        confirmLabel: "Confirm",
        targetDocument: document,
        themeSource: editorContainer,
      });
      if (!confirmed) return;

      const snapshot = host.snapshot(resourceId);
      const sidecar = snapshot.sidecar;
      if (!sidecar) return;

      const comment = sidecar.comments.find((entry) => entry.id === commentId);
      if (!comment) return;
      comment.resolved = action === "resolve";
      await host.updateSidecar(resourceId, sidecar);
      clearReanchorResults();
      markDirty(demoState, "Changed comment resolution locally. Write host snapshot to persist the new status.");
      setStatus(action === "resolve" ? "Comment resolved" : "Comment reopened");
    }
  },
});

function setStatus(message: string): void {
  statusPill.textContent = message;
}

function clearReanchorResults(): void {
  lastReanchorResults = [];
}

function getThreadsAtLine(line: number): ReviewThread[] {
  if (!currentState) return [];

  const lineSnapshot = currentState.snapshot.threadsByLine.find((entry) => entry.line === line);
  if (!lineSnapshot) return [];

  const commentsById = new Map(currentState.document.comments.map((comment) => [comment.id, comment]));

  return lineSnapshot.threads.flatMap((thread) => {
    const rootComment = commentsById.get(thread.rootCommentId);
    if (!rootComment) return [];

    return [{
      line,
      rootComment,
      replies: thread.commentIds
        .slice(1)
        .map((id) => commentsById.get(id))
        .filter((comment): comment is NonNullable<typeof comment> => !!comment),
    }];
  });
}

function rebuildState(): ReviewState {
  const snapshot = host.snapshot(resourceId);
  const document = snapshot.sidecar ?? {
    mrsf_version: "1.0",
    document: snapshot.documentPath ?? resourceId,
    comments: [],
  };
  const documentLines = snapshot.documentText.replace(/\r\n/g, "\n").split("\n");
  const geometry = {
    lineCount: model.getLineCount(),
    getLineLength: (lineIndex: number) => model.getLineLength(lineIndex + 1),
  };
  const projected = projectDecorationSnapshot(document, {
    geometry,
    showResolved: true,
  });

  currentState = {
    resourceId,
    document,
    sidecarPath: snapshot.sidecarPath ?? null,
    documentPath: snapshot.documentPath ?? null,
    documentLines,
    snapshot: projected,
    loaded: true,
    dirty: demoState.dirtySidecar,
    hasPendingShifts: demoState.pendingAnchorShifts,
    lastReanchorResults,
  };

  return currentState;
}

function applyState(): void {
  const state = rebuildState();
  view.applySnapshot(state.snapshot);
  overlay.update(state);

  renderPanels();
  renderDemoStatus({
    saveIndicator,
    anchorIndicator,
    lastSaved,
    editorSummary,
    statusPanel,
  }, demoState, state);
}

function renderPanels(): void {
  const state = currentState;
  stateOutput.textContent = JSON.stringify(
    state
      ? {
          dirty: state.dirty,
          hasPendingShifts: state.hasPendingShifts,
          demoStatus: demoState,
          lastReanchorResults: state.lastReanchorResults,
          snapshot: state.snapshot,
          comments: state.document.comments,
        }
      : null,
    null,
    2,
  );
  hostOutput.textContent = JSON.stringify(host.snapshot(resourceId), null, 2);
}

editor.onDidChangeModelContent(async (event) => {
  const snapshot = host.snapshot(resourceId);
  const contentChanges: EditorContentChange[] = event.changes.map((change) => ({
    range: {
      start: {
        lineIndex: change.range.startLineNumber - 1,
        column: change.range.startColumn - 1,
      },
      end: {
        lineIndex: change.range.endLineNumber - 1,
        column: change.range.endColumn - 1,
      },
    },
    text: change.text,
  }));

  if (snapshot.sidecar) {
    const movedAnchors = event.changes.some(
      (change) => /\n/.test(change.text) || change.range.startLineNumber !== change.range.endLineNumber,
    );

    applyLineShifts(
      snapshot.sidecar.comments,
      contentChanges,
    );
    await host.updateSidecar(resourceId, snapshot.sidecar);
    clearReanchorResults();
    recordPendingDocumentChanges(demoState, contentChanges.length);
    pendingDocumentChanges.push(...contentChanges);
    markDirty(
      demoState,
      movedAnchors
        ? "Document edits moved comment anchors locally. Write host snapshot to keep the shifted sidecar."
        : "Document edits updated the in-memory sidecar. Write host snapshot to persist those anchor positions.",
      true,
    );
  }

  await host.updateDocument(resourceId, model.getValue());
  applyState();
});

host.watchDocument(resourceId, async () => {
  applyState();
});

host.watchSidecar("/examples/monaco-demo/demo.md.review.yaml", async () => {
  applyState();
});

applyState();

editor.addAction({
  id: "mrsf.addComment",
  label: "MRSF: Add Comment",
  contextMenuGroupId: "navigation",
  precondition: "editorHasSelection",
  run: async () => {
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      setStatus("Select text to add a comment");
      return;
    }

    const result = await openMrsfFormDialog({
      action: "add",
      selectionText: model.getValueInRange(selection),
      targetDocument: document,
      themeSource: editorContainer,
    });
    if (!result?.text) {
      setStatus("Add comment cancelled");
      return;
    }

    const snapshot = host.snapshot(resourceId);
    const sidecar = snapshot.sidecar ?? {
      mrsf_version: "1.0",
      document: snapshot.documentPath ?? resourceId,
      comments: [],
    };
    const anchor = selectionToAnchor({
      start: { lineIndex: selection.startLineNumber - 1, column: selection.startColumn - 1 },
      end: { lineIndex: selection.endLineNumber - 1, column: selection.endColumn - 1 },
    });

    sidecar.comments.push({
      id: `demo-${Date.now()}`,
      author: "Browser Demo",
      timestamp: new Date().toISOString(),
      text: result.text,
      resolved: false,
      line: anchor.line,
      end_line: anchor.end_line,
      start_column: anchor.start_column,
      end_column: anchor.end_column,
      selected_text: model.getValueInRange(selection),
      severity: result.severity ?? undefined,
      type: result.type ?? "note",
    });

    await host.updateSidecar(resourceId, sidecar);
    clearReanchorResults();
    markDirty(demoState, "Added a comment locally. Write host snapshot to persist the sidecar.");
    setStatus("Comment added");
  },
});

const buttons = {
  addComment: document.getElementById("add-comment"),
  toggleResolve: document.getElementById("toggle-resolve"),
  reanchorSaved: document.getElementById("reanchor-saved"),
  syncHost: document.getElementById("sync-host"),
  refreshView: document.getElementById("refresh-view"),
  externalSidecar: document.getElementById("external-sidecar"),
};

buttons.addComment?.addEventListener("click", async () => {
  setStatus("Adding comment...");
  const selection = editor.getSelection();
  const result = await openMrsfFormDialog({
    action: "add",
    selectionText: selection && !selection.isEmpty() ? model.getValueInRange(selection) : null,
    targetDocument: document,
    themeSource: editorContainer,
  });
  if (!result?.text) {
    setStatus("Add comment cancelled");
    return;
  }

  const snapshot = host.snapshot(resourceId);
  const sidecar = snapshot.sidecar ?? {
    mrsf_version: "1.0",
    document: snapshot.documentPath ?? resourceId,
    comments: [],
  };
  const anchor = selection
    ? selectionToAnchor({
        start: { lineIndex: selection.startLineNumber - 1, column: selection.startColumn - 1 },
        end: { lineIndex: selection.endLineNumber - 1, column: selection.endColumn - 1 },
      })
    : { line: editor.getPosition()?.lineNumber ?? 1 };
  const selectedText = selection && !selection.isEmpty()
    ? model.getValueInRange(selection)
    : undefined;

  sidecar.comments.push({
    id: `demo-${Date.now()}`,
    author: "Browser Demo",
    timestamp: new Date().toISOString(),
    text: result.text,
    resolved: false,
    line: anchor.line,
    end_line: anchor.end_line,
    start_column: anchor.start_column,
    end_column: anchor.end_column,
    selected_text: selectedText,
    severity: result.severity ?? "medium",
    type: result.type ?? "note",
  });

  await host.updateSidecar(resourceId, sidecar);
  clearReanchorResults();
  markDirty(demoState, "Added a comment locally. Write host snapshot to persist the sidecar.");
  setStatus("Comment added");
});

buttons.toggleResolve?.addEventListener("click", async () => {
  setStatus("Toggling resolve...");
  const line = editor.getPosition()?.lineNumber ?? 1;
  const thread = getThreadsAtLine(line)[0];
  if (!thread) {
    setStatus("No thread on current line");
    return;
  }

  const confirmed = await openMrsfConfirmDialog({
    title: "Change status",
    message: thread.rootComment.resolved
      ? "Mark this comment as unresolved?"
      : "Mark this comment as resolved?",
    confirmLabel: "Confirm",
    targetDocument: document,
    themeSource: editorContainer,
  });
  if (!confirmed) {
    setStatus("Resolve toggle cancelled");
    return;
  }

  const snapshot = host.snapshot(resourceId);
  const sidecar = snapshot.sidecar;
  if (!sidecar) return;
  const root = sidecar.comments.find((comment) => comment.id === thread.rootComment.id);
  if (!root) return;
  root.resolved = !root.resolved;
  await host.updateSidecar(resourceId, sidecar);
  clearReanchorResults();
  markDirty(demoState, "Changed resolution locally. Write host snapshot to persist the sidecar.");
  setStatus("Resolve toggled");
});

buttons.reanchorSaved?.addEventListener("click", async () => {
  setStatus("Reanchoring saved snapshot...");

  const savedSidecar = host.savedSidecarSnapshot(resourceId);
  if (!savedSidecar) {
    setStatus("No saved sidecar snapshot available");
    return;
  }

  if (pendingDocumentChanges.length === 0) {
    setStatus("No unsaved document edits to compare");
    clearReanchorResults();
    demoState.summary = "The saved sidecar already matches the current document edits.";
    applyState();
    return;
  }

  const { sidecar: reanchoredSidecar, results, changed } = reanchorSavedSnapshot(savedSidecar, model.getValue());
  lastReanchorResults = results;
  await host.updateSidecar(resourceId, reanchoredSidecar);
  markDirty(
    demoState,
    `Restored the last saved sidecar and reanchored it against the current document. ${changed} comment${changed === 1 ? "" : "s"} changed across ${results.length} reanchor result${results.length === 1 ? "" : "s"}. Write host snapshot to persist this reanchored copy.`,
    true,
  );
  setStatus("Saved snapshot reanchored");
});

buttons.syncHost?.addEventListener("click", async () => {
  setStatus("Writing host snapshot...");
  const snapshot = host.snapshot(resourceId);
  if (!snapshot.sidecarPath || !snapshot.sidecar) {
    setStatus("No sidecar available");
    return;
  }
  await host.writeSidecar(snapshot.sidecarPath, snapshot.sidecar);
  clearPendingDocumentChanges(demoState);
  pendingDocumentChanges.length = 0;
  markSaved(
    demoState,
    "Host snapshot written. The current sidecar state is now persisted.",
    snapshot.sidecar.comments.length,
  );
  applyState();
  setStatus("Host snapshot written");
});

buttons.refreshView?.addEventListener("click", async () => {
  setStatus("Refreshing view...");
  applyState();
  setStatus("View refreshed");
});

buttons.externalSidecar?.addEventListener("click", async () => {
  setStatus("Applying external host change...");
  const snapshot = host.snapshot(resourceId);
  const nextComments = [...(snapshot.sidecar?.comments ?? [])];
  nextComments.push({
    id: `external-${Date.now()}`,
    author: "External Host",
    timestamp: new Date().toISOString(),
    text: "This comment was injected outside the editor to demonstrate host watchers.",
    resolved: false,
    line: 9,
    severity: "low",
    type: "note",
  });

  await host.updateSidecar(resourceId, {
    mrsf_version: "1.0",
    document: "/examples/monaco-demo/demo.md",
    comments: nextComments,
  });
  clearReanchorResults();
  markDirty(demoState, "Received an external sidecar update. Write host snapshot if you want to treat this as the new saved state.");
  setStatus("External change applied");
});

renderDemoStatus({
  saveIndicator,
  anchorIndicator,
  lastSaved,
  editorSummary,
  statusPanel,
}, demoState, currentState);
setStatus("Ready");
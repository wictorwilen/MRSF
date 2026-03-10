import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import {
  type EditorContentChange,
  MemoryHostAdapter,
  MemoryHostSession,
  MonacoMrsfPlugin,
  openMrsfConfirmDialog,
  openMrsfFormDialog,
  selectionToAnchor,
} from "@mrsf/monaco-mrsf/browser";
import type { ReanchorResult, ReviewState } from "@mrsf/monaco-mrsf/browser";
import {
  clearPendingDocumentChanges,
  createDemoStatusState,
  markDirty,
  markSaved,
  recordPendingDocumentChanges,
  renderDemoStatus,
} from "./demoStatus.js";
import { reanchorSavedSnapshot } from "./savedSnapshot.js";

async function main(): Promise<void> {

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
      id: "list-thread-second-root",
      author: "Design Review",
      timestamp: "2026-03-07T12:06:00.000Z",
      text: "A second thread on the same line shows the thread switcher in the overlay.",
      resolved: false,
      line: 5,
      severity: "low",
      type: "question",
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

const session = new MemoryHostSession(host, resourceId);

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

let currentState: ReviewState | null = null;
const demoState = createDemoStatusState(initialSidecar.comments.length);
const pendingDocumentChanges: EditorContentChange[] = [];
let lastReanchorResults: ReanchorResult[] = [];

const plugin = new MonacoMrsfPlugin(editor, host, {
  monacoApi: monaco,
  watchHostChanges: false,
  onStateChange: ({ state }) => {
    currentState = state;
    void session.replaceSidecar(structuredClone(state.document)).then(() => {
      renderPanels();
    });
    renderPanels();
    renderDemoStatus({
      saveIndicator,
      anchorIndicator,
      lastSaved,
      editorSummary,
      statusPanel,
    }, demoState, currentState);
  },
  onSaveRequest: async ({ defaultSave, state, reason }) => {
    await defaultSave();
    clearPendingDocumentChanges(demoState);
    pendingDocumentChanges.length = 0;
    markSaved(
      demoState,
      "Host snapshot written. The current sidecar state is now persisted.",
      state.document.comments.length,
    );
    renderPanels();
    renderDemoStatus({
      saveIndicator,
      anchorIndicator,
      lastSaved,
      editorSummary,
      statusPanel,
    }, demoState, currentState);
    setStatus(reason === "reanchor" ? "Reanchored sidecar saved" : "Host snapshot written");
  },
});

function setStatus(message: string): void {
  statusPill.textContent = message;
}

function clearReanchorResults(): void {
  lastReanchorResults = [];
}

function renderPanels(): void {
  const state = currentState;
  const reanchorResults = state?.lastReanchorResults?.length ? state.lastReanchorResults : lastReanchorResults;
  stateOutput.textContent = JSON.stringify(
    state
      ? {
          dirty: state.dirty,
          hasPendingShifts: state.hasPendingShifts,
          demoStatus: demoState,
          lastReanchorResults: reanchorResults,
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
  const movedAnchors = event.changes.some(
    (change) => /\n/.test(change.text) || change.range.startLineNumber !== change.range.endLineNumber,
  );

  clearReanchorResults();
  recordPendingDocumentChanges(demoState, contentChanges.length);
  pendingDocumentChanges.push(...contentChanges);
  markDirty(
    demoState,
    movedAnchors
      ? "Document edits moved comment anchors in memory. Use Write Host Snapshot to persist the updated sidecar."
      : "Document edits changed the in-memory review state. Use Write Host Snapshot to persist the current sidecar.",
    movedAnchors || demoState.pendingAnchorShifts,
  );

  await session.updateDocumentText(model.getValue());
  renderPanels();
  renderDemoStatus({
    saveIndicator,
    anchorIndicator,
    lastSaved,
    editorSummary,
    statusPanel,
  }, demoState, currentState);
});

await plugin.loadCurrent();
currentState = plugin.getState();
renderPanels();
renderDemoStatus({
  saveIndicator,
  anchorIndicator,
  lastSaved,
  editorSummary,
  statusPanel,
}, demoState, currentState);

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

    const anchor = selectionToAnchor({
      start: { lineIndex: selection.startLineNumber - 1, column: selection.startColumn - 1 },
      end: { lineIndex: selection.endLineNumber - 1, column: selection.endColumn - 1 },
    });

    await plugin.addComment({
      author: "Browser Demo",
      text: result.text,
      line: anchor.line,
      end_line: anchor.end_line,
      start_column: anchor.start_column,
      end_column: anchor.end_column,
      selected_text: model.getValueInRange(selection),
      severity: result.severity ?? undefined,
      type: result.type ?? "note",
    });
    clearReanchorResults();
    markDirty(demoState, "Added a comment locally. Use Write Host Snapshot to persist the sidecar.");
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

  const anchor = selection
    ? selectionToAnchor({
        start: { lineIndex: selection.startLineNumber - 1, column: selection.startColumn - 1 },
        end: { lineIndex: selection.endLineNumber - 1, column: selection.endColumn - 1 },
      })
    : { line: editor.getPosition()?.lineNumber ?? 1 };
  const selectedText = selection && !selection.isEmpty()
    ? model.getValueInRange(selection)
    : undefined;

  await plugin.addComment({
    author: "Browser Demo",
    text: result.text,
    line: anchor.line,
    end_line: anchor.end_line,
    start_column: anchor.start_column,
    end_column: anchor.end_column,
    selected_text: selectedText,
    severity: result.severity ?? "medium",
    type: result.type ?? "note",
  });
  clearReanchorResults();
  markDirty(demoState, "Added a comment locally. Use Write Host Snapshot to persist the sidecar.");
  setStatus("Comment added");
});

buttons.toggleResolve?.addEventListener("click", async () => {
  setStatus("Toggling resolve...");
  const line = editor.getPosition()?.lineNumber ?? 1;
  const thread = plugin.getThreadsAtLine(line)[0];
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

  if (thread.rootComment.resolved) {
    plugin.unresolve(thread.rootComment.id);
  } else {
    plugin.resolve(thread.rootComment.id);
  }
  clearReanchorResults();
  markDirty(demoState, "Changed resolution locally. Use Write Host Snapshot to persist the sidecar.");
  setStatus("Resolve toggled");
});

buttons.reanchorSaved?.addEventListener("click", async () => {
  setStatus("Reanchoring saved snapshot...");

  const savedSidecar = session.savedSidecarSnapshot();
  if (!savedSidecar) {
    setStatus("No saved sidecar snapshot available");
    return;
  }

  if (pendingDocumentChanges.length === 0) {
    setStatus("No unsaved document edits to compare");
    clearReanchorResults();
    demoState.summary = "The saved sidecar already matches the current document edits.";
    renderPanels();
    renderDemoStatus({
      saveIndicator,
      anchorIndicator,
      lastSaved,
      editorSummary,
      statusPanel,
    }, demoState, currentState);
    return;
  }

  const { sidecar: reanchoredSidecar, results, changed } = reanchorSavedSnapshot(savedSidecar, model.getValue());
  lastReanchorResults = results;
  await session.replaceSidecar(reanchoredSidecar);
  await plugin.reloadFromHost();
  markDirty(
    demoState,
    `Restored the last saved sidecar and reanchored it against the current document. ${changed} comment${changed === 1 ? "" : "s"} changed across ${results.length} reanchor result${results.length === 1 ? "" : "s"}. Use Write Host Snapshot to persist this reanchored copy.`,
    true,
  );
  setStatus("Saved snapshot reanchored");
});

buttons.syncHost?.addEventListener("click", async () => {
  setStatus("Writing host snapshot...");
  await plugin.save({ reason: "toolbar" });
});

buttons.refreshView?.addEventListener("click", async () => {
  setStatus("Refreshing view...");
  currentState = plugin.refresh();
  renderPanels();
  renderDemoStatus({
    saveIndicator,
    anchorIndicator,
    lastSaved,
    editorSummary,
    statusPanel,
  }, demoState, currentState);
  setStatus("View refreshed");
});

buttons.externalSidecar?.addEventListener("click", async () => {
  setStatus("Applying external host change...");
  await session.mutateSidecar((sidecar) => {
    sidecar.comments.push({
      id: `external-${Date.now()}`,
      author: "External Host",
      timestamp: new Date().toISOString(),
      text: "This comment was injected outside the editor to demonstrate host helpers and manual reloads.",
      resolved: false,
      line: 9,
      severity: "low",
      type: "note",
    });
  });
  await plugin.reloadFromHost();
  clearReanchorResults();
  markDirty(demoState, "Received an external sidecar update. Use Write Host Snapshot if you want to treat this as the new saved state.");
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
}

void main().catch((error) => {
  console.error(error);
});
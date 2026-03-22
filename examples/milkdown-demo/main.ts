import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";
import type { Comment, MrsfDocument } from "@mrsf/cli/browser";
import {
  createCrepeMrsfFeature,
  createMilkdownMrsfPlugin,
  getCrepeMrsfController,
  getCrepeMrsfSelectedText,
  getCrepeMrsfSelection,
  getMilkdownMrsfController,
  getMilkdownMrsfSelectedText,
  getMilkdownMrsfSelection,
  type EditorSelection,
  type MilkdownMrsfController,
  type MilkdownMrsfHostAdapter,
  type ReviewState,
} from "@mrsf/milkdown-mrsf";
import "@mrsf/milkdown-mrsf/style.css";

type DemoMode = "milkdown" | "crepe";

interface DemoHostState {
  markdownSource: string;
  documentPath: string;
  sidecarPath: string;
  sidecar: MrsfDocument;
  lastSavedAt: string | null;
  lastSavedCommentCount: number;
  writeCount: number;
}

interface ThreadEntry {
  root: Comment;
  replies: Comment[];
}

const INITIAL_MARKDOWN = `# Milkdown MRSF Demo

This demo runs the same review runtime in direct Milkdown and Crepe.

Switch modes to compare the editing shell while the sidecar model stays the same.

## Workflow

- Select text and add a comment.
- Save to persist the current sidecar state.
- Reload or simulate an external sidecar change.

## Release Notes

Anchors should follow live edits in this editor.

Crepe and direct Milkdown share the same review controller.
`;

const INITIAL_VISIBLE_TEXT = [
  "Milkdown MRSF Demo",
  "This demo runs the same review runtime in direct Milkdown and Crepe.",
  "Switch modes to compare the editing shell while the sidecar model stays the same.",
  "Workflow",
  "Select text and add a comment.",
  "Save to persist the current sidecar state.",
  "Reload or simulate an external sidecar change.",
  "Release Notes",
  "Anchors should follow live edits in this editor.",
  "Crepe and direct Milkdown share the same review controller.",
].join("\n");

const hostState: DemoHostState = {
  markdownSource: INITIAL_MARKDOWN,
  documentPath: "/examples/milkdown-demo/demo.md",
  sidecarPath: "/examples/milkdown-demo/demo.md.review.yaml",
  sidecar: createInitialSidecar(INITIAL_VISIBLE_TEXT, "/examples/milkdown-demo/demo.md"),
  lastSavedAt: null,
  lastSavedCommentCount: 0,
  writeCount: 0,
};

const hostAdapter: MilkdownMrsfHostAdapter = {
  async getDocumentText() {
    return getCurrentDocumentText();
  },
  async getDocumentPath() {
    return hostState.documentPath;
  },
  async discoverSidecar() {
    return hostState.sidecarPath;
  },
  async readSidecar() {
    return cloneDocument(hostState.sidecar);
  },
  async writeSidecar(_path, document) {
    hostState.sidecar = cloneDocument(document);
    hostState.lastSavedAt = new Date().toISOString();
    hostState.lastSavedCommentCount = document.comments.length;
    hostState.writeCount += 1;
    renderAll();
  },
};

const editorHost = requireElement<HTMLDivElement>("editor-host");
const modePill = requireElement<HTMLSpanElement>("mode-pill");
const saveIndicator = requireElement<HTMLSpanElement>("save-indicator");
const anchorIndicator = requireElement<HTMLSpanElement>("anchor-indicator");
const lastSaved = requireElement<HTMLSpanElement>("last-saved");
const statusPill = requireElement<HTMLSpanElement>("status-pill");
const threadCount = requireElement<HTMLSpanElement>("thread-count");
const threadList = requireElement<HTMLDivElement>("thread-list");
const statusPanel = requireElement<HTMLDivElement>("status-panel");
const stateOutput = requireElement<HTMLPreElement>("state-output");
const hostOutput = requireElement<HTMLPreElement>("host-output");
const selectionOutput = requireElement<HTMLDivElement>("selection-output");
const flashMessage = requireElement<HTMLDivElement>("flash-message");

const addCommentButton = requireElement<HTMLButtonElement>("add-comment");
const replyCommentButton = requireElement<HTMLButtonElement>("reply-comment");
const editCommentButton = requireElement<HTMLButtonElement>("edit-comment");
const toggleResolvedButton = requireElement<HTMLButtonElement>("toggle-resolved");
const deleteCommentButton = requireElement<HTMLButtonElement>("delete-comment");
const saveSidecarButton = requireElement<HTMLButtonElement>("save-sidecar");
const reloadSidecarButton = requireElement<HTMLButtonElement>("reload-sidecar");
const reanchorSidecarButton = requireElement<HTMLButtonElement>("reanchor-sidecar");
const externalSidecarButton = requireElement<HTMLButtonElement>("external-sidecar");
const resetDemoButton = requireElement<HTMLButtonElement>("reset-demo");
const modeMilkdownButton = requireElement<HTMLButtonElement>("mode-milkdown");
const modeCrepeButton = requireElement<HTMLButtonElement>("mode-crepe");

let activeMode: DemoMode = "milkdown";
let activeMilkdownEditor: Editor | null = null;
let activeCrepeEditor: Crepe | null = null;
let currentState: ReviewState | null = null;
let selectedCommentId: string | null = null;
let flashTimer: number | null = null;
let editorMounted = false;

function selectComment(commentId: string): void {
  selectedCommentId = commentId;
  renderAll();
}

editorHost.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const commentElement = target.closest<HTMLElement>("[data-mrsf-comment-id]");
  const commentId = commentElement?.dataset.mrsfCommentId;
  if (!commentId) {
    return;
  }

  selectComment(commentId);
});

threadList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const card = target.closest<HTMLElement>("[data-comment-id]");
  const commentId = card?.dataset.commentId;
  if (!commentId) {
    return;
  }

  selectComment(commentId);
});

addCommentButton.addEventListener("click", () => void handleAddComment());
replyCommentButton.addEventListener("click", () => void handleReply());
editCommentButton.addEventListener("click", () => handleEdit());
toggleResolvedButton.addEventListener("click", () => handleToggleResolved());
deleteCommentButton.addEventListener("click", () => handleDelete());
saveSidecarButton.addEventListener("click", () => void handleSave());
reloadSidecarButton.addEventListener("click", () => void handleReload());
reanchorSidecarButton.addEventListener("click", () => void handleReanchor());
externalSidecarButton.addEventListener("click", () => void handleExternalChange());
resetDemoButton.addEventListener("click", () => void resetDemo(activeMode));
modeMilkdownButton.addEventListener("click", () => void switchMode("milkdown"));
modeCrepeButton.addEventListener("click", () => void switchMode("crepe"));
document.addEventListener("selectionchange", () => renderSelection());

void mountEditor(activeMode);

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element '${id}'.`);
  }
  return element as T;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function cloneDocument(document: MrsfDocument): MrsfDocument {
  return {
    ...document,
    comments: document.comments.map((comment) => ({ ...comment })),
  };
}

function getLineNumber(documentText: string, lineText: string): number {
  const index = splitLines(documentText).findIndex((line) => line === lineText);
  if (index === -1) {
    throw new Error(`Unable to find line '${lineText}' in demo document.`);
  }
  return index + 1;
}

function getInlineAnchor(documentText: string, lineText: string, selectedText: string) {
  const lineNumber = getLineNumber(documentText, lineText);
  const line = splitLines(documentText)[lineNumber - 1] ?? "";
  const start = line.indexOf(selectedText);
  if (start === -1) {
    throw new Error(`Unable to find selection '${selectedText}' in line '${lineText}'.`);
  }

  return {
    line: lineNumber,
    start_column: start,
    end_column: start + selectedText.length,
    selected_text: selectedText,
  };
}

function createInitialSidecar(documentText: string, documentPath: string): MrsfDocument {
  const inlineAnchor = getInlineAnchor(
    documentText,
    "This demo runs the same review runtime in direct Milkdown and Crepe.",
    "same review runtime",
  );
  const saveAnchor = getInlineAnchor(
    documentText,
    "Save to persist the current sidecar state.",
    "current sidecar state",
  );

  return {
    mrsf_version: "1.0",
    document: documentPath,
    comments: [
      {
        id: "milkdown-inline-root",
        author: "Demo Reviewer",
        timestamp: "2026-03-22T10:00:00.000Z",
        text: "This phrase is the key promise of the package. Keep it visible when comparing the two shells.",
        resolved: false,
        severity: "medium",
        type: "note",
        ...inlineAnchor,
      },
      {
        id: "milkdown-inline-reply",
        author: "Second Reviewer",
        timestamp: "2026-03-22T10:02:00.000Z",
        text: "The demo should prove this stays true after edits and saves.",
        resolved: false,
        reply_to: "milkdown-inline-root",
      },
      {
        id: "milkdown-save-root",
        author: "Release Lead",
        timestamp: "2026-03-22T10:04:00.000Z",
        text: "This line is a good place to verify that saved anchors drift and can be reanchored.",
        resolved: false,
        severity: "high",
        type: "issue",
        ...saveAnchor,
      },
      {
        id: "milkdown-line-root",
        author: "Demo Reviewer",
        timestamp: "2026-03-22T10:06:00.000Z",
        text: "Keep one line-level comment around so the thread list shows non-inline coverage too.",
        resolved: false,
        severity: "low",
        type: "question",
        line: getLineNumber(documentText, "Anchors should follow live edits in this editor."),
      },
    ],
  };
}

function createCommentId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function getActiveController(): MilkdownMrsfController | null {
  if (activeMode === "crepe") {
    return activeCrepeEditor ? getCrepeMrsfController(activeCrepeEditor) : null;
  }

  return activeMilkdownEditor ? getMilkdownMrsfController(activeMilkdownEditor) : null;
}

function getActiveSelection(): EditorSelection | null {
  if (activeMode === "crepe") {
    return activeCrepeEditor ? getCrepeMrsfSelection(activeCrepeEditor) : null;
  }

  return activeMilkdownEditor ? getMilkdownMrsfSelection(activeMilkdownEditor) : null;
}

function getActiveSelectedText(): string {
  if (activeMode === "crepe") {
    return activeCrepeEditor ? getCrepeMrsfSelectedText(activeCrepeEditor) : "";
  }

  return activeMilkdownEditor ? getMilkdownMrsfSelectedText(activeMilkdownEditor) : "";
}

function getCurrentDocumentText(): string {
  const state = getActiveController()?.getState();
  return state ? state.documentLines.join("\n") : INITIAL_VISIBLE_TEXT;
}

function onStateChange(state: ReviewState): void {
  currentState = state;
  if (selectedCommentId && !state.projectedDocument.comments.some((comment) => comment.id === selectedCommentId)) {
    selectedCommentId = null;
  }
  renderAll();
}

async function destroyActiveEditor(): Promise<void> {
  editorMounted = false;

  if (activeMilkdownEditor) {
    await activeMilkdownEditor.destroy();
    activeMilkdownEditor = null;
  }

  if (activeCrepeEditor) {
    await activeCrepeEditor.destroy();
    activeCrepeEditor = null;
  }
}

async function mountEditor(mode: DemoMode): Promise<void> {
  statusPill.textContent = "Mounting";
  await destroyActiveEditor();
  editorHost.innerHTML = "";
  editorHost.dataset.editorMode = mode;
  activeMode = mode;
  currentState = null;

  if (mode === "milkdown") {
    activeMilkdownEditor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, editorHost);
        ctx.set(defaultValueCtx, hostState.markdownSource);
      })
      .use(commonmark)
      .use(createMilkdownMrsfPlugin(hostAdapter, {
        resourceId: "demo:milkdown",
        defaultAuthor: "Demo User",
        interactive: true,
        onStateChange: (event) => onStateChange(event.state),
        onCommentSelect: (commentId) => selectComment(commentId),
        composeReply: ({ comment }) => {
          const text = window.prompt("Reply text");
          if (!text?.trim()) {
            return null;
          }
          return {
            text: text.trim(),
            severity: comment.severity ?? "low",
            type: comment.type ?? "note",
          };
        },
        composeEdit: ({ comment }) => {
          const text = window.prompt("Edit comment text", comment.text);
          if (!text?.trim()) {
            return null;
          }
          return {
            text: text.trim(),
            severity: comment.severity ?? undefined,
            type: comment.type ?? undefined,
          };
        },
        confirmDelete: ({ comment }) => window.confirm(`Delete comment by ${comment.author || "Unknown"}?`),
      }));

    await activeMilkdownEditor.create();
  } else {
    activeCrepeEditor = new Crepe({
      root: editorHost,
      defaultValue: hostState.markdownSource,
    });
    activeCrepeEditor.addFeature(createCrepeMrsfFeature(hostAdapter, {
      resourceId: "demo:crepe",
      defaultAuthor: "Demo User",
      inlineHighlights: false,
      interactive: true,
      onStateChange: (event) => onStateChange(event.state),
      onCommentSelect: (commentId) => selectComment(commentId),
      composeReply: ({ comment }) => {
        const text = window.prompt("Reply text");
        if (!text?.trim()) {
          return null;
        }
        return {
          text: text.trim(),
          severity: comment.severity ?? "low",
          type: comment.type ?? "note",
        };
      },
      composeEdit: ({ comment }) => {
        const text = window.prompt("Edit comment text", comment.text);
        if (!text?.trim()) {
          return null;
        }
        return {
          text: text.trim(),
          severity: comment.severity ?? undefined,
          type: comment.type ?? undefined,
        };
      },
      confirmDelete: ({ comment }) => window.confirm(`Delete comment by ${comment.author || "Unknown"}?`),
    }));
    await activeCrepeEditor.create();
  }

  editorMounted = true;
  renderAll();
  flash(mode === "milkdown" ? "Mounted direct Milkdown editor." : "Mounted Crepe editor.");
}

async function switchMode(mode: DemoMode): Promise<void> {
  if (mode === activeMode) {
    return;
  }

  await mountEditor(mode);
}

function flash(message: string): void {
  flashMessage.textContent = message;
  if (flashTimer !== null) {
    window.clearTimeout(flashTimer);
  }
  flashTimer = window.setTimeout(() => {
    flashMessage.textContent = "";
    flashTimer = null;
  }, 2800);
}

function hasUsableSelection(selection: EditorSelection | null, selectedText: string): boolean {
  if (!selection || !selectedText.trim()) {
    return false;
  }

  return selection.start.lineIndex !== selection.end.lineIndex || selection.start.column !== selection.end.column;
}

async function handleAddComment(): Promise<void> {
  const controller = getActiveController();
  if (!controller) {
    return;
  }

  const selection = getActiveSelection();
  const selectedText = getActiveSelectedText();
  if (!hasUsableSelection(selection, selectedText)) {
    flash("Select text in the editor before adding a comment.");
    return;
  }

  const text = window.prompt("Comment text");
  if (!text?.trim()) {
    return;
  }

  const comment = await controller.addCommentFromSelection(selection!, text.trim(), selectedText.trim(), {
    severity: "medium",
    type: "note",
  });
  selectedCommentId = comment.id;
  flash("Added a new comment from the current selection.");
}

async function handleReply(): Promise<void> {
  await replyToComment(selectedCommentId);
}

async function replyToComment(commentId: string | null): Promise<void> {
  const controller = getActiveController();
  if (!controller || !commentId) {
    flash("Select a thread before replying.");
    return;
  }

  const text = window.prompt("Reply text");
  if (!text?.trim()) {
    return;
  }

  const reply = await controller.reply(commentId, {
    text: text.trim(),
    severity: "low",
    type: "note",
  });
  selectComment(reply.id);
  flash("Added a reply to the selected thread.");
}

function handleEdit(): void {
  editComment(selectedCommentId);
}

function editComment(commentId: string | null): void {
  const controller = getActiveController();
  if (!controller || !commentId) {
    flash("Select a comment before editing.");
    return;
  }

  const comment = controller.getCommentById(commentId);
  if (!comment) {
    flash("The selected comment is no longer available.");
    return;
  }

  const text = window.prompt("Edit comment text", comment.text);
  if (!text?.trim()) {
    return;
  }

  controller.edit(commentId, {
    text: text.trim(),
    severity: comment.severity,
    type: comment.type,
    selected_text: comment.selected_text,
  });
  selectComment(commentId);
  flash("Updated the selected comment.");
}

function handleToggleResolved(): void {
  toggleCommentResolved(selectedCommentId);
}

function toggleCommentResolved(commentId: string | null): void {
  const controller = getActiveController();
  if (!controller || !commentId) {
    flash("Select a comment before changing resolution state.");
    return;
  }

  controller.toggleResolved(commentId);
  selectComment(commentId);
  flash("Toggled the selected comment state.");
}

function handleDelete(): void {
  deleteComment(selectedCommentId);
}

function deleteComment(commentId: string | null): void {
  const controller = getActiveController();
  if (!controller || !commentId) {
    flash("Select a comment before deleting it.");
    return;
  }

  controller.remove(commentId);
  selectedCommentId = null;
  renderAll();
  flash("Deleted the selected comment.");
}

async function handleSave(): Promise<void> {
  const controller = getActiveController();
  if (!controller) {
    return;
  }

  await controller.save({ reason: "manual" });
  flash("Wrote the current sidecar back to the host snapshot.");
}

async function handleReload(): Promise<void> {
  const controller = getActiveController();
  if (!controller) {
    return;
  }

  await controller.reloadFromHost(getCurrentDocumentText());
  flash("Reloaded the sidecar from the host snapshot.");
}

async function handleReanchor(): Promise<void> {
  const controller = getActiveController();
  if (!controller) {
    return;
  }

  await controller.reanchor({ updateText: true });
  flash("Reanchored the current sidecar against the editor text.");
}

async function handleExternalChange(): Promise<void> {
  const currentText = getCurrentDocumentText();
  const sidecar = cloneDocument(hostState.sidecar);
  const lineText = splitLines(currentText)[2] ?? splitLines(currentText)[0] ?? "";

  try {
    const anchor = lineText.includes("editing shell")
      ? getInlineAnchor(currentText, lineText, "editing shell")
      : { line: 1 };

    sidecar.comments.push({
      id: createCommentId("external"),
      author: "External Reviewer",
      timestamp: new Date().toISOString(),
      text: "This comment simulates an external sidecar update landing from outside the editor.",
      resolved: false,
      severity: "medium",
      type: "note",
      ...anchor,
    });
  } catch {
    sidecar.comments.push({
      id: createCommentId("external"),
      author: "External Reviewer",
      timestamp: new Date().toISOString(),
      text: "This fallback comment simulates an external sidecar update.",
      resolved: false,
      severity: "low",
      type: "note",
      line: 1,
    });
  }

  hostState.sidecar = sidecar;
  await handleReload();
  flash("Applied an external sidecar change and reloaded it into the editor.");
}

async function resetDemo(mode: DemoMode): Promise<void> {
  hostState.markdownSource = INITIAL_MARKDOWN;
  hostState.sidecar = createInitialSidecar(INITIAL_VISIBLE_TEXT, hostState.documentPath);
  hostState.lastSavedAt = null;
  hostState.lastSavedCommentCount = 0;
  hostState.writeCount = 0;
  selectedCommentId = null;
  await mountEditor(mode);
  flash("Reset the demo document and sidecar snapshot.");
}

function renderSelection(): void {
  if (!editorMounted) {
    selectionOutput.textContent = "Editor is starting.";
    addCommentButton.disabled = true;
    return;
  }

  const selectedText = getActiveSelectedText().trim();
  const selection = getActiveSelection();
  const usable = hasUsableSelection(selection, selectedText);

  selectionOutput.textContent = usable
    ? `"${selectedText}"`
    : "No active text selection.";

  addCommentButton.disabled = !usable;
}

function buildThreads(state: ReviewState | null): ThreadEntry[] {
  if (!state) {
    return [];
  }

  const repliesByParent = new Map<string, Comment[]>();
  const roots: Comment[] = [];

  for (const comment of state.projectedDocument.comments) {
    if (comment.reply_to) {
      const bucket = repliesByParent.get(comment.reply_to) ?? [];
      bucket.push(comment);
      repliesByParent.set(comment.reply_to, bucket);
      continue;
    }

    roots.push(comment);
  }

  return roots.map((root) => ({
    root,
    replies: repliesByParent.get(root.id) ?? [],
  }));
}

function renderThreads(): void {
  const threads = buildThreads(currentState);
  threadCount.textContent = String(threads.length);

  if (threads.length === 0) {
    threadList.innerHTML = '<div class="thread-empty">No comment threads are loaded.</div>';
    return;
  }

  threadList.innerHTML = threads.map(({ root, replies }) => {
    const selected = selectedCommentId === root.id || replies.some((reply) => reply.id === selectedCommentId);
    const stateLabel = root.resolved ? "Resolved" : "Open";
    const anchorLabel = root.selected_text ? `"${escapeHtml(root.selected_text)}"` : "Line-level comment";
    return [
      `<article class="thread-card${selected ? " is-selected" : ""}${root.resolved ? " is-resolved" : ""}" data-comment-id="${escapeHtml(root.id)}">`,
      `<div class="thread-topline"><span class="thread-line">Line ${root.line ?? "doc"}</span><span class="thread-state">${stateLabel}</span></div>`,
      `<p class="thread-text">${escapeHtml(root.text)}</p>`,
      `<div class="thread-anchor">Anchor: ${anchorLabel}</div>`,
      replies.length > 0 ? `<div class="thread-replies">${replies.length} repl${replies.length === 1 ? "y" : "ies"}</div>` : "",
      `</article>`,
    ].join("");
  }).join("");
}

function renderStatus(): void {
  const state = currentState;
  const commentCount = state?.document.comments.length ?? 0;
  const projectedCount = state?.projectedDocument.comments.length ?? 0;
  const threadCountValue = buildThreads(state).length;
  const orphaned = state?.snapshot.orphanedCommentIds.length ?? 0;
  const selectedThread = selectedCommentId ? (getActiveController()?.getThreadForComment(selectedCommentId)?.rootComment.id ?? selectedCommentId) : null;

  statusPill.textContent = state ? (state.loaded ? "Ready" : "Loading") : "Starting";
  modePill.textContent = activeMode === "milkdown" ? "Milkdown" : "Crepe";
  saveIndicator.textContent = state?.dirty ? "Unsaved changes" : "Saved";
  saveIndicator.className = `meta-pill ${state?.dirty ? "meta-pill-dirty" : "meta-pill-clean"}`;
  anchorIndicator.textContent = state?.hasPendingShifts ? "Pending anchor shifts" : "Anchors in sync";
  anchorIndicator.className = `meta-pill ${state?.hasPendingShifts ? "meta-pill-warning" : "meta-pill-clean"}`;
  lastSaved.textContent = hostState.lastSavedAt ? `Host write ${new Date(hostState.lastSavedAt).toLocaleTimeString()}` : "No host write yet";

  replyCommentButton.disabled = !selectedCommentId;
  editCommentButton.disabled = !selectedCommentId;
  toggleResolvedButton.disabled = !selectedCommentId;
  deleteCommentButton.disabled = !selectedCommentId;

  statusPanel.innerHTML = [
    statusRow("Mode", activeMode === "milkdown" ? "Direct Milkdown" : "Crepe"),
    statusRow("Loaded comments", `${commentCount}`),
    statusRow("Projected comments", `${projectedCount}`),
    statusRow("Threads", `${threadCountValue}`),
    statusRow("Orphaned", `${orphaned}`),
    statusRow("Selected", selectedThread ?? "None"),
    statusRow("Host writes", `${hostState.writeCount}`),
    statusRow("Last saved comments", `${hostState.lastSavedCommentCount}`),
  ].join("");
}

function statusRow(label: string, value: string): string {
  return `<div class="status-row"><span class="status-label">${escapeHtml(label)}</span><span class="status-value">${escapeHtml(value)}</span></div>`;
}

function renderJsonPanels(): void {
  stateOutput.textContent = JSON.stringify(currentState, null, 2);
  hostOutput.textContent = JSON.stringify({
    markdownSource: hostState.markdownSource,
    sidecarPath: hostState.sidecarPath,
    lastSavedAt: hostState.lastSavedAt,
    writeCount: hostState.writeCount,
    sidecar: hostState.sidecar,
  }, null, 2);
}

function renderAll(): void {
  renderSelection();
  renderThreads();
  renderStatus();
  renderJsonPanels();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
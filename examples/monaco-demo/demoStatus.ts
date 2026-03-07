import type { ReviewState } from "@mrsf/monaco-mrsf/browser";

export interface DemoStatusState {
  dirtySidecar: boolean;
  pendingAnchorShifts: boolean;
  lastSavedAt: string | null;
  lastSavedCommentCount: number;
  pendingDocumentChangeCount: number;
  summary: string;
}

export interface DemoStatusTargets {
  saveIndicator: HTMLElement;
  anchorIndicator: HTMLElement;
  lastSaved: HTMLElement;
  editorSummary: HTMLElement;
  statusPanel: HTMLElement;
}

export function createDemoStatusState(initialCommentCount: number): DemoStatusState {
  return {
    dirtySidecar: false,
    pendingAnchorShifts: false,
    lastSavedAt: null,
    lastSavedCommentCount: initialCommentCount,
    pendingDocumentChangeCount: 0,
    summary: "Select text or use the gutter to add comments. Unsaved sidecar edits and live anchor shifts are tracked here.",
  };
}

export function formatTimestamp(value: string | null): string {
  if (!value) {
    return "No host write yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function markDirty(
  state: DemoStatusState,
  summary: string,
  pendingAnchorShifts = state.pendingAnchorShifts,
): void {
  state.dirtySidecar = true;
  state.pendingAnchorShifts = pendingAnchorShifts;
  state.summary = summary;
}

export function markSaved(
  state: DemoStatusState,
  summary: string,
  commentCount: number,
): void {
  state.dirtySidecar = false;
  state.pendingAnchorShifts = false;
  state.lastSavedAt = new Date().toISOString();
  state.lastSavedCommentCount = commentCount;
  state.pendingDocumentChangeCount = 0;
  state.summary = summary;
}

export function recordPendingDocumentChanges(state: DemoStatusState, changeCount: number): void {
  state.pendingDocumentChangeCount += changeCount;
}

export function clearPendingDocumentChanges(state: DemoStatusState): void {
  state.pendingDocumentChangeCount = 0;
}

export function renderDemoStatus(
  targets: DemoStatusTargets,
  state: DemoStatusState,
  reviewState: ReviewState | null,
): void {
  const commentCount = reviewState?.document.comments.length ?? 0;
  const threadCount = reviewState?.snapshot.threadsByLine.reduce(
    (total, entry) => total + entry.threads.length,
    0,
  ) ?? 0;

  targets.saveIndicator.textContent = state.dirtySidecar ? "Unsaved sidecar edits" : "Saved";
  targets.saveIndicator.className = state.dirtySidecar
    ? "meta-pill meta-pill-dirty"
    : "meta-pill meta-pill-clean";

  targets.anchorIndicator.textContent = state.pendingAnchorShifts
    ? "Anchors moved locally"
    : "Anchors in sync";
  targets.anchorIndicator.className = state.pendingAnchorShifts
    ? "meta-pill meta-pill-warning"
    : "meta-pill meta-pill-clean";

  targets.lastSaved.textContent = state.lastSavedAt
    ? `Last host write ${formatTimestamp(state.lastSavedAt)}`
    : "No host write yet";
  targets.editorSummary.textContent = state.summary;

  targets.statusPanel.innerHTML = [
    `<div class="status-row"><span class="status-label">Comment count</span><strong class="status-value">${commentCount}</strong></div>`,
    `<div class="status-row"><span class="status-label">Visible threads</span><strong class="status-value">${threadCount}</strong></div>`,
    `<div class="status-row"><span class="status-label">Unsaved changes</span><span class="status-value">${state.dirtySidecar ? "Yes" : "No"}</span></div>`,
    `<div class="status-row"><span class="status-label">Pending anchor shifts</span><span class="status-value">${state.pendingAnchorShifts ? "Yes" : "No"}</span></div>`,
    `<div class="status-row"><span class="status-label">Document edits since save</span><span class="status-value">${state.pendingDocumentChangeCount}</span></div>`,
    `<div class="status-row"><span class="status-label">Last saved comments</span><span class="status-value">${state.lastSavedCommentCount}</span></div>`,
    `<div class="status-row"><span class="status-label">Host snapshot</span><span class="status-value">${formatTimestamp(state.lastSavedAt)}</span></div>`,
  ].join("");
}
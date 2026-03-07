// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createDemoStatusState,
  markDirty,
  markSaved,
  recordPendingDocumentChanges,
  renderDemoStatus,
} from "../demoStatus.js";

function createTargets() {
  document.body.innerHTML = `
    <span id="save-indicator"></span>
    <span id="anchor-indicator"></span>
    <span id="last-saved"></span>
    <div id="editor-summary"></div>
    <div id="status-panel"></div>
  `;

  return {
    saveIndicator: document.getElementById("save-indicator") as HTMLElement,
    anchorIndicator: document.getElementById("anchor-indicator") as HTMLElement,
    lastSaved: document.getElementById("last-saved") as HTMLElement,
    editorSummary: document.getElementById("editor-summary") as HTMLElement,
    statusPanel: document.getElementById("status-panel") as HTMLElement,
  };
}

function createReviewState(commentCount = 3, threadCount = 2) {
  return {
    document: {
      comments: Array.from({ length: commentCount }, (_, index) => ({ id: `c${index + 1}` })),
    },
    snapshot: {
      threadsByLine: Array.from({ length: threadCount }, (_, index) => ({
        line: index + 1,
        threads: [{ rootCommentId: `c${index + 1}`, commentIds: [`c${index + 1}`] }],
      })),
    },
  };
}

describe("demoStatus", () => {
  it("renders the clean saved state", () => {
    const targets = createTargets();
    const state = createDemoStatusState(3);

    renderDemoStatus(targets, state, createReviewState() as never);

    expect(targets.saveIndicator.textContent).toBe("Saved");
    expect(targets.saveIndicator.className).toContain("meta-pill-clean");
    expect(targets.anchorIndicator.textContent).toBe("Anchors in sync");
    expect(targets.lastSaved.textContent).toBe("No host write yet");
    expect(targets.editorSummary.textContent).toContain("Unsaved sidecar edits and live anchor shifts are tracked here.");
    expect(targets.statusPanel.textContent).toContain("Document edits since save");
    expect(targets.statusPanel.textContent).toContain("0");
  });

  it("renders dirty state with pending anchor shifts", () => {
    const targets = createTargets();
    const state = createDemoStatusState(3);

    recordPendingDocumentChanges(state, 2);
    markDirty(state, "Document edits moved comment anchors locally.", true);
    renderDemoStatus(targets, state, createReviewState(4, 3) as never);

    expect(targets.saveIndicator.textContent).toBe("Unsaved sidecar edits");
    expect(targets.saveIndicator.className).toContain("meta-pill-dirty");
    expect(targets.anchorIndicator.textContent).toBe("Anchors moved locally");
    expect(targets.anchorIndicator.className).toContain("meta-pill-warning");
    expect(targets.editorSummary.textContent).toBe("Document edits moved comment anchors locally.");
    expect(targets.statusPanel.textContent).toContain("Unsaved changesYes");
    expect(targets.statusPanel.textContent).toContain("Pending anchor shiftsYes");
    expect(targets.statusPanel.textContent).toContain("Document edits since save2");
  });

  it("returns to clean state after saving", () => {
    const targets = createTargets();
    const state = createDemoStatusState(3);

    recordPendingDocumentChanges(state, 3);
    markDirty(state, "Dirty before save.", true);
    markSaved(state, "Host snapshot written.", 5);
    renderDemoStatus(targets, state, createReviewState(5, 2) as never);

    expect(targets.saveIndicator.textContent).toBe("Saved");
    expect(targets.saveIndicator.className).toContain("meta-pill-clean");
    expect(targets.anchorIndicator.textContent).toBe("Anchors in sync");
    expect(targets.editorSummary.textContent).toBe("Host snapshot written.");
    expect(targets.lastSaved.textContent).toContain("Last host write ");
    expect(targets.statusPanel.textContent).toContain("Document edits since save0");
    expect(targets.statusPanel.textContent).toContain("Last saved comments5");
  });
});
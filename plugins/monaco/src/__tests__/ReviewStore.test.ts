import { describe, expect, it } from "vitest";
import type { MrsfDocument } from "@mrsf/cli";
import { ReviewStore } from "../core/ReviewStore.js";
import type { MonacoMrsfHostAdapter } from "../host/HostAdapter.js";

function makeHost(overrides: Partial<MonacoMrsfHostAdapter> = {}): MonacoMrsfHostAdapter {
  return {
    async getDocumentText() {
      return "alpha\nbeta\ngamma";
    },
    async getDocumentPath() {
      return "/tmp/doc.md";
    },
    async discoverSidecar() {
      return "/tmp/doc.md.review.yaml";
    },
    async readSidecar() {
      return {
        mrsf_version: "1.0",
        document: "doc.md",
        comments: [
          {
            id: "c1",
            author: "A",
            timestamp: "2025-01-01T00:00:00.000Z",
            text: "Comment",
            resolved: false,
            line: 2,
            start_column: 0,
            end_column: 4,
          },
        ],
      } as MrsfDocument;
    },
    async writeSidecar() {},
    ...overrides,
  };
}

describe("ReviewStore", () => {
  it("loads sidecars and projects snapshots", async () => {
    const store = new ReviewStore(makeHost(), { showResolved: true });
    const state = await store.load("file:///doc.md");

    expect(state.sidecarPath).toBe("/tmp/doc.md.review.yaml");
    expect(state.snapshot.gutterMarks).toHaveLength(1);
    expect(state.snapshot.inlineRanges).toHaveLength(1);
  });

  it("adds comments and populates selected text from document lines", async () => {
    const store = new ReviewStore(makeHost(), { showResolved: true });
    await store.load("file:///doc.md");
    const comment = await store.addComment("file:///doc.md", {
      text: "Inline",
      author: "B",
      line: 1,
      start_column: 0,
      end_column: 5,
    });

    expect(comment.selected_text).toBe("alpha");
    expect(store.getState("file:///doc.md")?.snapshot.inlineRanges).toHaveLength(2);
  });

  it("saves and clears dirty flags", async () => {
    let writes = 0;
    const store = new ReviewStore(makeHost({
      async writeSidecar() {
        writes += 1;
      },
    }));

    await store.load("file:///doc.md");
    await store.addComment("file:///doc.md", {
      text: "New",
      author: "A",
      line: 3,
    });
    await store.save("file:///doc.md");

    expect(writes).toBe(1);
    expect(store.getState("file:///doc.md")?.dirty).toBe(false);
    expect(store.getState("file:///doc.md")?.hasPendingShifts).toBe(false);
  });

  it("edits existing comments in place", async () => {
    const store = new ReviewStore(makeHost(), { showResolved: true });
    await store.load("file:///doc.md");

    const comment = store.edit("file:///doc.md", "c1", {
      text: "Updated",
      type: "issue",
      severity: "high",
    });

    expect(comment.text).toBe("Updated");
    expect(comment.type).toBe("issue");
    expect(comment.severity).toBe("high");
    expect(store.getState("file:///doc.md")?.dirty).toBe(true);
  });

  it("reanchors comments against the current document text", async () => {
    const host = makeHost({
      async getDocumentText() {
        return "intro\nalpha\nbeta\ngamma";
      },
      async discoverSidecar() {
        return "/tmp/doc.md.review.yaml";
      },
      async readSidecar() {
        return {
          mrsf_version: "1.0",
          document: "doc.md",
          comments: [
            {
              id: "c1",
              author: "A",
              timestamp: "2025-01-01T00:00:00.000Z",
              text: "Comment",
              resolved: false,
              line: 1,
              start_column: 0,
              end_column: 5,
              selected_text: "alpha",
            },
          ],
        } as MrsfDocument;
      },
    });

    const store = new ReviewStore(host);
    await store.load("file:///doc.md");
    await store.reanchor("file:///doc.md");

    const state = store.getState("file:///doc.md");
    expect(state?.document.comments[0].line).toBe(2);
    expect(state?.lastReanchorResults[0].status).toBe("anchored");
  });
});
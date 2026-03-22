import { describe, expect, it } from "vitest";
import type { MrsfDocument } from "@mrsf/cli/browser";
import { ReviewStore } from "../core/ReviewStore.js";
import type { MilkdownMrsfHostAdapter } from "../host/HostAdapter.js";

function makeHost(overrides: Partial<MilkdownMrsfHostAdapter> = {}): MilkdownMrsfHostAdapter {
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

  it("creates an empty document when no sidecar exists and exercises save and reanchor branches", async () => {
    const writes: MrsfDocument[] = [];
    const host = makeHost({
      async discoverSidecar() {
        return null;
      },
      async readSidecar() {
        return null;
      },
      async writeSidecar(_path, document) {
        writes.push(structuredClone(document));
      },
    });

    const store = new ReviewStore(host, { showResolved: true });
    const state = await store.load("resource-id");

    expect(state.document.document).toBe("/tmp/doc.md");
    expect(state.document.comments).toHaveLength(0);
    expect(store.getThreadsAtLine("resource-id", 99)).toEqual([]);
    await expect(store.save("resource-id")).rejects.toThrow("No sidecar path is available");

    state.sidecarPath = "/tmp/doc.md.review.yaml";
    await store.reanchor("resource-id", { autoSave: true, updateText: true, force: true, threshold: 0.9 });
    expect(writes).toHaveLength(1);
    expect(state.dirty).toBe(false);
    expect(state.hasPendingShifts).toBe(false);
  });

  it("projects stored anchors against current editor text without mutating the stored sidecar", async () => {
    const host = makeHost({
      async getDocumentText() {
        return "preface\nalpha\nbeta\ngamma";
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

    const store = new ReviewStore(host, { showResolved: true });
    const state = await store.load("file:///doc.md");

    expect(state.document.comments[0].line).toBe(1);
    expect(state.projectedDocument.comments[0].line).toBe(2);
    expect(state.snapshot.inlineRanges).toHaveLength(1);
    expect(state.snapshot.inlineRanges[0]?.line).toBe(2);
  });

  it("throws for unknown resources and parents", async () => {
    const store = new ReviewStore(makeHost(), { showResolved: true });

    expect(() => store.getThreadsAtLine("missing", 1)).toThrow("No review state loaded");
    await expect(store.reply("missing", "parent", { text: "Reply" })).rejects.toThrow("No review state loaded");

    await store.load("file:///doc.md");
    await expect(store.reply("file:///doc.md", "unknown", { text: "Reply" })).rejects.toThrow("Unknown parent comment");
    expect(() => store.edit("file:///doc.md", "unknown", { text: "Edit" })).toThrow("Unknown comment");
  });
});
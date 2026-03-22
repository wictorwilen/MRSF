import { describe, expect, it } from "vitest";
import type { MrsfDocument } from "@mrsf/cli/browser";
import { ReviewStore } from "../core/ReviewStore.js";
import type { TiptapMrsfHostAdapter } from "../host/HostAdapter.js";

function makeHost(overrides: Partial<TiptapMrsfHostAdapter> = {}): TiptapMrsfHostAdapter {
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
});
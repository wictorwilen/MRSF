import { describe, expect, it } from "vitest";
import { MemoryHostAdapter } from "../host/MemoryHostAdapter.js";

describe("MemoryHostAdapter", () => {
  it("updates document text and notifies watchers", async () => {
    const adapter = new MemoryHostAdapter({
      resources: {
        "file:///doc.md": {
          documentText: "alpha",
          documentPath: "/tmp/doc.md",
          sidecarPath: "/tmp/doc.md.review.yaml",
        },
      },
    });

    let calls = 0;
    const dispose = adapter.watchDocument("file:///doc.md", async () => {
      calls += 1;
    });

    await adapter.updateDocument("file:///doc.md", "beta");

    expect(await adapter.getDocumentText("file:///doc.md")).toBe("beta");
    expect(calls).toBe(1);
    await dispose();
  });

  it("stores sidecar writes and emits sidecar watch events", async () => {
    const adapter = new MemoryHostAdapter({
      resources: {
        "file:///doc.md": {
          documentText: "alpha",
          documentPath: "/tmp/doc.md",
          sidecarPath: "/tmp/doc.md.review.yaml",
          sidecar: {
            mrsf_version: "1.0",
            document: "doc.md",
            comments: [],
          },
        },
      },
    });

    let calls = 0;
    const dispose = adapter.watchSidecar("/tmp/doc.md.review.yaml", async () => {
      calls += 1;
    });

    await adapter.writeSidecar("/tmp/doc.md.review.yaml", {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [
        {
          id: "c1",
          author: "A",
          timestamp: "2025-01-01T00:00:00.000Z",
          text: "Comment",
          resolved: false,
        },
      ],
    });

    const snapshot = adapter.snapshot("file:///doc.md");
    expect(snapshot.sidecar?.comments).toHaveLength(1);
    expect(adapter.savedSidecarSnapshot("file:///doc.md")?.comments).toHaveLength(1);
    expect(calls).toBe(1);
    await dispose();
  });

  it("preserves the last written sidecar when live sidecar edits continue", async () => {
    const adapter = new MemoryHostAdapter({
      resources: {
        "file:///doc.md": {
          documentText: "alpha",
          documentPath: "/tmp/doc.md",
          sidecarPath: "/tmp/doc.md.review.yaml",
          sidecar: {
            mrsf_version: "1.0",
            document: "doc.md",
            comments: [],
          },
        },
      },
    });

    await adapter.writeSidecar("/tmp/doc.md.review.yaml", {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [
        {
          id: "saved",
          author: "A",
          timestamp: "2025-01-01T00:00:00.000Z",
          text: "Saved",
          resolved: false,
          line: 2,
        },
      ],
    });

    await adapter.updateSidecar("file:///doc.md", {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [
        {
          id: "live",
          author: "A",
          timestamp: "2025-01-01T00:00:00.000Z",
          text: "Unsaved",
          resolved: false,
          line: 4,
        },
      ],
    });

    expect(adapter.snapshot("file:///doc.md").sidecar?.comments[0]?.id).toBe("live");
    expect(adapter.savedSidecarSnapshot("file:///doc.md")?.comments[0]?.id).toBe("saved");
  });
});
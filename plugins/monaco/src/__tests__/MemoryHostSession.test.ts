import { describe, expect, it } from "vitest";
import { MemoryHostAdapter } from "../host/MemoryHostAdapter.js";
import { MemoryHostSession } from "../host/MemoryHostSession.js";

describe("MemoryHostSession", () => {
  it("mutates sidecars and persists the current snapshot", async () => {
    const resourceId = "file:///demo.md";
    const host = new MemoryHostAdapter({
      resources: {
        [resourceId]: {
          documentText: "alpha\nbeta",
          documentPath: "/tmp/demo.md",
          sidecarPath: "/tmp/demo.md.review.yaml",
          sidecar: {
            mrsf_version: "1.0",
            document: "/tmp/demo.md",
            comments: [],
          },
        },
      },
    });
    const session = new MemoryHostSession(host, resourceId);

    await session.mutateSidecar((sidecar) => {
      sidecar.comments.push({
        id: "c1",
        author: "A",
        timestamp: "2026-03-10T00:00:00.000Z",
        text: "Comment",
        resolved: false,
        line: 2,
      });
    });

    expect(session.snapshot().sidecar?.comments).toHaveLength(1);
    await session.persistCurrentSidecar();
    expect(session.savedSidecarSnapshot()?.comments).toHaveLength(1);
  });

  it("creates an empty sidecar when one is missing", () => {
    const resourceId = "file:///demo.md";
    const host = new MemoryHostAdapter({
      resources: {
        [resourceId]: {
          documentText: "alpha\nbeta",
          documentPath: "/tmp/demo.md",
          sidecarPath: "/tmp/demo.md.review.yaml",
        },
      },
    });
    const session = new MemoryHostSession(host, resourceId);

    expect(session.ensureSidecar()).toEqual({
      mrsf_version: "1.0",
      document: "/tmp/demo.md",
      comments: [],
    });
  });
});
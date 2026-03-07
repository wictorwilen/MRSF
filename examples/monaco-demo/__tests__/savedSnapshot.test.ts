import { describe, expect, it } from "vitest";
import { reanchorSavedSnapshot } from "../savedSnapshot.js";

describe("reanchorSavedSnapshot", () => {
  it("reanchors a saved sidecar against the current document text", () => {
    const savedSidecar = {
      mrsf_version: "1.0",
      document: "/examples/monaco-demo/demo.md",
      comments: [
        {
          id: "comment-1",
          author: "Reviewer",
          timestamp: "2026-03-07T12:00:00.000Z",
          text: "Review note",
          resolved: false,
          line: 2,
          selected_text: "Target sentence.",
        },
      ],
    };

    const documentText = [
      "# Demo",
      "Inserted line.",
      "Target sentence.",
      "Trailing line.",
    ].join("\n");

    const result = reanchorSavedSnapshot(savedSidecar, documentText);

    expect(result.changed).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("anchored");
    expect(result.sidecar.comments[0]?.line).toBe(3);
  });
});
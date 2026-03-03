/**
 * Tests for the discovery module.
 */

import { describe, it, expect } from "vitest";
import { sidecarToDocument } from "../lib/discovery.js";
import path from "node:path";

describe("sidecarToDocument", () => {
  it("strips .review.yaml suffix", () => {
    // sidecarToDocument resolves relative to workspace root
    // Test with a path that will be relative to cwd
    const result = sidecarToDocument("doc.md.review.yaml");
    expect(result).toMatch(/doc\.md$/);
  });

  it("strips .review.json suffix", () => {
    const result = sidecarToDocument("doc.md.review.json");
    expect(result).toMatch(/doc\.md$/);
  });

  it("handles nested paths", () => {
    const result = sidecarToDocument("docs/guide/setup.md.review.yaml");
    expect(result).toMatch(/docs[/\\]guide[/\\]setup\.md$/);
  });
});

/**
 * Tests for the resolve-files module.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolveSidecarPaths } from "../lib/resolve-files.js";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("resolveSidecarPaths", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "resolve-files-"));
  });

  it("resolves sidecar path directly when file ends in .review.yaml", async () => {
    const result = await resolveSidecarPaths(
      ["doc.md.review.yaml"],
      tmpDir,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(path.join(tmpDir, "doc.md.review.yaml"));
  });

  it("resolves sidecar path directly when file ends in .review.json", async () => {
    const result = await resolveSidecarPaths(
      ["doc.md.review.json"],
      tmpDir,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(path.join(tmpDir, "doc.md.review.json"));
  });

  it("discovers sidecar for a .md document path", async () => {
    // Create both the document and sidecar
    const docPath = path.join(tmpDir, "test.md");
    const sidecarPath = path.join(tmpDir, "test.md.review.yaml");
    await writeFile(docPath, "# Test\n");
    await writeFile(
      sidecarPath,
      'mrsf_version: "1.0"\ndocument: test.md\ncomments: []\n',
    );

    const result = await resolveSidecarPaths(["test.md"], tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(sidecarPath);
  });

  it("discovers all sidecars when files is empty", async () => {
    // Create a workspace with sidecars
    const sidecar1 = path.join(tmpDir, "a.md.review.yaml");
    const sidecar2 = path.join(tmpDir, "b.md.review.yaml");
    await writeFile(sidecar1, "mrsf_version: '1.0'\ndocument: a.md\ncomments: []\n");
    await writeFile(sidecar2, "mrsf_version: '1.0'\ndocument: b.md\ncomments: []\n");

    const result = await resolveSidecarPaths([], tmpDir);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result).toContain(sidecar1);
    expect(result).toContain(sidecar2);
  });

  it("handles multiple files (mixed sidecar and document)", async () => {
    const docPath = path.join(tmpDir, "doc.md");
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    await writeFile(docPath, "# Doc\n");
    await writeFile(sidecarPath, 'mrsf_version: "1.0"\ndocument: doc.md\ncomments: []\n');

    const result = await resolveSidecarPaths(
      ["doc.md", "other.md.review.yaml"],
      tmpDir,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(sidecarPath);
    expect(result[1]).toBe(path.join(tmpDir, "other.md.review.yaml"));
  });
});

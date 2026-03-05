/**
 * Tests for the discovery module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sidecarToDocument,
  findWorkspaceRoot,
  loadConfig,
  discoverSidecar,
  discoverAllSidecars,
} from "../lib/discovery.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("sidecarToDocument", () => {
  it("strips .review.yaml suffix", () => {
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

  it("returns path as-is when no sidecar suffix", () => {
    const result = sidecarToDocument("some/random/file.txt");
    expect(result).toMatch(/some[/\\]random[/\\]file\.txt$/);
  });
});

// ---------------------------------------------------------------------------
// findWorkspaceRoot
// ---------------------------------------------------------------------------

describe("findWorkspaceRoot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-discovery-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds directory with .mrsf.yaml", () => {
    fs.writeFileSync(path.join(tmpDir, ".mrsf.yaml"), "sidecar_root: reviews\n");
    const nested = path.join(tmpDir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });

    const result = findWorkspaceRoot(nested);
    expect(result).toBe(tmpDir);
  });

  it("finds directory with .git", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    const nested = path.join(tmpDir, "deep", "nested");
    fs.mkdirSync(nested, { recursive: true });

    const result = findWorkspaceRoot(nested);
    expect(result).toBe(tmpDir);
  });

  it("returns start dir when no root marker found", () => {
    // tmpDir has no .git or .mrsf.yaml
    const result = findWorkspaceRoot(tmpDir);
    expect(result).toBe(path.resolve(tmpDir));
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no config file exists", async () => {
    const result = await loadConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("parses sidecar_root from config", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: reviews\n",
    );
    const result = await loadConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.sidecar_root).toBe("reviews");
  });

  it("throws on absolute sidecar_root", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: /absolute/path\n",
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow("relative path");
  });

  it("throws on sidecar_root with path traversal", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: ../escape\n",
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow('".."');
  });

  it("returns empty config when sidecar_root is not set", async () => {
    fs.writeFileSync(path.join(tmpDir, ".mrsf.yaml"), "some_other_key: value\n");
    const result = await loadConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.sidecar_root).toBeUndefined();
  });

  it("returns null for non-object YAML content", async () => {
    fs.writeFileSync(path.join(tmpDir, ".mrsf.yaml"), "just a string\n");
    const result = await loadConfig(tmpDir);
    expect(result).toBeNull();
  });

  it("loads config from explicit configPath", async () => {
    const customPath = path.join(tmpDir, "custom-config.yaml");
    fs.writeFileSync(customPath, "sidecar_root: custom\n");
    const result = await loadConfig(tmpDir, customPath);
    expect(result).not.toBeNull();
    expect(result!.sidecar_root).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// discoverSidecar
// ---------------------------------------------------------------------------

describe("discoverSidecar", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-discover-"));
    // Create a .git dir so findWorkspaceRoot finds this as root
    fs.mkdirSync(path.join(tmpDir, ".git"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns co-located sidecar by default", async () => {
    const result = await discoverSidecar("docs/api.md", { cwd: tmpDir });
    expect(result).toBe(path.join(tmpDir, "docs/api.md.review.yaml"));
  });

  it("uses sidecar_root from config", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mrsf.yaml"),
      "sidecar_root: reviews\n",
    );
    const result = await discoverSidecar("docs/api.md", { cwd: tmpDir });
    expect(result).toBe(path.join(tmpDir, "reviews/docs/api.md.review.yaml"));
  });

  it("handles absolute document path", async () => {
    const absDoc = path.join(tmpDir, "docs/api.md");
    const result = await discoverSidecar(absDoc, { cwd: tmpDir });
    expect(result).toBe(path.join(tmpDir, "docs/api.md.review.yaml"));
  });
});

// ---------------------------------------------------------------------------
// discoverAllSidecars
// ---------------------------------------------------------------------------

describe("discoverAllSidecars", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-allsidecar-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers .review.yaml files recursively", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.md.review.yaml"), "");
    fs.writeFileSync(path.join(tmpDir, "docs", "b.md.review.yaml"), "");
    fs.writeFileSync(path.join(tmpDir, "docs", "c.md"), ""); // not a sidecar

    const results = await discoverAllSidecars(tmpDir);
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.endsWith("a.md.review.yaml"))).toBe(true);
    expect(results.some((r) => r.endsWith("b.md.review.yaml"))).toBe(true);
  });

  it("discovers .review.json files", async () => {
    fs.writeFileSync(path.join(tmpDir, "x.md.review.json"), "");

    const results = await discoverAllSidecars(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/x\.md\.review\.json$/);
  });

  it("skips node_modules and .git directories", async () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg.md.review.yaml"), "");
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".git", "x.md.review.yaml"), "");
    fs.writeFileSync(path.join(tmpDir, "real.md.review.yaml"), "");

    const results = await discoverAllSidecars(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/real\.md\.review\.yaml$/);
  });

  it("returns single file when path is a file", async () => {
    const filePath = path.join(tmpDir, "single.md.review.yaml");
    fs.writeFileSync(filePath, "");

    const results = await discoverAllSidecars(filePath);
    expect(results).toHaveLength(1);
  });

  it("returns empty for directory with no sidecars", async () => {
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "");
    const results = await discoverAllSidecars(tmpDir);
    expect(results).toHaveLength(0);
  });
});

/**
 * Tests for the git integration module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseDiffHunks,
  getLineShift,
  isGitAvailable,
  resetGitCache,
  findRepoRoot,
  getCurrentCommit,
  isStale,
  getDiff,
  getFileAtCommit,
  getStagedFiles,
  getStagedDiff,
  detectRenames,
  stageFile,
} from "../lib/git.js";
import type { DiffHunk } from "../lib/types.js";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFile = promisify(execFileCb);

describe("parseDiffHunks", () => {
  it("parses a simple unified diff", () => {
    const diff = `diff --git a/file.md b/file.md
index abc..def 100644
--- a/file.md
+++ b/file.md
@@ -3,0 +4,2 @@ some context
+inserted line 1
+inserted line 2
@@ -10,1 +13,1 @@ more context
-old line
+new line`;

    const hunks = parseDiffHunks(diff);
    expect(hunks).toHaveLength(2);

    expect(hunks[0].oldStart).toBe(3);
    expect(hunks[0].oldCount).toBe(0);
    expect(hunks[0].newStart).toBe(4);
    expect(hunks[0].newCount).toBe(2);

    expect(hunks[1].oldStart).toBe(10);
    expect(hunks[1].oldCount).toBe(1);
    expect(hunks[1].newStart).toBe(13);
    expect(hunks[1].newCount).toBe(1);
  });

  it("returns empty for no hunks", () => {
    expect(parseDiffHunks("")).toHaveLength(0);
  });

  it("handles hunk header with no count (implicit 1)", () => {
    const diff = `@@ -5 +5 @@ context
-old
+new`;
    const hunks = parseDiffHunks(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldCount).toBe(1);
    expect(hunks[0].newCount).toBe(1);
  });

  it("collects +, -, and context lines", () => {
    const diff = `@@ -1,3 +1,4 @@
 context
-deleted
+added1
+added2
 context2`;
    const hunks = parseDiffHunks(diff);
    expect(hunks[0].lines).toHaveLength(5);
  });
});

describe("getLineShift", () => {
  // 2 lines inserted at old line 3
  const hunks: DiffHunk[] = [
    { oldStart: 3, oldCount: 0, newStart: 4, newCount: 2, lines: [] },
  ];

  it("returns 0 shift for lines before the hunk", () => {
    const result = getLineShift(hunks, 1);
    expect(result.shift).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("returns positive shift for lines after insertion", () => {
    const result = getLineShift(hunks, 5);
    expect(result.shift).toBe(2);
    expect(result.modified).toBe(false);
  });

  it("handles deletion hunks", () => {
    const deleteHunks: DiffHunk[] = [
      { oldStart: 5, oldCount: 3, newStart: 5, newCount: 0, lines: [] },
    ];
    const result = getLineShift(deleteHunks, 10);
    expect(result.shift).toBe(-3);
    expect(result.modified).toBe(false);
  });

  it("marks modified lines", () => {
    const modHunks: DiffHunk[] = [
      { oldStart: 5, oldCount: 2, newStart: 5, newCount: 2, lines: [] },
    ];
    const result = getLineShift(modHunks, 5);
    expect(result.modified).toBe(true);
  });

  it("handles multiple hunks cumulatively", () => {
    const multiHunks: DiffHunk[] = [
      { oldStart: 2, oldCount: 0, newStart: 2, newCount: 1, lines: [] }, // +1
      { oldStart: 5, oldCount: 0, newStart: 6, newCount: 2, lines: [] }, // +2
    ];
    const result = getLineShift(multiHunks, 10);
    expect(result.shift).toBe(3);
    expect(result.modified).toBe(false);
  });

  it("returns 0 shift with empty hunks", () => {
    const result = getLineShift([], 5);
    expect(result.shift).toBe(0);
    expect(result.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Git subprocess functions (with real git repo)
// ---------------------------------------------------------------------------

describe("git operations with real repo", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetGitCache();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrsf-git-"));
    await execFile("git", ["init"], { cwd: tmpDir });
    await execFile("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    await execFile("git", ["config", "user.name", "Test"], { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetGitCache();
  });

  it("isGitAvailable returns true when git is installed", async () => {
    const available = await isGitAvailable();
    expect(available).toBe(true);
  });

  it("isGitAvailable caches the result", async () => {
    const first = await isGitAvailable();
    const second = await isGitAvailable();
    expect(first).toBe(second);
  });

  it("findRepoRoot returns the repo root", async () => {
    const nested = path.join(tmpDir, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    const root = await findRepoRoot(nested);
    expect(root).toBe(tmpDir);
  });

  it("getCurrentCommit returns HEAD SHA after a commit", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "hello\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: tmpDir });

    const commit = await getCurrentCommit(tmpDir);
    expect(commit).toBeTruthy();
    expect(commit!.length).toBe(40);
  });

  it("getCurrentCommit returns null for brand new repo", async () => {
    const commit = await getCurrentCommit(tmpDir);
    expect(commit).toBeNull();
  });

  it("isStale returns true when commits differ", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "v1\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v1"], { cwd: tmpDir });
    const { stdout: c1 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, "file.md"), "v2\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v2"], { cwd: tmpDir });

    const stale = await isStale(c1.trim(), tmpDir);
    expect(stale).toBe(true);
  });

  it("isStale returns false when HEAD matches", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: tmpDir });
    const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    const stale = await isStale(stdout.trim(), tmpDir);
    expect(stale).toBe(false);
  });

  it("getDiff returns hunks between commits", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "line 1\nline 2\nline 3\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v1"], { cwd: tmpDir });
    const { stdout: c1 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, "file.md"), "line 1\nnew line\nline 2\nline 3\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v2"], { cwd: tmpDir });
    const { stdout: c2 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    const hunks = await getDiff(c1.trim(), c2.trim(), "file.md", tmpDir);
    expect(hunks.length).toBeGreaterThan(0);
  });

  it("getFileAtCommit returns file contents at a commit", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "original content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v1"], { cwd: tmpDir });
    const { stdout: c1 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, "file.md"), "modified content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v2"], { cwd: tmpDir });

    const content = await getFileAtCommit(c1.trim(), "file.md", tmpDir);
    expect(content).toBe("original content\n");
  });

  it("getFileAtCommit returns null for nonexistent file", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v1"], { cwd: tmpDir });
    const { stdout: c1 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    const content = await getFileAtCommit(c1.trim(), "nonexistent.md", tmpDir);
    expect(content).toBeNull();
  });

  it("getStagedFiles returns staged file names", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, "file.md"), "updated\n");
    await execFile("git", ["add", "file.md"], { cwd: tmpDir });

    const staged = await getStagedFiles(tmpDir);
    expect(staged).toContain("file.md");
  });

  it("getStagedFiles returns empty when nothing staged", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: tmpDir });

    const staged = await getStagedFiles(tmpDir);
    expect(staged).toHaveLength(0);
  });

  it("getStagedDiff returns hunks for staged changes", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "line 1\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, "file.md"), "line 1\nline 2\n");
    await execFile("git", ["add", "file.md"], { cwd: tmpDir });

    const hunks = await getStagedDiff("file.md", tmpDir);
    expect(hunks.length).toBeGreaterThanOrEqual(1);
  });

  it("detectRenames detects file renames", async () => {
    fs.writeFileSync(path.join(tmpDir, "old.md"), "some content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "v1"], { cwd: tmpDir });
    const { stdout: c1 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    await execFile("git", ["mv", "old.md", "new.md"], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "rename"], { cwd: tmpDir });
    const { stdout: c2 } = await execFile("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    const renames = await detectRenames(c1.trim(), c2.trim(), tmpDir);
    expect(renames.get("old.md")).toBe("new.md");
  });

  it("stageFile stages a file", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.md"), "content\n");
    await execFile("git", ["add", "."], { cwd: tmpDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: tmpDir });

    fs.writeFileSync(path.join(tmpDir, "file.md"), "changed\n");
    await stageFile("file.md", tmpDir);

    const staged = await getStagedFiles(tmpDir);
    expect(staged).toContain("file.md");
  });
});

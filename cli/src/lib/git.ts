/**
 * MRSF Git Integration — Git-aware operations for re-anchoring and discovery.
 *
 * Uses child_process.execFile (no shell) for safety.
 * All functions degrade gracefully when Git is unavailable.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { DiffHunk } from "./types.js";

const execFile = promisify(execFileCb);

const GIT_TIMEOUT = 10_000; // 10s

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

let _gitAvailable: boolean | null = null;

/**
 * Check whether `git` is available on PATH.
 */
export async function isGitAvailable(): Promise<boolean> {
  if (_gitAvailable != null) return _gitAvailable;
  try {
    await execFile("git", ["--version"], { timeout: GIT_TIMEOUT });
    _gitAvailable = true;
  } catch {
    _gitAvailable = false;
  }
  return _gitAvailable;
}

/** Reset cached availability (for testing). */
export function resetGitCache(): void {
  _gitAvailable = null;
}

// ---------------------------------------------------------------------------
// Repository info
// ---------------------------------------------------------------------------

/**
 * Find the Git repository root from a given directory.
 * Returns null if not in a Git repo.
 */
export async function findRepoRoot(cwd?: string): Promise<string | null> {
  if (!(await isGitAvailable())) return null;
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: cwd ?? process.cwd(), timeout: GIT_TIMEOUT },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Get the full HEAD commit SHA.
 */
export async function getCurrentCommit(repoRoot: string): Promise<string | null> {
  if (!(await isGitAvailable())) return null;
  try {
    const { stdout } = await execFile(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: repoRoot, timeout: GIT_TIMEOUT },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a commit hash is the same as HEAD.
 */
export async function isStale(
  commentCommit: string,
  repoRoot: string,
): Promise<boolean> {
  const head = await getCurrentCommit(repoRoot);
  if (!head) return false; // can't tell, assume not stale
  // Normalize: compare by prefix match (short vs long SHA)
  const minLen = Math.min(commentCommit.length, head.length);
  return commentCommit.slice(0, minLen) !== head.slice(0, minLen);
}

// ---------------------------------------------------------------------------
// Diff operations
// ---------------------------------------------------------------------------

/**
 * Parse unified diff output into structured hunks.
 */
export function parseDiffHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split("\n");
  let current: DiffHunk | null = null;

  for (const line of lines) {
    const hunkMatch = line.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
    );
    if (hunkMatch) {
      current = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] != null ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] != null ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      current.lines.push(line);
    }
  }

  return hunks;
}

/**
 * Get diff hunks between two commits for a specific file.
 */
export async function getDiff(
  fromCommit: string,
  toCommit: string,
  filePath: string,
  repoRoot: string,
): Promise<DiffHunk[]> {
  if (!(await isGitAvailable())) return [];
  try {
    const { stdout } = await execFile(
      "git",
      [
        "diff",
        `${fromCommit}..${toCommit}`,
        "--unified=0",
        "--no-color",
        "--",
        filePath,
      ],
      { cwd: repoRoot, timeout: GIT_TIMEOUT },
    );
    return parseDiffHunks(stdout);
  } catch {
    return [];
  }
}

/**
 * Calculate the net line shift for a given original line number
 * based on diff hunks.
 *
 * Returns the number of lines to add to the original line number,
 * or null if the line itself was modified/deleted.
 */
export function getLineShift(
  hunks: DiffHunk[],
  originalLine: number,
): { shift: number; modified: boolean } {
  let cumulativeShift = 0;

  for (const hunk of hunks) {
    const oldEnd = hunk.oldStart + hunk.oldCount - 1;

    // Hunk is entirely after our line — stop
    if (hunk.oldStart > originalLine) break;

    // Our line falls within this hunk — it was modified
    if (originalLine >= hunk.oldStart && originalLine <= oldEnd) {
      return { shift: cumulativeShift, modified: true };
    }

    // Hunk is entirely before our line — accumulate shift
    if (oldEnd < originalLine) {
      cumulativeShift += hunk.newCount - hunk.oldCount;
    }
  }

  return { shift: cumulativeShift, modified: false };
}

// ---------------------------------------------------------------------------
// File at commit
// ---------------------------------------------------------------------------

/**
 * Get the contents of a file at a specific commit.
 * Returns null if unavailable.
 */
export async function getFileAtCommit(
  commit: string,
  filePath: string,
  repoRoot: string,
): Promise<string | null> {
  if (!(await isGitAvailable())) return null;
  try {
    const { stdout } = await execFile(
      "git",
      ["show", `${commit}:${filePath}`],
      { cwd: repoRoot, timeout: GIT_TIMEOUT },
    );
    return stdout;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Staged files
// ---------------------------------------------------------------------------

/**
 * Get list of staged files matching a pattern.
 */
export async function getStagedFiles(
  repoRoot: string,
  pattern?: string,
): Promise<string[]> {
  if (!(await isGitAvailable())) return [];
  try {
    const args = ["diff", "--cached", "--name-only", "--diff-filter=d"];
    if (pattern) args.push("--", pattern);
    const { stdout } = await execFile("git", args, {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT,
    });
    return stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Get staged diff hunks for a specific file.
 */
export async function getStagedDiff(
  filePath: string,
  repoRoot: string,
): Promise<DiffHunk[]> {
  if (!(await isGitAvailable())) return [];
  try {
    const { stdout } = await execFile(
      "git",
      ["diff", "--cached", "--unified=0", "--no-color", "--", filePath],
      { cwd: repoRoot, timeout: GIT_TIMEOUT },
    );
    return parseDiffHunks(stdout);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Rename detection
// ---------------------------------------------------------------------------

/**
 * Detect file renames between two commits.
 * Returns a map of old path → new path.
 */
export async function detectRenames(
  fromCommit: string,
  toCommit: string,
  repoRoot: string,
): Promise<Map<string, string>> {
  if (!(await isGitAvailable())) return new Map();
  try {
    const { stdout } = await execFile(
      "git",
      ["diff", "--name-status", "-M", `${fromCommit}..${toCommit}`],
      { cwd: repoRoot, timeout: GIT_TIMEOUT },
    );

    const renames = new Map<string, string>();
    for (const line of stdout.trim().split("\n")) {
      const match = line.match(/^R\d*\t(.+)\t(.+)$/);
      if (match) {
        renames.set(match[1], match[2]);
      }
    }
    return renames;
  } catch {
    return new Map();
  }
}

/**
 * Stage a file for commit.
 */
export async function stageFile(
  filePath: string,
  repoRoot: string,
): Promise<void> {
  if (!(await isGitAvailable())) return;
  await execFile("git", ["add", filePath], {
    cwd: repoRoot,
    timeout: GIT_TIMEOUT,
  });
}

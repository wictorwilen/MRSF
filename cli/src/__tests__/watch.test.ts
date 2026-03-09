/**
 * Tests for the watch command module.
 *
 * We test the command's internal logic by mocking chokidar and the
 * underlying validate / reanchor functions.  This keeps tests fast and
 * avoids real filesystem watching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

// ── Mocks ──────────────────────────────────────────────────

// Mock chokidar — return an EventEmitter that we can fire manually.
class MockWatcher extends EventEmitter {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
    this.emit("close");
  }
}

let mockWatcher: MockWatcher;

vi.mock("chokidar", () => ({
  watch: (..._args: unknown[]) => {
    mockWatcher = new MockWatcher();
    return mockWatcher;
  },
}));

// Mock validateFile
const mockValidateFile = vi.fn();
vi.mock("../lib/validator.js", () => ({
  validateFile: (...args: unknown[]) => mockValidateFile(...args),
}));

// Mock reanchorFile
const mockReanchorFile = vi.fn();
vi.mock("../lib/reanchor.js", () => ({
  reanchorFile: (...args: unknown[]) => mockReanchorFile(...args),
}));

// Mock discoverSidecar — derive sidecar path from md path
const mockDiscoverSidecar = vi.fn();
vi.mock("../lib/discovery.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    discoverSidecar: (...args: unknown[]) =>
      mockDiscoverSidecar(...args),
  };
});

// Now import the module under test — mocks are already in place.
import { registerWatch } from "../commands/watch.js";
import { Command } from "commander";

// ── Helpers ────────────────────────────────────────────────

/** Build a CLI program with the watch command registered. */
function makeProgram(args: string[]): Command {
  const program = new Command();
  program
    .name("mrsf")
    .option("--cwd <dir>", "Working directory")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("-v, --verbose", "Verbose output");
  registerWatch(program);
  // Don't call process.exit on error
  program.exitOverride();
  return program;
}

/** Fire a chokidar event and wait for the debounce timer + handler. */
async function emitChange(
  filePath: string,
  debounceMs = 350,
): Promise<void> {
  mockWatcher.emit("change", filePath);
  // Wait for debounce + async handler
  await new Promise((r) => setTimeout(r, debounceMs));
}

async function emitAdd(
  filePath: string,
  debounceMs = 350,
): Promise<void> {
  mockWatcher.emit("add", filePath);
  await new Promise((r) => setTimeout(r, debounceMs));
}

// ── Setup / Teardown ───────────────────────────────────────

let tmpDir: string;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // Use a temp dir as cwd so paths resolve
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrsf-watch-test-"));

  // Default mock returns
  mockValidateFile.mockResolvedValue({
    valid: true,
    errors: [],
    warnings: [],
  });
  mockReanchorFile.mockResolvedValue({
    results: [],
    changed: 0,
    written: false,
  });
  mockDiscoverSidecar.mockImplementation((abs: string) =>
    Promise.resolve(abs + ".review.yaml"),
  );
});

afterEach(async () => {
  if (mockWatcher && !mockWatcher.closed) {
    await mockWatcher.close();
  }
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ── Tests ──────────────────────────────────────────────────

describe("watch — sidecar change triggers validate", () => {
  it("calls validateFile when a sidecar file changes", async () => {
    const program = makeProgram([]);
    const watchPromise = program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    // Give chokidar time to initialise
    await new Promise((r) => setTimeout(r, 50));

    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    await emitChange(sidecarPath, 120);

    expect(mockValidateFile).toHaveBeenCalledWith(sidecarPath);
    expect(mockReanchorFile).not.toHaveBeenCalled();

    // Clean shutdown
    mockWatcher.emit("close");
    await mockWatcher.close();
  });
});

describe("watch — markdown change without --reanchor", () => {
  it("validates sidecar but does not reanchor", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    const mdPath = path.join(tmpDir, "doc.md");
    await emitChange(mdPath, 120);

    expect(mockReanchorFile).not.toHaveBeenCalled();
    // Should still validate the companion sidecar
    expect(mockValidateFile).toHaveBeenCalledWith(mdPath + ".review.yaml");

    await mockWatcher.close();
  });
});

describe("watch — markdown change with --reanchor", () => {
  it("calls reanchorFile and then validateFile", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      "--reanchor",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    const mdPath = path.join(tmpDir, "doc.md");
    await emitChange(mdPath, 120);

    expect(mockReanchorFile).toHaveBeenCalledTimes(1);
    const [sidecarArg, optsArg] = mockReanchorFile.mock.calls[0];
    expect(sidecarArg).toBe(mdPath + ".review.yaml");
    expect(optsArg).toMatchObject({
      threshold: 0.6,
      dryRun: undefined,
    });

    // Validate also runs
    expect(mockValidateFile).toHaveBeenCalledWith(mdPath + ".review.yaml");

    await mockWatcher.close();
  });

  it("respects --dry-run flag", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      "--reanchor",
      "--dry-run",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    await emitChange(path.join(tmpDir, "doc.md"), 120);

    expect(mockReanchorFile).toHaveBeenCalledTimes(1);
    const [, optsArg] = mockReanchorFile.mock.calls[0];
    expect(optsArg.dryRun).toBe(true);

    await mockWatcher.close();
  });

  it("passes --threshold to reanchorFile", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      "--reanchor",
      "--threshold",
      "0.8",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    await emitChange(path.join(tmpDir, "doc.md"), 120);

    const [, optsArg] = mockReanchorFile.mock.calls[0];
    expect(optsArg.threshold).toBe(0.8);

    await mockWatcher.close();
  });

  it("passes noGit, fromCommit, updateText, and force through to reanchorFile", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      "--reanchor",
      "--no-git",
      "--from",
      "abc123",
      "--update-text",
      "--force",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    await emitChange(path.join(tmpDir, "doc.md"), 120);

    const [, optsArg] = mockReanchorFile.mock.calls[0];
    expect(optsArg).toMatchObject({
      noGit: true,
      fromCommit: "abc123",
      updateText: true,
      force: true,
    });

    await mockWatcher.close();
  });
});

describe("watch — debounce", () => {
  it("coalesces rapid events into a single handler call", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "100",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");

    // Fire 5 events in quick succession (< 100ms apart)
    for (let i = 0; i < 5; i++) {
      mockWatcher.emit("change", sidecarPath);
      await new Promise((r) => setTimeout(r, 20));
    }

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 200));

    // Should only have been called once
    expect(mockValidateFile).toHaveBeenCalledTimes(1);

    await mockWatcher.close();
  });
});

describe("watch — add event", () => {
  it("treats add events the same as change events", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    await emitAdd(sidecarPath, 120);

    expect(mockValidateFile).toHaveBeenCalledWith(sidecarPath);

    await mockWatcher.close();
  });
});

describe("watch — ignored files", () => {
  it("ignores non-markdown, non-sidecar file changes", async () => {
    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    await emitChange(path.join(tmpDir, "notes.txt"), 120);

    expect(mockValidateFile).not.toHaveBeenCalled();
    expect(mockReanchorFile).not.toHaveBeenCalled();

    await mockWatcher.close();
  });
});

describe("watch — self-write suppression", () => {
  it("does not re-validate when reanchor writes the sidecar", async () => {
    // Simulate reanchorFile writing the sidecar
    mockReanchorFile.mockResolvedValue({
      results: [],
      changed: 1,
      written: true,
    });

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      "--reanchor",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    const mdPath = path.join(tmpDir, "doc.md");
    const sidecarPath = mdPath + ".review.yaml";

    // Markdown change triggers reanchor → writes sidecar
    await emitChange(mdPath, 120);
    expect(mockReanchorFile).toHaveBeenCalledTimes(1);

    // Clear the validate count so we can track the next call
    const validateCallsBefore = mockValidateFile.mock.calls.length;

    // Now the sidecar changes from the reanchor write — should be suppressed
    await emitChange(sidecarPath, 120);

    // Validate should NOT have been called again for the self-write
    expect(mockValidateFile.mock.calls.length).toBe(validateCallsBefore);

    await mockWatcher.close();
  });
});

describe("watch — no sidecar found", () => {
  it("handles gracefully when markdown has no sidecar", async () => {
    // discoverSidecar succeeds during initial path resolution (setup)
    // but fails when the event handler tries to find the sidecar for a
    // *different* .md file that the watcher picked up.
    let callCount = 0;
    mockDiscoverSidecar.mockImplementation((abs: string) => {
      callCount++;
      if (callCount > 1) {
        return Promise.reject(new Error("No sidecar"));
      }
      return Promise.resolve(abs + ".review.yaml");
    });

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    // A different .md file triggers an event — discoverSidecar will fail
    await emitChange(path.join(tmpDir, "other.md"), 120);

    expect(mockValidateFile).not.toHaveBeenCalled();
    expect(mockReanchorFile).not.toHaveBeenCalled();

    await mockWatcher.close();
  });
});

describe("watch — logging and error paths", () => {
  it("prints startup and verbose reanchor details when not quiet", async () => {
    mockReanchorFile.mockResolvedValue({
      results: [
        {
          commentId: "c-1",
          status: "fuzzy",
          reason: "Fuzzy match",
          score: 0.9123,
          newLine: 2,
        },
      ],
      changed: 1,
      written: true,
    });

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-v",
      "--debounce",
      "50",
      "--reanchor",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));
    await emitChange(path.join(tmpDir, "doc.md"), 120);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Watching");
    expect(output).toContain("score: 0.912");
    expect(output).toContain("reanchor");

    await mockWatcher.close();
  });

  it("prints validation warnings as errors in strict mode", async () => {
    mockValidateFile.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [{ message: "Needs attention", path: "comments[0]" }],
    });

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "--strict",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));
    await emitChange(path.join(tmpDir, "doc.md.review.yaml"), 120);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("ERROR: Needs attention");

    await mockWatcher.close();
  });

  it("logs validate failures", async () => {
    mockValidateFile.mockRejectedValue(new Error("boom"));

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));
    await emitChange(path.join(tmpDir, "doc.md.review.yaml"), 120);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("validate ✗");
    expect(output).toContain("boom");

    await mockWatcher.close();
  });

  it("logs reanchor failures", async () => {
    mockReanchorFile.mockRejectedValue(new Error("bad anchor"));

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      "--reanchor",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));
    await emitChange(path.join(tmpDir, "doc.md"), 120);

    expect(consoleErrorSpy).toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("reanchor ✗");
    expect(output).toContain("bad anchor");

    await mockWatcher.close();
  });
});

describe("watch — signal cleanup", () => {
  it("removes process signal handlers when the watcher closes", async () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const program = makeProgram([]);
    program.parseAsync([
      "node",
      "mrsf",
      "watch",
      "--cwd",
      tmpDir,
      "-q",
      "--debounce",
      "50",
      path.join(tmpDir, "doc.md"),
    ]);

    await new Promise((r) => setTimeout(r, 50));

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    await mockWatcher.close();

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });
});

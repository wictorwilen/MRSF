import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function makeProgram(register: (program: Command) => void): Command {
  const program = new Command();
  program
    .name("mrsf")
    .option("--cwd <dir>", "Working directory")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("-v, --verbose", "Show detailed diagnostic output");
  register(program);
  program.exitOverride();
  return program;
}

async function runCommand(
  register: (program: Command) => void,
  args: string[],
): Promise<void> {
  const program = makeProgram(register);
  await program.parseAsync(["node", "mrsf", ...args]);
}

async function expectExit(
  run: () => Promise<unknown>,
  code = 1,
): Promise<void> {
  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((exitCode?: number) => {
      throw new Error(`process.exit:${exitCode ?? 0}`);
    }) as never);

  try {
    await expect(run()).rejects.toThrow(`process.exit:${code}`);
    expect(exitSpy).toHaveBeenCalledWith(code);
  } finally {
    exitSpy.mockRestore();
  }
}

let tmpDir: string;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrsf-commands-test-"));
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function loadValidateCommand() {
  const resolveSidecarPaths = vi.fn();
  const validateFile = vi.fn();

  vi.doMock("../lib/resolve-files.js", () => ({
    resolveSidecarPaths,
  }));
  vi.doMock("../lib/validator.js", () => ({
    validateFile,
  }));

  const module = await import("../commands/validate.js");
  return { ...module, resolveSidecarPaths, validateFile };
}

async function loadResolveCommand() {
  const parseSidecar = vi.fn();
  const writeSidecar = vi.fn();
  const resolveComment = vi.fn();
  const unresolveComment = vi.fn();

  vi.doMock("../lib/parser.js", () => ({
    parseSidecar,
  }));
  vi.doMock("../lib/writer.js", () => ({
    writeSidecar,
  }));
  vi.doMock("../lib/comments.js", () => ({
    resolveComment,
    unresolveComment,
  }));

  const module = await import("../commands/resolve.js");
  return { ...module, parseSidecar, writeSidecar, resolveComment, unresolveComment };
}

async function loadListCommand() {
  const resolveSidecarPaths = vi.fn();
  const parseSidecar = vi.fn();
  const filterComments = vi.fn();
  const summarize = vi.fn();
  const sidecarToDocument = vi.fn((sidecar: string) =>
    sidecar.replace(/\.review\.(yaml|json)$/u, ""),
  );

  vi.doMock("../lib/resolve-files.js", () => ({
    resolveSidecarPaths,
  }));
  vi.doMock("../lib/parser.js", () => ({
    parseSidecar,
  }));
  vi.doMock("../lib/comments.js", () => ({
    filterComments,
    summarize,
  }));
  vi.doMock("../lib/discovery.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    sidecarToDocument,
  }));

  const module = await import("../commands/list.js");
  return { ...module, resolveSidecarPaths, parseSidecar, filterComments, summarize, sidecarToDocument };
}

async function loadInitCommand() {
  const findWorkspaceRoot = vi.fn();
  const discoverSidecar = vi.fn();
  const writeSidecar = vi.fn();

  vi.doMock("../lib/discovery.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    findWorkspaceRoot,
    discoverSidecar,
  }));
  vi.doMock("../lib/writer.js", () => ({
    writeSidecar,
  }));

  const module = await import("../commands/init.js");
  return { ...module, findWorkspaceRoot, discoverSidecar, writeSidecar };
}

async function loadAddCommand() {
  const findWorkspaceRoot = vi.fn();
  const discoverSidecar = vi.fn();
  const sidecarToDocument = vi.fn();
  const parseSidecar = vi.fn();
  const readDocumentLines = vi.fn();
  const writeSidecar = vi.fn();
  const addComment = vi.fn();
  const populateSelectedText = vi.fn();
  const findRepoRoot = vi.fn();

  vi.doMock("../lib/discovery.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    findWorkspaceRoot,
    discoverSidecar,
    sidecarToDocument,
  }));
  vi.doMock("../lib/parser.js", () => ({
    parseSidecar,
    readDocumentLines,
  }));
  vi.doMock("../lib/writer.js", () => ({
    writeSidecar,
  }));
  vi.doMock("../lib/comments.js", () => ({
    addComment,
    populateSelectedText,
  }));
  vi.doMock("../lib/git.js", () => ({
    findRepoRoot,
  }));

  const module = await import("../commands/add.js");
  return {
    ...module,
    findWorkspaceRoot,
    discoverSidecar,
    parseSidecar,
    readDocumentLines,
    writeSidecar,
    addComment,
    populateSelectedText,
    findRepoRoot,
  };
}

async function loadRenameCommand() {
  const findWorkspaceRoot = vi.fn();
  const discoverSidecar = vi.fn();
  const parseSidecar = vi.fn();
  const writeSidecar = vi.fn();

  vi.doMock("../lib/discovery.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    findWorkspaceRoot,
    discoverSidecar,
  }));
  vi.doMock("../lib/parser.js", () => ({
    parseSidecar,
  }));
  vi.doMock("../lib/writer.js", () => ({
    writeSidecar,
  }));

  const module = await import("../commands/rename.js");
  return { ...module, findWorkspaceRoot, discoverSidecar, parseSidecar, writeSidecar };
}

async function loadReanchorCommand() {
  const discoverAllSidecars = vi.fn();
  const findWorkspaceRoot = vi.fn();
  const sidecarToDocument = vi.fn();
  const parseSidecar = vi.fn();
  const readDocumentLines = vi.fn();
  const resolveSidecarPaths = vi.fn();
  const writeSidecar = vi.fn();
  const findRepoRoot = vi.fn();
  const getStagedFiles = vi.fn();
  const getCurrentCommit = vi.fn();
  const reanchorDocument = vi.fn();
  const applyReanchorResults = vi.fn();

  vi.doMock("../lib/discovery.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    discoverAllSidecars,
    findWorkspaceRoot,
    sidecarToDocument,
  }));
  vi.doMock("../lib/parser.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    parseSidecar,
    readDocumentLines,
  }));
  vi.doMock("../lib/resolve-files.js", () => ({
    resolveSidecarPaths,
  }));
  vi.doMock("../lib/writer.js", () => ({
    writeSidecar,
  }));
  vi.doMock("../lib/git.js", () => ({
    findRepoRoot,
    getStagedFiles,
    getCurrentCommit,
  }));
  vi.doMock("../lib/reanchor.js", () => ({
    reanchorDocument,
    applyReanchorResults,
  }));

  const module = await import("../commands/reanchor.js");
  return {
    ...module,
    resolveSidecarPaths,
    parseSidecar,
    readDocumentLines,
    writeSidecar,
    findRepoRoot,
    getStagedFiles,
    getCurrentCommit,
    sidecarToDocument,
    reanchorDocument,
    applyReanchorResults,
  };
}

async function loadStatusCommand() {
  const sidecarToDocument = vi.fn((sidecar: string) =>
    sidecar.replace(/\.review\.(yaml|json)$/u, ""),
  );
  const parseSidecar = vi.fn();
  const readDocumentLines = vi.fn();
  const resolveSidecarPaths = vi.fn();
  const findRepoRoot = vi.fn();
  const getCurrentCommit = vi.fn();
  const isStale = vi.fn();
  const exactMatch = vi.fn();

  vi.doMock("../lib/discovery.js", async (importOriginal) => ({
    ...((await importOriginal()) as object),
    sidecarToDocument,
  }));
  vi.doMock("../lib/parser.js", () => ({
    parseSidecar,
    readDocumentLines,
  }));
  vi.doMock("../lib/resolve-files.js", () => ({
    resolveSidecarPaths,
  }));
  vi.doMock("../lib/git.js", () => ({
    findRepoRoot,
    getCurrentCommit,
    isStale,
  }));
  vi.doMock("../lib/fuzzy.js", () => ({
    exactMatch,
  }));

  const module = await import("../commands/status.js");
  return {
    ...module,
    resolveSidecarPaths,
    parseSidecar,
    readDocumentLines,
    findRepoRoot,
    isStale,
    exactMatch,
  };
}

describe("validate command", () => {
  it("reports when no sidecars are found", async () => {
    const { registerValidate, resolveSidecarPaths } = await loadValidateCommand();
    resolveSidecarPaths.mockResolvedValue([]);

    await runCommand(registerValidate, ["--cwd", tmpDir, "validate"]);

    expect(consoleLogSpy).toHaveBeenCalledWith("No sidecar files found.");
  });

  it("treats warnings as errors in strict mode", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const { registerValidate, resolveSidecarPaths, validateFile } = await loadValidateCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    validateFile.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [{ message: "Missing selected text", path: "comments[0]" }],
    });

    await expectExit(() =>
      runCommand(registerValidate, ["--cwd", tmpDir, "validate", "--strict"]),
    );

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain(sidecarPath);
    expect(output).toContain("ERROR: Missing selected text (comments[0])");
  });
});

describe("resolve command", () => {
  it("unresolves a comment and writes the sidecar", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const doc = { comments: [{ id: "c-1" }] };
    const { registerResolve, parseSidecar, writeSidecar, unresolveComment } =
      await loadResolveCommand();

    parseSidecar.mockResolvedValue(doc);
    unresolveComment.mockReturnValue(true);

    await runCommand(registerResolve, [
      "--cwd",
      tmpDir,
      "resolve",
      "doc.md.review.yaml",
      "c-1",
      "--undo",
    ]);

    expect(parseSidecar).toHaveBeenCalledWith(sidecarPath);
    expect(unresolveComment).toHaveBeenCalledWith(doc, "c-1");
    expect(writeSidecar).toHaveBeenCalledWith(sidecarPath, doc);
  });

  it("exits when the comment id is missing", async () => {
    const { registerResolve, parseSidecar, resolveComment, writeSidecar } =
      await loadResolveCommand();
    parseSidecar.mockResolvedValue({ comments: [] });
    resolveComment.mockReturnValue(false);

    await expectExit(() =>
      runCommand(registerResolve, ["--cwd", tmpDir, "resolve", "doc.review.yaml", "missing"]),
    );

    expect(writeSidecar).not.toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Comment missing not found");
  });
});

describe("list command", () => {
  it("prints filtered comments in human-readable mode", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const { registerList, resolveSidecarPaths, parseSidecar, filterComments } =
      await loadListCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue({ comments: [{ id: "c-1" }] });
    filterComments.mockReturnValue([
      {
        id: "c-1",
        author: "Ada",
        text: "Tighten this section",
        line: 4,
        severity: "high",
        type: "issue",
        reply_to: "c-0",
        resolved: false,
      },
    ]);

    await runCommand(registerList, ["--cwd", tmpDir, "list"]);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("c-1");
    expect(output).toContain("Ada: Tighten this section");
    expect(output).toContain("reply to c-0");
    expect(output).toContain("1 comment(s).");
  });

  it("prints JSON summaries and logs parse failures", async () => {
    const goodSidecar = path.join(tmpDir, "good.md.review.yaml");
    const badSidecar = path.join(tmpDir, "bad.md.review.yaml");
    const { registerList, resolveSidecarPaths, parseSidecar, filterComments, summarize } =
      await loadListCommand();

    resolveSidecarPaths.mockResolvedValue([goodSidecar, badSidecar]);
    parseSidecar
      .mockResolvedValueOnce({ comments: [{ id: "c-1" }] })
      .mockRejectedValueOnce(new Error("parse failed"));
    filterComments.mockReturnValue([{ id: "c-1" }]);
    summarize.mockReturnValue({
      total: 1,
      open: 1,
      resolved: 0,
      orphaned: 0,
      threads: 1,
      byType: { issue: 1 },
      bySeverity: { high: 1 },
    });

    await runCommand(registerList, ["--cwd", tmpDir, "list", "--summary", "--json"]);

    expect(consoleErrorSpy.mock.calls.flat().join("\n")).toContain("parse failed");
    expect(consoleLogSpy.mock.calls.flat().join("\n")).toContain('"total": 1');
  });

  it("prints human-readable summaries including type and severity buckets", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const { registerList, resolveSidecarPaths, parseSidecar, filterComments, summarize } =
      await loadListCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue({ comments: [{ id: "c-1" }] });
    filterComments.mockReturnValue([{ id: "c-1" }]);
    summarize.mockReturnValue({
      total: 3,
      open: 2,
      resolved: 1,
      orphaned: 0,
      threads: 2,
      byType: { issue: 2, suggestion: 1 },
      bySeverity: { high: 1, medium: 2 },
    });

    await runCommand(registerList, ["--cwd", tmpDir, "list", "--summary"]);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Total: 3  Open: 2  Resolved: 1  Orphaned: 0  Threads: 2");
    expect(output).toContain("By type: issue(2), suggestion(1)");
    expect(output).toContain("By severity: high(1), medium(2)");
  });

  it("prints a message when filters remove all comments", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const { registerList, resolveSidecarPaths, parseSidecar, filterComments } =
      await loadListCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue({ comments: [{ id: "c-1" }] });
    filterComments.mockReturnValue([]);

    await runCommand(registerList, ["--cwd", tmpDir, "list", "--author", "Nobody"]);

    expect(consoleLogSpy.mock.calls.flat().join("\n")).toContain("No matching comments.");
  });
});

describe("init command", () => {
  it("creates a new sidecar for an existing document", async () => {
    const documentPath = path.join(tmpDir, "guide.md");
    const sidecarPath = path.join(tmpDir, "guide.md.review.yaml");
    const { registerInit, findWorkspaceRoot, discoverSidecar, writeSidecar } =
      await loadInitCommand();

    await fs.writeFile(documentPath, "# Guide\n");
    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockResolvedValue(sidecarPath);

    await runCommand(registerInit, ["--cwd", tmpDir, "init", "guide.md"]);

    expect(writeSidecar).toHaveBeenCalledWith(
      sidecarPath,
      expect.objectContaining({
        mrsf_version: "1.0",
        document: "guide.md",
        comments: [],
      }),
    );
  });

  it("exits when the target sidecar already exists without force", async () => {
    const documentPath = path.join(tmpDir, "guide.md");
    const sidecarPath = path.join(tmpDir, "guide.md.review.yaml");
    const { registerInit, findWorkspaceRoot, discoverSidecar, writeSidecar } =
      await loadInitCommand();

    await fs.writeFile(documentPath, "# Guide\n");
    await fs.writeFile(sidecarPath, "mrsf_version: \"1.0\"\n");
    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockResolvedValue(sidecarPath);

    await expectExit(() =>
      runCommand(registerInit, ["--cwd", tmpDir, "init", "guide.md"]),
    );

    expect(writeSidecar).not.toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls.flat().join("\n")).toContain("Use --force to overwrite.");
  });
});

describe("add command", () => {
  it("passes parsed fields and extensions to addComment", async () => {
    const sidecarPath = path.join(tmpDir, "guide.md.review.yaml");
    const doc = { mrsf_version: "1.0", document: "guide.md", comments: [] as unknown[] };
    const { registerAdd, findWorkspaceRoot, discoverSidecar, parseSidecar, addComment, writeSidecar, findRepoRoot } =
      await loadAddCommand();

    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockResolvedValue(sidecarPath);
    parseSidecar.mockResolvedValue(doc);
    findRepoRoot.mockResolvedValue(path.join(tmpDir, ".git"));
    addComment.mockImplementation(async (currentDoc, input) => {
      const comment = { id: "c-1", line: input.line };
      currentDoc.comments.push(comment);
      return comment;
    });

    await runCommand(registerAdd, [
      "--cwd",
      tmpDir,
      "add",
      "guide.md",
      "--author",
      "Ada",
      "--text",
      "Fix this",
      "--line",
      "3",
      "--end-line",
      "4",
      "--start-column",
      "1",
      "--end-column",
      "9",
      "--type",
      "issue",
      "--severity",
      "high",
      "--reply-to",
      "c-0",
      "--selected-text",
      "selected",
      "--ext",
      "x_flag=true",
      "--ext",
      "x_count=2",
      "--ext",
      'x_meta={"ok":true}',
    ]);

    expect(addComment).toHaveBeenCalledWith(
      doc,
      expect.objectContaining({
        author: "Ada",
        text: "Fix this",
        line: 3,
        end_line: 4,
        start_column: 1,
        end_column: 9,
        type: "issue",
        severity: "high",
        reply_to: "c-0",
      }),
      path.join(tmpDir, ".git"),
    );
    expect(addComment.mock.calls[0][1].extensions).toEqual({
      x_flag: true,
      x_count: 2,
      x_meta: { ok: true },
    });
    expect(writeSidecar).toHaveBeenCalledWith(sidecarPath, doc);
  });

  it("creates a new sidecar document and auto-populates selected text", async () => {
    const documentPath = path.join(tmpDir, "new.md");
    const sidecarPath = path.join(tmpDir, "new.md.review.yaml");
    const { registerAdd, findWorkspaceRoot, discoverSidecar, parseSidecar, readDocumentLines, addComment, populateSelectedText, writeSidecar, findRepoRoot } =
      await loadAddCommand();

    await fs.writeFile(documentPath, "alpha\nbeta\n");
    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockResolvedValue(sidecarPath);
    parseSidecar.mockRejectedValue(new Error("missing"));
    findRepoRoot.mockResolvedValue(null);
    readDocumentLines.mockResolvedValue(["alpha", "beta"]);
    addComment.mockResolvedValue({ id: "c-2", line: 2 });
    populateSelectedText.mockImplementation((comment) => {
      comment.selected_text = "beta";
    });

    await runCommand(registerAdd, [
      "--cwd",
      tmpDir,
      "add",
      "new.md",
      "--author",
      "Ada",
      "--text",
      "Add note",
      "--line",
      "2",
    ]);

    expect(populateSelectedText).toHaveBeenCalled();
    expect(writeSidecar).toHaveBeenCalledWith(
      sidecarPath,
      expect.objectContaining({
        document: "new.md",
        comments: [],
      }),
    );
  });

  it("rejects malformed extension flags", async () => {
    const sidecarPath = path.join(tmpDir, "guide.md.review.yaml");
    const { registerAdd, findWorkspaceRoot, discoverSidecar, parseSidecar, addComment } =
      await loadAddCommand();

    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockResolvedValue(sidecarPath);
    parseSidecar.mockResolvedValue({ mrsf_version: "1.0", document: "guide.md", comments: [] });

    await expect(
      runCommand(registerAdd, [
        "--cwd",
        tmpDir,
        "add",
        "guide.md",
        "--author",
        "Ada",
        "--text",
        "Bad ext",
        "--ext",
        "broken",
      ]),
    ).rejects.toThrow("Invalid --ext value 'broken'. Expected key=value.");

    expect(addComment).not.toHaveBeenCalled();
  });
});

describe("rename command", () => {
  it("writes the new sidecar path and removes the old one", async () => {
    const oldDoc = path.join(tmpDir, "docs", "old.md");
    const newDoc = path.join(tmpDir, "guides", "new.md");
    const oldSidecar = path.join(tmpDir, "docs", "old.md.review.yaml");
    const newSidecar = path.join(tmpDir, "guides", "new.md.review.yaml");
    const { registerRename, findWorkspaceRoot, discoverSidecar, parseSidecar, writeSidecar } =
      await loadRenameCommand();

    await fs.mkdir(path.dirname(oldSidecar), { recursive: true });
    await fs.writeFile(oldSidecar, "mrsf_version: \"1.0\"\n");

    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockImplementation(async (documentPath: string) =>
      documentPath === oldDoc ? oldSidecar : newSidecar,
    );
    parseSidecar.mockResolvedValue({ document: "old.md", comments: [{ id: "c-1" }] });

    await runCommand(registerRename, [
      "--cwd",
      tmpDir,
      "rename",
      path.relative(tmpDir, oldDoc),
      path.relative(tmpDir, newDoc),
      "--verbose",
    ]);

    expect(writeSidecar).toHaveBeenCalledWith(
      newSidecar,
      expect.objectContaining({ document: "new.md" }),
    );
    await expect(fs.access(oldSidecar)).rejects.toThrow();
  });

  it("exits when the original sidecar cannot be parsed", async () => {
    const oldDoc = path.join(tmpDir, "docs", "old.md");
    const oldSidecar = path.join(tmpDir, "docs", "old.md.review.yaml");
    const { registerRename, findWorkspaceRoot, discoverSidecar, parseSidecar, writeSidecar } =
      await loadRenameCommand();

    findWorkspaceRoot.mockResolvedValue(tmpDir);
    discoverSidecar.mockResolvedValue(oldSidecar);
    parseSidecar.mockRejectedValue(new Error("missing"));

    await expectExit(() =>
      runCommand(registerRename, ["--cwd", tmpDir, "rename", path.relative(tmpDir, oldDoc), "new.md"]),
    );

    expect(writeSidecar).not.toHaveBeenCalled();
  });
});

describe("reanchor command", () => {
  it("reports when no sidecars are resolved", async () => {
    const { registerReanchor, resolveSidecarPaths } = await loadReanchorCommand();
    resolveSidecarPaths.mockResolvedValue([]);

    await runCommand(registerReanchor, ["--cwd", tmpDir, "reanchor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith("No sidecar files found.");
  });

  it("exits in staged mode outside a git repository", async () => {
    const { registerReanchor, findRepoRoot } = await loadReanchorCommand();
    findRepoRoot.mockResolvedValue(null);

    await expectExit(() =>
      runCommand(registerReanchor, ["--cwd", tmpDir, "reanchor", "--staged"]),
    );

    expect(consoleErrorSpy.mock.calls.flat().join("\n")).toContain("Not in a git repository.");
  });

  it("writes changed sidecars and exits when orphaned comments remain", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const docPath = path.join(tmpDir, "doc.md");
    const doc = { comments: [{ id: "c-1" }] };
    const { registerReanchor, resolveSidecarPaths, parseSidecar, readDocumentLines, findRepoRoot, getCurrentCommit, sidecarToDocument, reanchorDocument, applyReanchorResults, writeSidecar } =
      await loadReanchorCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue(doc);
    readDocumentLines.mockResolvedValue(["alpha"]);
    findRepoRoot.mockResolvedValue(tmpDir);
    getCurrentCommit.mockResolvedValue("HEAD");
    sidecarToDocument.mockReturnValue(docPath);
    reanchorDocument.mockResolvedValue([
      { commentId: "c-1", status: "orphaned", reason: "No match" },
    ]);
    applyReanchorResults.mockReturnValue(1);

    await expectExit(() =>
      runCommand(registerReanchor, ["--cwd", tmpDir, "reanchor"]),
    );

    expect(writeSidecar).toHaveBeenCalledWith(sidecarPath, doc);
  });

  it("supports dry-run mode without writing files", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const docPath = path.join(tmpDir, "doc.md");
    const doc = { comments: [{ id: "c-1" }] };
    const { registerReanchor, resolveSidecarPaths, parseSidecar, readDocumentLines, findRepoRoot, getCurrentCommit, sidecarToDocument, reanchorDocument, applyReanchorResults, writeSidecar } =
      await loadReanchorCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue(doc);
    readDocumentLines.mockResolvedValue(["alpha"]);
    findRepoRoot.mockResolvedValue(tmpDir);
    getCurrentCommit.mockResolvedValue("HEAD");
    sidecarToDocument.mockReturnValue(docPath);
    reanchorDocument.mockResolvedValue([
      { commentId: "c-1", status: "anchored", reason: "Matched", newLine: 1 },
    ]);
    applyReanchorResults.mockReturnValue(1);

    await runCommand(registerReanchor, ["--cwd", tmpDir, "reanchor", "--dry-run"]);

    expect(writeSidecar).not.toHaveBeenCalled();
  });

  it("handles staged mode, skips missing staged sidecars, and prints verbose dry-run details", async () => {
    const stagedSidecar = path.join(tmpDir, "tracked.md.review.yaml");
    const docPath = path.join(tmpDir, "tracked.md");
    const doc = { comments: [{ id: "c-1" }] };
    const { registerReanchor, parseSidecar, readDocumentLines, findRepoRoot, getStagedFiles, getCurrentCommit, sidecarToDocument, reanchorDocument, applyReanchorResults, writeSidecar } =
      await loadReanchorCommand();

    findRepoRoot.mockResolvedValue(tmpDir);
    getStagedFiles.mockResolvedValue(["tracked.md", "missing.md"]);
    parseSidecar.mockImplementation(async (sidecarPath: string) => {
      if (sidecarPath === path.join(tmpDir, "missing.md.review.yaml")) {
        throw new Error("not found");
      }
      return doc;
    });
    readDocumentLines.mockResolvedValue(["alpha"]);
    getCurrentCommit.mockResolvedValue("HEAD");
    sidecarToDocument.mockReturnValue(docPath);
    reanchorDocument.mockResolvedValue([
      {
        commentId: "c-1",
        status: "fuzzy",
        reason: "Close match",
        newLine: 5,
        score: 0.9,
      },
    ]);
    applyReanchorResults.mockReturnValue(1);

    await runCommand(registerReanchor, [
      "--cwd",
      tmpDir,
      "-v",
      "reanchor",
      "--staged",
      "--dry-run",
    ]);

    expect(writeSidecar).not.toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("threshold: 0.6");
    expect(output).toContain("mode: dry-run");
    expect(output).toContain(stagedSidecar);
    expect(output).toContain("new line: 5");
    expect(output).toContain("score: 0.900");
    expect(output).toContain("status: fuzzy");
    expect(output).toContain("1 comment(s) would change, 0 orphaned.");
  });

  it("logs per-sidecar processing errors and continues", async () => {
    const badSidecar = path.join(tmpDir, "bad.md.review.yaml");
    const goodSidecar = path.join(tmpDir, "good.md.review.yaml");
    const goodDocPath = path.join(tmpDir, "good.md");
    const { registerReanchor, resolveSidecarPaths, parseSidecar, readDocumentLines, findRepoRoot, getCurrentCommit, sidecarToDocument, reanchorDocument, applyReanchorResults } =
      await loadReanchorCommand();

    resolveSidecarPaths.mockResolvedValue([badSidecar, goodSidecar]);
    parseSidecar.mockImplementation(async (sidecarPath: string) => {
      if (sidecarPath === badSidecar) {
        throw new Error("bad sidecar");
      }
      return { comments: [{ id: "c-2" }] };
    });
    readDocumentLines.mockResolvedValue(["beta"]);
    findRepoRoot.mockResolvedValue(tmpDir);
    getCurrentCommit.mockResolvedValue("HEAD");
    sidecarToDocument.mockReturnValue(goodDocPath);
    reanchorDocument.mockResolvedValue([
      { commentId: "c-2", status: "anchored", reason: "Exact match", newLine: 2 },
    ]);
    applyReanchorResults.mockReturnValue(0);

    await runCommand(registerReanchor, ["--cwd", tmpDir, "reanchor"]);

    expect(consoleErrorSpy.mock.calls.flat().join("\n")).toContain("bad sidecar");
    expect(consoleLogSpy.mock.calls.flat().join("\n")).toContain("0 comment(s) changed, 0 orphaned.");
  });
});

describe("status command", () => {
  it("reports when no sidecars are found", async () => {
    const { registerStatus, resolveSidecarPaths } = await loadStatusCommand();
    resolveSidecarPaths.mockResolvedValue([]);

    await runCommand(registerStatus, ["--cwd", tmpDir, "status"]);

    expect(consoleLogSpy).toHaveBeenCalledWith("No sidecar files found.");
  });

  it("prints JSON health states across multiple comment conditions", async () => {
    const sidecarPath = path.join(tmpDir, "doc.md.review.yaml");
    const { registerStatus, resolveSidecarPaths, parseSidecar, readDocumentLines, findRepoRoot, exactMatch, isStale } =
      await loadStatusCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue({
      comments: [
        { id: "orphaned", x_reanchor_status: "orphaned" },
        { id: "stale", selected_text: "gone", commit: "abc" },
        { id: "fresh", selected_text: "kept", commit: "def" },
        { id: "unknown" },
      ],
    });
    readDocumentLines.mockResolvedValue(["kept"]);
    findRepoRoot.mockResolvedValue(tmpDir);
    exactMatch.mockImplementation((_lines: string[], selectedText: string) =>
      selectedText === "kept" ? [{ line: 1 }] : [],
    );
    isStale.mockImplementation(async (commit: string) => commit === "abc");

    await runCommand(registerStatus, ["--cwd", tmpDir, "status", "--json"]);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain('"commentId": "orphaned"');
    expect(output).toContain('"health": "stale"');
    expect(output).toContain('"health": "fresh"');
    expect(output).toContain('"health": "unknown"');
  });

  it("marks comments unknown when the document file is missing", async () => {
    const sidecarPath = path.join(tmpDir, "missing.md.review.yaml");
    const { registerStatus, resolveSidecarPaths, parseSidecar, readDocumentLines, findRepoRoot } =
      await loadStatusCommand();

    resolveSidecarPaths.mockResolvedValue([sidecarPath]);
    parseSidecar.mockResolvedValue({
      comments: [{ id: "c-1" }, { id: "c-2" }],
    });
    readDocumentLines.mockRejectedValue(new Error("missing file"));
    findRepoRoot.mockResolvedValue(tmpDir);

    await runCommand(registerStatus, ["--cwd", tmpDir, "status"]);

    const output = consoleLogSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Document file not found.");
    expect(output).toContain("2 comment(s): 0 fresh, 0 stale, 0 orphaned, 2 unknown");
  });
});
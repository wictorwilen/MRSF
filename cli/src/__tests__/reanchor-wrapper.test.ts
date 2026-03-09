import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindRepoRoot = vi.fn();
const mockGetCurrentCommit = vi.fn();
const mockGetDiff = vi.fn();
const mockIsGitAvailable = vi.fn();

const mockApplyReanchorResults = vi.fn();
const mockReanchorComment = vi.fn();
const mockReanchorDocumentLines = vi.fn();

const mockReadDocumentLines = vi.fn();
const mockParseSidecar = vi.fn();
const mockWriteSidecar = vi.fn();
const mockSidecarToDocument = vi.fn();

vi.mock("../lib/git.js", () => ({
  findRepoRoot: (...args: unknown[]) => mockFindRepoRoot(...args),
  getCurrentCommit: (...args: unknown[]) => mockGetCurrentCommit(...args),
  getDiff: (...args: unknown[]) => mockGetDiff(...args),
  getFileAtCommit: vi.fn(),
  getLineShift: vi.fn(),
  isGitAvailable: (...args: unknown[]) => mockIsGitAvailable(...args),
  parseDiffHunks: vi.fn(),
}));

vi.mock("../lib/reanchor-core.js", () => ({
  DEFAULT_THRESHOLD: 0.6,
  HIGH_THRESHOLD: 0.8,
  applyReanchorResults: (...args: unknown[]) => mockApplyReanchorResults(...args),
  reanchorComment: (...args: unknown[]) => mockReanchorComment(...args),
  reanchorDocumentLines: (...args: unknown[]) => mockReanchorDocumentLines(...args),
  reanchorDocumentText: vi.fn(),
  toReanchorLines: vi.fn(),
}));

vi.mock("../lib/parser.js", () => ({
  readDocumentLines: (...args: unknown[]) => mockReadDocumentLines(...args),
  parseSidecar: (...args: unknown[]) => mockParseSidecar(...args),
}));

vi.mock("../lib/discovery.js", () => ({
  discoverSidecar: vi.fn(),
  sidecarToDocument: (...args: unknown[]) => mockSidecarToDocument(...args),
}));

vi.mock("../lib/writer.js", () => ({
  writeSidecar: (...args: unknown[]) => mockWriteSidecar(...args),
}));

import { reanchorDocument, reanchorFile } from "../lib/reanchor.js";

function makeComment(id: string, commit?: string) {
  return {
    id,
    author: "tester",
    timestamp: "2025-01-01T00:00:00Z",
    text: "Fix this",
    resolved: false,
    line: 1,
    selected_text: `${id} text`,
    commit,
  };
}

describe("reanchorDocument wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGitAvailable.mockResolvedValue(true);
    mockFindRepoRoot.mockResolvedValue("/repo");
    mockGetCurrentCommit.mockResolvedValue("head-commit");
    mockGetDiff.mockResolvedValue([{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, lines: ["+added"] }]);
    mockReanchorComment.mockImplementation((comment, _lines, options) => ({
      commentId: comment.id,
      status: options.commitIsStale ? "shifted" : "anchored",
      newLine: options.commitIsStale ? 2 : 1,
      score: options.commitIsStale ? 1 : 0.9,
      reason: options.commitIsStale ? "Shifted via diff" : "Fresh",
    }));
    mockReanchorDocumentLines.mockReturnValue([]);
  });

  it("uses diff-based reanchoring for stale comments and normal reanchoring for fresh ones", async () => {
    const doc = {
      mrsf_version: "1.0",
      document: "docs/doc.md",
      comments: [makeComment("stale", "old-commit"), makeComment("fresh", "head-commit")],
    };
    const lines = ["", "line one"];

    const results = await reanchorDocument(doc, lines, {
      cwd: "/repo",
      documentPath: "/repo/docs/doc.md",
      repoRoot: "/repo",
    });

    expect(mockGetDiff).toHaveBeenCalledWith("old-commit", "head-commit", "docs/doc.md", "/repo");
    expect(mockReanchorComment).toHaveBeenNthCalledWith(
      1,
      doc.comments[0],
      lines,
      expect.objectContaining({
        diffHunks: expect.any(Array),
        threshold: 0.6,
        commitIsStale: true,
      }),
    );
    expect(mockReanchorComment).toHaveBeenNthCalledWith(
      2,
      doc.comments[1],
      lines,
      expect.objectContaining({
        threshold: 0.6,
        commitIsStale: false,
      }),
    );
    expect(results.map((result) => result.commentId)).toEqual(["stale", "fresh"]);
  });

  it("uses fromCommit as the shared stale baseline when provided", async () => {
    const doc = {
      mrsf_version: "1.0",
      document: "docs/doc.md",
      comments: [makeComment("comment", "head-commit")],
    };

    await reanchorDocument(doc, ["", "line one"], {
      cwd: "/repo",
      documentPath: "/repo/docs/doc.md",
      repoRoot: "/repo",
      fromCommit: "base-commit",
    });

    expect(mockGetDiff).toHaveBeenCalledWith("base-commit", "head-commit", "docs/doc.md", "/repo");
    expect(mockReanchorComment).toHaveBeenCalledWith(
      doc.comments[0],
      ["", "line one"],
      expect.objectContaining({ commitIsStale: true }),
    );
  });

  it("falls back to plain document reanchoring when git is available but documentPath is missing", async () => {
    const doc = {
      mrsf_version: "1.0",
      document: "docs/doc.md",
      comments: [makeComment("comment", "old-commit")],
    };
    mockReanchorDocumentLines.mockReturnValue([
      {
        commentId: "comment",
        status: "anchored",
        score: 1,
        newLine: 1,
        reason: "Exact match",
      },
    ]);

    const results = await reanchorDocument(doc, ["", "line one"], {
      cwd: "/repo",
      repoRoot: "/repo",
    });

    expect(mockGetDiff).not.toHaveBeenCalled();
    expect(mockReanchorComment).not.toHaveBeenCalled();
    expect(mockReanchorDocumentLines).toHaveBeenCalledWith(doc, ["", "line one"], {
      threshold: 0.6,
    });
    expect(results).toHaveLength(1);
    expect(results[0].commentId).toBe("comment");
  });
});

describe("reanchorFile wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSidecarToDocument.mockReturnValue("/tmp/doc.md");
    mockParseSidecar.mockResolvedValue({
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [makeComment("comment")],
    });
    mockReadDocumentLines.mockResolvedValue(["", "doc line"]);
    mockIsGitAvailable.mockResolvedValue(false);
    mockFindRepoRoot.mockResolvedValue(null);
    mockGetCurrentCommit.mockResolvedValue(undefined);
    mockReanchorDocumentLines.mockReturnValue([
      {
        commentId: "comment",
        status: "anchored",
        newLine: 1,
        score: 1,
        reason: "Exact match",
      },
    ]);
    mockApplyReanchorResults.mockReturnValue(0);
    mockWriteSidecar.mockResolvedValue(undefined);
  });

  it("writes the sidecar when autoUpdate is true even if no positions changed", async () => {
    const doc = {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [makeComment("comment")],
    };
    mockParseSidecar.mockResolvedValue(doc);

    const result = await reanchorFile("/tmp/doc.md.review.yaml", {
      noGit: true,
      autoUpdate: true,
    });

    expect(mockApplyReanchorResults).toHaveBeenCalledWith(
      doc,
      expect.any(Array),
      expect.objectContaining({ headCommit: undefined }),
    );
    expect(mockWriteSidecar).toHaveBeenCalledWith("/tmp/doc.md.review.yaml", doc);
    expect(result.changed).toBe(0);
    expect(result.written).toBe(true);
  });

  it("skips apply/write work in dry-run mode", async () => {
    const result = await reanchorFile("/tmp/doc.md.review.yaml", {
      noGit: true,
      dryRun: true,
    });

    expect(mockApplyReanchorResults).not.toHaveBeenCalled();
    expect(mockWriteSidecar).not.toHaveBeenCalled();
    expect(result.written).toBe(false);
  });

  it("passes the git head commit into applyReanchorResults when available", async () => {
    const doc = {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [makeComment("comment", "old-commit")],
    };
    mockParseSidecar.mockResolvedValue(doc);
    mockIsGitAvailable.mockResolvedValue(false);
    mockFindRepoRoot.mockResolvedValue("/repo");
    mockGetCurrentCommit.mockResolvedValue("head-commit");
    mockApplyReanchorResults.mockReturnValue(1);

    const result = await reanchorFile("/tmp/doc.md.review.yaml", {});

    expect(mockApplyReanchorResults).toHaveBeenCalledWith(
      doc,
      expect.any(Array),
      expect.objectContaining({ headCommit: "head-commit" }),
    );
    expect(result.changed).toBe(1);
    expect(result.written).toBe(true);
  });
});
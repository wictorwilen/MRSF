import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, Uri, workspace } from "vscode";

const mockApplyLineShifts = vi.fn();
const mockDiscoverSidecar = vi.fn();
const mockParseSidecar = vi.fn();
const mockReadDocumentLines = vi.fn();
const mockWriteSidecar = vi.fn();
const mockAddComment = vi.fn();
const mockPopulateSelectedText = vi.fn();
const mockResolveComment = vi.fn();
const mockUnresolveComment = vi.fn();
const mockRemoveComment = vi.fn();
const mockFilterComments = vi.fn();
const mockGetThreads = vi.fn();
const mockSummarize = vi.fn();
const mockReanchorDocument = vi.fn();
const mockApplyReanchorResults = vi.fn();
const mockFindWorkspaceRoot = vi.fn();
const mockFindRepoRoot = vi.fn();
const mockGetCurrentCommit = vi.fn();
const mockIsStale = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("@mrsf/monaco-mrsf/browser", () => ({
  applyLineShifts: (...args: unknown[]) => mockApplyLineShifts(...args),
}));

vi.mock("@mrsf/cli", () => ({
  discoverSidecar: (...args: unknown[]) => mockDiscoverSidecar(...args),
  parseSidecar: (...args: unknown[]) => mockParseSidecar(...args),
  readDocumentLines: (...args: unknown[]) => mockReadDocumentLines(...args),
  writeSidecar: (...args: unknown[]) => mockWriteSidecar(...args),
  addComment: (...args: unknown[]) => mockAddComment(...args),
  populateSelectedText: (...args: unknown[]) => mockPopulateSelectedText(...args),
  resolveComment: (...args: unknown[]) => mockResolveComment(...args),
  unresolveComment: (...args: unknown[]) => mockUnresolveComment(...args),
  removeComment: (...args: unknown[]) => mockRemoveComment(...args),
  filterComments: (...args: unknown[]) => mockFilterComments(...args),
  getThreads: (...args: unknown[]) => mockGetThreads(...args),
  summarize: (...args: unknown[]) => mockSummarize(...args),
  reanchorDocument: (...args: unknown[]) => mockReanchorDocument(...args),
  applyReanchorResults: (...args: unknown[]) => mockApplyReanchorResults(...args),
  findWorkspaceRoot: (...args: unknown[]) => mockFindWorkspaceRoot(...args),
  findRepoRoot: (...args: unknown[]) => mockFindRepoRoot(...args),
  getCurrentCommit: (...args: unknown[]) => mockGetCurrentCommit(...args),
  isStale: (...args: unknown[]) => mockIsStale(...args),
}));

import { SidecarStore } from "../../store/SidecarStore.js";

describe("SidecarStore", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    workspace.workspaceFolders = [{ uri: Uri.file("/workspace") }];
    mockFindWorkspaceRoot.mockReturnValue("/workspace");
    mockFindRepoRoot.mockResolvedValue("/repo");
    mockDiscoverSidecar.mockImplementation((docPath: string) => Promise.resolve(`${docPath}.review.yaml`));
    mockParseSidecar.mockResolvedValue({
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [{ id: "c1", commit: "old-head" }],
    });
    mockReadDocumentLines.mockResolvedValue(["", "one", "two"]);
    mockWriteSidecar.mockResolvedValue(undefined);
    mockAddComment.mockResolvedValue({ id: "c-new", line: 2, text: "hi" });
    mockApplyLineShifts.mockReturnValue(true);
    mockResolveComment.mockReturnValue(true);
    mockUnresolveComment.mockReturnValue(true);
    mockRemoveComment.mockReturnValue(true);
    mockFilterComments.mockImplementation((comments: unknown[]) => comments);
    mockGetThreads.mockReturnValue(new Map());
    mockSummarize.mockReturnValue({ total: 1 });
    mockReanchorDocument.mockResolvedValue([{ commentId: "c1", status: "shifted", score: 1 }]);
    mockApplyReanchorResults.mockReturnValue(0);
    mockGetCurrentCommit.mockResolvedValue("new-head");
    mockIsStale.mockResolvedValue(true);
  });

  it("loads and caches sidecars", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");

    const doc = await store.load(uri);

    expect(mockDiscoverSidecar).toHaveBeenCalledWith("/workspace/doc.md", { cwd: "/workspace" });
    expect(doc?.document).toBe("doc.md");
    expect(store.get(uri)).toBe(doc);
    expect(store.getSidecarPath(uri)).toBe("/workspace/doc.md.review.yaml");
  });

  it("creates a new sidecar entry when adding the first comment", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");

    const comment = await store.addComment(uri, { text: "hello", author: "tester", line: 2 });

    expect(comment.id).toBe("c-new");
    expect(mockAddComment).toHaveBeenCalled();
    expect(mockPopulateSelectedText).toHaveBeenCalledWith(comment, ["", "one", "two"]);
    expect(mockWriteSidecar).toHaveBeenCalled();
  });

  it("marks documents dirty when live edits shift comments", () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    (store as any).cache.set(uri.fsPath, {
      doc: { comments: [{ id: "c1" }] },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    });

    const moved = store.applyLiveEdits(uri, [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, text: "abc" }] as never);

    expect(moved).toBe(true);
    expect(mockApplyLineShifts).toHaveBeenCalled();
    expect(store.hasPendingShifts(uri)).toBe(true);
  });

  it("reanchors comments and saves commit updates even when positions do not change", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    const entry = {
      doc: {
        mrsf_version: "1.0",
        document: "doc.md",
        comments: [{ id: "c1", commit: "old-head" }],
      },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    };
    (store as any).cache.set(uri.fsPath, entry);

    const changed = await store.applyReanchors(uri, [{ commentId: "c1", status: "anchored", score: 1 }] as never);

    expect(changed).toBe(0);
    expect(entry.doc.comments[0].commit).toBe("new-head");
    expect(mockWriteSidecar).toHaveBeenCalledWith(entry.sidecarPath, entry.doc);
  });

  it("counts stale comments against the repo head", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    (store as any).cache.set(uri.fsPath, {
      doc: {
        comments: [
          { id: "c1", commit: "a" },
          { id: "c2", commit: "b" },
          { id: "c3" },
        ],
      },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    });
    mockIsStale.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const staleCount = await store.checkStaleness(uri);

    expect(staleCount).toBe(1);
    expect(mockIsStale).toHaveBeenCalledTimes(2);
  });

  it("saves tracked sidecars and clears own-save markers after the timeout", async () => {
    vi.useFakeTimers();
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    (store as any).cache.set(uri.fsPath, {
      doc: { comments: [] },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    });

    await store.save(uri);

    expect(store.isSaving("/workspace/doc.md.review.yaml")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(store.isSaving("/workspace/doc.md.review.yaml")).toBe(false);
    vi.useRealTimers();
  });

  it("invalidates cache entries by document uri and sidecar path", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");

    await store.load(uri);
    expect(store.get(uri)).not.toBeNull();

    store.invalidate(uri);
    expect(store.get(uri)).toBeNull();

    await store.load(uri);
    store.invalidateBySidecarPath("/workspace/doc.md.review.yaml");
    expect(store.get(uri)).toBeNull();
  });

  it("reloads from disk and clears pending live-edit shifts", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    (store as any)._pendingShifts.add(uri.fsPath);

    await store.reloadFromDisk(uri);

    expect(mockParseSidecar).toHaveBeenCalledWith("/workspace/doc.md.review.yaml");
    expect(store.hasPendingShifts(uri)).toBe(false);
  });

  it("prefers the active markdown editor and falls back to visible and open documents", async () => {
    const store = new SidecarStore();
    const activeUri = Uri.file("/workspace/active.md");
    const visibleUri = Uri.file("/workspace/visible.md");
    const openUri = Uri.file("/workspace/open.md");

    __mock.emitActiveTextEditor({
      document: { uri: activeUri, languageId: "markdown", lineCount: 1, lineAt: () => ({ text: "" }) },
      selection: { isEmpty: true },
      setDecorations: vi.fn(),
      revealRange: vi.fn(),
    } as never);
    await store.load(activeUri);

    expect(await store.getForActiveEditor()).toEqual(expect.objectContaining({ uri: activeUri }));
    expect(await store.getForActiveOrVisible()).toEqual(expect.objectContaining({ uri: activeUri }));

    __mock.emitActiveTextEditor(undefined);
    __mock.emitVisibleTextEditors([
      {
        document: { uri: visibleUri, languageId: "markdown", lineCount: 1, lineAt: () => ({ text: "" }) },
        selection: { isEmpty: true },
        setDecorations: vi.fn(),
        revealRange: vi.fn(),
      } as never,
    ]);
    await store.load(visibleUri);

    expect(await store.getForActiveOrVisible()).toEqual(expect.objectContaining({ uri: visibleUri }));

    __mock.emitVisibleTextEditors([]);
    workspace.textDocuments = [{ uri: openUri, languageId: "markdown" } as never];
    await store.load(openUri);

    expect(await store.getForActiveOrVisible()).toEqual(expect.objectContaining({ uri: openUri }));
    expect(await store.getForActiveOrVisible(openUri)).toEqual(expect.objectContaining({ uri: openUri }));
  });

  it("delegates resolve, unresolve, delete, and reply mutations through the CLI helpers", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    (store as any).cache.set(uri.fsPath, {
      doc: { comments: [{ id: "c1" }] },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    });

    const resolved = await store.resolveComment(uri, "c1", true);
    const unresolved = await store.unresolveComment(uri, "c1");
    const deleted = await store.deleteComment(uri, "c1", true);
    await store.replyToComment(uri, "c1", "reply", "tester");

    expect(resolved).toBe(true);
    expect(unresolved).toBe(true);
    expect(deleted).toBe(true);
    expect(mockResolveComment).toHaveBeenCalledWith(expect.any(Object), "c1", true);
    expect(mockUnresolveComment).toHaveBeenCalledWith(expect.any(Object), "c1");
    expect(mockRemoveComment).toHaveBeenCalledWith(expect.any(Object), "c1", { cascade: true });
    expect(mockAddComment).toHaveBeenCalledWith(expect.any(Object), {
      text: "reply",
      author: "tester",
      reply_to: "c1",
    }, "/repo");
  });

  it("exposes comment queries through the shared CLI utilities", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    const comments = [{ id: "c1", text: "one" }, { id: "c2", text: "two" }];
    const threads = new Map([["c1", comments]]);
    const summary = { total: 2, open: 1 };
    mockFilterComments.mockReturnValue([comments[0]]);
    mockGetThreads.mockReturnValue(threads);
    mockSummarize.mockReturnValue(summary);
    (store as any).cache.set(uri.fsPath, {
      doc: { comments },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    });

    expect(store.getComments(uri)).toBe(comments);
    expect(store.getComments(uri, { resolved: false } as never)).toEqual([comments[0]]);
    expect(store.getCommentThreads(uri)).toBe(threads);
    expect(store.getSummary(uri)).toBe(summary);
    expect(store.findComment(uri, "c2")).toEqual(comments[1]);
  });

  it("returns null or empty results when discovery or lookup cannot find a sidecar", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/missing.md");
    mockDiscoverSidecar.mockResolvedValueOnce("/workspace/missing.md.review.yaml");
    mockParseSidecar.mockRejectedValueOnce(new Error("bad file"));

    await expect(store.load(uri)).resolves.toBeNull();
    expect(store.get(uri)).toBeNull();
    expect(store.getSidecarPath(uri)).toBeNull();
    expect(store.getComments(uri)).toEqual([]);
    expect(store.getCommentThreads(uri)).toEqual(new Map());
    expect(store.getSummary(uri)).toBeNull();
    expect(store.findComment(uri, "missing")).toBeUndefined();
    expect(await store.reanchorComments(uri)).toEqual([]);
  });

  it("passes document context into CLI reanchor calls", async () => {
    const store = new SidecarStore();
    const uri = Uri.file("/workspace/doc.md");
    (store as any).cache.set(uri.fsPath, {
      doc: { comments: [{ id: "c1" }] },
      sidecarPath: "/workspace/doc.md.review.yaml",
      documentPath: uri.fsPath,
    });

    const results = await store.reanchorComments(uri, { threshold: 0.9 } as never);

    expect(results).toEqual([{ commentId: "c1", status: "shifted", score: 1 }]);
    expect(mockReadDocumentLines).toHaveBeenCalledWith(uri.fsPath);
    expect(mockReanchorDocument).toHaveBeenCalledWith(expect.any(Object), ["", "one", "two"], expect.objectContaining({
      threshold: 0.9,
      documentPath: uri.fsPath,
      repoRoot: "/repo",
    }));
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, Uri } from "vscode";

const mockSidecarToDocument = vi.fn();

vi.mock("@mrsf/cli", () => ({
  sidecarToDocument: (...args: unknown[]) => mockSidecarToDocument(...args),
}));

import { FileWatcher } from "../../store/FileWatcher.js";

describe("FileWatcher", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    mockSidecarToDocument.mockReturnValue("/tmp/doc.md");
  });

  it("reloads the document when a sidecar changes externally", async () => {
    const store = {
      isSaving: vi.fn().mockReturnValue(false),
      load: vi.fn(),
      invalidateBySidecarPath: vi.fn(),
      invalidate: vi.fn(),
    };

    new FileWatcher(store as never);

    __mock.fileWatchers[0].fireChange(Uri.file("/tmp/doc.md.review.yaml"));

    expect(store.load).toHaveBeenCalledWith(Uri.file("/tmp/doc.md"));
  });

  it("skips reloads for sidecars being saved by the extension", () => {
    const store = {
      isSaving: vi.fn().mockReturnValue(true),
      load: vi.fn(),
      invalidateBySidecarPath: vi.fn(),
      invalidate: vi.fn(),
    };

    new FileWatcher(store as never);

    __mock.fileWatchers[0].fireCreate(Uri.file("/tmp/doc.md.review.yaml"));

    expect(store.load).not.toHaveBeenCalled();
  });

  it("invalidates by sidecar path and markdown uri on delete", () => {
    const store = {
      isSaving: vi.fn().mockReturnValue(false),
      load: vi.fn(),
      invalidateBySidecarPath: vi.fn(),
      invalidate: vi.fn(),
    };

    new FileWatcher(store as never);

    __mock.fileWatchers[0].fireDelete(Uri.file("/tmp/doc.md.review.yaml"));
    __mock.fileWatchers[1].fireDelete(Uri.file("/tmp/doc.md"));

    expect(store.invalidateBySidecarPath).toHaveBeenCalledWith("/tmp/doc.md.review.yaml");
    expect(store.invalidate).toHaveBeenCalledWith(Uri.file("/tmp/doc.md"));
  });
});
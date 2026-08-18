import { beforeEach, describe, expect, it, vi } from "vitest";
import { __mock, Uri } from "vscode";

const mockFindRepoRoot = vi.fn();
const mockGetGitUserName = vi.fn();

vi.mock("@mrsf/cli", () => ({
  findRepoRoot: (...args: unknown[]) => mockFindRepoRoot(...args),
  getGitUserName: (...args: unknown[]) => mockGetGitUserName(...args),
}));

import { clearAuthorCache, resolveAuthor } from "../../util/author.js";

describe("resolveAuthor", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    clearAuthorCache();
  });

  it("prefers the configured author override", async () => {
    __mock.configuration.set("sidemark.author", "Configured Author");

    expect(await resolveAuthor(Uri.file("/workspace/doc.md"))).toBe(
      "Configured Author",
    );
    expect(mockFindRepoRoot).not.toHaveBeenCalled();
  });

  it("uses repository-local Git identity when no override is configured", async () => {
    mockFindRepoRoot.mockResolvedValue("/workspace");
    mockGetGitUserName.mockResolvedValue("Repository Author");

    expect(await resolveAuthor(Uri.file("/workspace/docs/doc.md"))).toBe(
      "Repository Author",
    );
    expect(mockFindRepoRoot).toHaveBeenCalledWith("/workspace/docs");
    expect(mockGetGitUserName).toHaveBeenCalledWith("/workspace");
    expect(__mock.configuration.has("sidemark.author")).toBe(false);
  });

  it("caches Git identity lookups for repeated document checks", async () => {
    mockFindRepoRoot.mockResolvedValue("/workspace");
    mockGetGitUserName.mockResolvedValue("Repository Author");
    const documentUri = Uri.file("/workspace/docs/doc.md");

    await expect(resolveAuthor(documentUri, false)).resolves.toBe("Repository Author");
    await expect(resolveAuthor(documentUri, false)).resolves.toBe("Repository Author");

    expect(mockFindRepoRoot).toHaveBeenCalledTimes(1);
    expect(mockGetGitUserName).toHaveBeenCalledTimes(1);
  });

  it("prompts without creating a global override when repository identity is unavailable", async () => {
    mockFindRepoRoot.mockResolvedValue("/workspace");
    mockGetGitUserName.mockResolvedValue(null);
    __mock.inputBoxResults.push("Prompted Author");

    expect(await resolveAuthor(Uri.file("/workspace/doc.md"))).toBe(
      "Prompted Author",
    );
    expect(__mock.configuration.has("sidemark.author")).toBe(false);
  });

  it("does not prompt when used for passive ownership checks", async () => {
    mockFindRepoRoot.mockResolvedValue(null);

    expect(await resolveAuthor(Uri.file("/workspace/doc.md"), false)).toBeUndefined();
    expect(__mock.configuration.has("sidemark.author")).toBe(false);
  });
});

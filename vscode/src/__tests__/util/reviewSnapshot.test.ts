import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProjectDecorationSnapshot = vi.fn();

vi.mock("@mrsf/monaco-mrsf/browser", () => ({
  projectDecorationSnapshot: (...args: unknown[]) => mockProjectDecorationSnapshot(...args),
}));

import { buildReviewSnapshot, toCommentMap } from "../../util/reviewSnapshot.js";

describe("reviewSnapshot utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a projected snapshot using document geometry", () => {
    mockProjectDecorationSnapshot.mockReturnValue({ threads: [] });

    const document = {
      lineCount: 2,
      lineAt: (line: number) => ({ text: ["alpha", "beta gamma"][line] ?? "" }),
    } as never;
    const review = {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [{ id: "c1" }],
    } as never;

    const snapshot = buildReviewSnapshot(document, review, true);

    expect(snapshot).toEqual({ threads: [] });
    expect(mockProjectDecorationSnapshot).toHaveBeenCalledWith(review, {
      showResolved: true,
      geometry: expect.objectContaining({
        lineCount: 2,
        getLineLength: expect.any(Function),
      }),
    });
  });

  it("maps comments by id", () => {
    const review = {
      comments: [
        { id: "c1", text: "one" },
        { id: "c2", text: "two" },
      ],
    } as never;

    const map = toCommentMap(review);

    expect(map.get("c1")?.text).toBe("one");
    expect(map.get("c2")?.text).toBe("two");
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { __mock, Position, Range, Uri } from "vscode";

const mockEditorRangeToVscodeRange = vi.fn();
const mockRelativeTime = vi.fn();
const mockBuildReviewSnapshot = vi.fn();
const mockToCommentMap = vi.fn();

vi.mock("../../util/positions.js", () => ({
  editorRangeToVscodeRange: (...args: unknown[]) => mockEditorRangeToVscodeRange(...args),
  relativeTime: (...args: unknown[]) => mockRelativeTime(...args),
}));

vi.mock("../../util/reviewSnapshot.js", () => ({
  buildReviewSnapshot: (...args: unknown[]) => mockBuildReviewSnapshot(...args),
  toCommentMap: (...args: unknown[]) => mockToCommentMap(...args),
}));

import { MrsfHoverProvider } from "../../providers/HoverProvider.js";

describe("MrsfHoverProvider", () => {
  beforeEach(() => {
    __mock.reset();
    vi.clearAllMocks();
    __mock.configuration.set("sidemark.showResolved", true);
    mockRelativeTime.mockReturnValue("5m ago");
  });

  it("registers a markdown hover provider on construction", () => {
    const store = { get: vi.fn() };

    new MrsfHoverProvider(store as never);

    expect(__mock.hoverRegistrations).toHaveLength(1);
    expect(__mock.hoverRegistrations[0]?.selector).toEqual({ language: "markdown" });
  });

  it("returns null when there is no sidecar or no matching hover thread", () => {
    const uri = Uri.file("/workspace/doc.md");
    const document = { uri };
    const store = { get: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce({ comments: [] }) };
    mockBuildReviewSnapshot.mockReturnValue({ threadsByLine: [] });
    mockToCommentMap.mockReturnValue(new Map());

    const provider = new MrsfHoverProvider(store as never);

    expect(provider.provideHover(document as never, new Position(0, 0), {} as never)).toBeNull();
    expect(provider.provideHover(document as never, new Position(0, 0), {} as never)).toBeNull();
  });

  it("renders matching root comments and replies into a trusted markdown hover", () => {
    const uri = Uri.file("/workspace/doc.md");
    const root = {
      id: "c1",
      author: "A_User",
      text: "Root [comment]",
      timestamp: "2026-03-09T11:55:00Z",
      type: "issue",
      severity: "high",
      resolved: false,
    };
    const reply = {
      id: "c2",
      reply_to: "c1",
      author: "Reply_User",
      text: "Reply text",
      timestamp: "2026-03-09T11:57:00Z",
      resolved: false,
    };
    const document = { uri };
    const store = { get: vi.fn().mockReturnValue({ comments: [root, reply] }) };
    mockBuildReviewSnapshot.mockReturnValue({
      threadsByLine: [
        {
          line: 2,
          threads: [
            {
              rootCommentId: "c1",
              range: { start: { lineIndex: 1, column: 0 }, end: { lineIndex: 1, column: 10 } },
            },
          ],
        },
      ],
    });
    mockToCommentMap.mockReturnValue(new Map([["c1", root]]));
    mockEditorRangeToVscodeRange.mockReturnValue(new Range(1, 0, 1, 10));

    const provider = new MrsfHoverProvider(store as never);
    const hover = provider.provideHover(document as never, new Position(1, 5), {} as never);

    expect(mockBuildReviewSnapshot).toHaveBeenCalledWith(document, { comments: [root, reply] }, true);
    expect(hover).toBeInstanceOf(vscode.Hover);
    expect(hover?.contents.isTrusted).toBe(true);
    expect(hover?.contents.supportHtml).toBe(true);
    expect(hover?.contents.value).toContain("**A\\_User** · 5m ago `issue` `high`");
    expect(hover?.contents.value).toContain("Root \\\[comment\\\]");
    expect(hover?.contents.value).toContain("**Reply\\_User** · 5m ago");
    expect(hover?.contents.value).toContain("command:mrsf.resolveComment");
    expect(hover?.contents.value).toContain("command:mrsf.replyToComment");
    expect(hover?.contents.value).toContain("command:mrsf.deleteComment");
  });

  it("filters out threads whose range does not contain the hover position and renders unresolve for resolved roots", () => {
    const uri = Uri.file("/workspace/doc.md");
    const root = {
      id: "c1",
      author: "Alice",
      text: "Resolved root",
      timestamp: "2026-03-09T11:55:00Z",
      resolved: true,
    };
    const document = { uri };
    const store = { get: vi.fn().mockReturnValue({ comments: [root] }) };
    __mock.configuration.set("sidemark.showResolved", false);
    mockBuildReviewSnapshot.mockReturnValue({
      threadsByLine: [
        {
          line: 3,
          threads: [
            { rootCommentId: "c1", range: { start: { lineIndex: 2, column: 0 }, end: { lineIndex: 2, column: 2 } } },
          ],
        },
      ],
    });
    mockToCommentMap.mockReturnValue(new Map([["c1", root]]));
    mockEditorRangeToVscodeRange.mockReturnValue(new Range(2, 0, 2, 2));

    const provider = new MrsfHoverProvider(store as never);
    const outside = provider.provideHover(document as never, new Position(2, 5), {} as never);
    const inside = provider.provideHover(document as never, new Position(2, 1), {} as never);

    expect(outside).toBeNull();
    expect(mockBuildReviewSnapshot).toHaveBeenCalledWith(document, { comments: [root] }, false);
    expect(inside?.contents.value).toContain("command:mrsf.unresolveComment");
  });

  it("disposes the hover registration", () => {
    const store = { get: vi.fn() };
    const provider = new MrsfHoverProvider(store as never);
    const disposeSpy = vi.spyOn((provider as any).registration, "dispose");

    provider.dispose();

    expect(disposeSpy).toHaveBeenCalled();
  });
});
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Comment, MrsfDocument } from "@mrsf/cli/browser";
import {
  addComment,
  populateSelectedText,
  removeComment,
  resolveComment,
  setSelectedText,
  unresolveComment,
} from "../core/browserComments.js";

function makeDocument(comments: Comment[] = []): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "doc.md",
    comments,
  };
}

describe("browserComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds comments and prefers crypto.randomUUID when available", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "uuid-123"),
    });

    const document = makeDocument();
    const comment = await addComment(document, {
      author: "A",
      text: "Root",
      line: 2,
      start_column: 1,
      end_column: 4,
      severity: "high",
      type: "issue",
    });

    expect(comment.id).toBe("uuid-123");
    expect(comment.line).toBe(2);
    expect(comment.severity).toBe("high");
    expect(document.comments).toContain(comment);
  });

  it("sets selected text hashes when subtle crypto is available", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async () => new Uint8Array([0, 15, 255]).buffer),
      },
    });

    const comment = {
      id: "c1",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Comment",
      resolved: false,
    } satisfies Comment;

    await setSelectedText(comment, "alpha");
    expect(comment.selected_text).toBe("alpha");
    expect(comment.selected_text_hash).toBe("000fff");

    comment.selected_text = undefined;
    await setSelectedText(comment, "beta");
    expect(comment.selected_text_hash).toBe("000fff");
  });

  it("populates selected text for single-line and multi-line anchors and ignores invalid ranges", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
      },
    });

    const singleLine = {
      id: "c1",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Comment",
      resolved: false,
      line: 1,
      start_column: 1,
      end_column: 4,
    } satisfies Comment;

    await populateSelectedText(singleLine, ["alpha", "beta", "gamma"]);
    expect(singleLine.selected_text).toBe("lph");
    expect(singleLine.selected_text_hash).toBe("010203");

    const multiLine = {
      id: "c2",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Comment",
      resolved: false,
      line: 1,
      end_line: 2,
      start_column: 2,
      end_column: 2,
    } satisfies Comment;

    await populateSelectedText(multiLine, ["alpha", "beta", "gamma"]);
    expect(multiLine.selected_text).toBe("pha\nbe");

    const invalid = {
      id: "c3",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Comment",
      resolved: false,
      line: 8,
    } satisfies Comment;

    await populateSelectedText(invalid, ["alpha"]);
    expect(invalid.selected_text).toBeUndefined();

    const preset = {
      id: "c4",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Comment",
      resolved: false,
      line: 1,
      selected_text: "keep me",
    } satisfies Comment;

    await populateSelectedText(preset, ["alpha"]);
    expect(preset.selected_text).toBe("keep me");
  });

  it("resolves, unreolves, and removes comments while reparanting replies", () => {
    const root = {
      id: "root",
      author: "A",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Root",
      resolved: false,
      line: 2,
      start_column: 1,
      end_column: 5,
      selected_text: "beta",
      selected_text_hash: "hash",
      anchored_text: "beta",
      commit: "abc123",
    } satisfies Comment;
    const reply = {
      id: "reply",
      author: "B",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Reply",
      resolved: false,
      reply_to: "root",
    } satisfies Comment;
    const nested = {
      id: "nested",
      author: "C",
      timestamp: "2025-01-01T00:00:00.000Z",
      text: "Nested",
      resolved: false,
      reply_to: "reply",
    } satisfies Comment;
    const document = makeDocument([root, reply, nested]);

    expect(resolveComment(document, "root")).toBe(true);
    expect(root.resolved).toBe(true);
    expect(unresolveComment(document, "root")).toBe(true);
    expect(root.resolved).toBe(false);
    expect(resolveComment(document, "missing")).toBe(false);
    expect(unresolveComment(document, "missing")).toBe(false);

    expect(removeComment(document, "reply")).toBe(true);
    expect(document.comments.map((comment) => comment.id)).toEqual(["root", "nested"]);
    expect(nested.reply_to).toBe("root");
    expect(removeComment(document, "root")).toBe(true);
    expect(nested.reply_to).toBeUndefined();
    expect(nested.line).toBe(2);
    expect(nested.selected_text).toBe("beta");
    expect(removeComment(document, "missing")).toBe(false);
  });
});
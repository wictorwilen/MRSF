/**
 * Tests for comments CRUD module.
 */

import { describe, it, expect } from "vitest";
import {
  addComment,
  resolveComment,
  unresolveComment,
  removeComment,
  filterComments,
  getThreads,
  summarize,
  populateSelectedText,
} from "../lib/comments.js";
import type { Comment, MrsfDocument } from "../lib/types.js";

function makeDoc(): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "test.md",
    comments: [],
  };
}

describe("addComment", () => {
  it("adds a comment with auto-generated id and timestamp", async () => {
    const doc = makeDoc();
    const c = await addComment(doc, { author: "Alice", text: "Fix this" });
    expect(doc.comments).toHaveLength(1);
    expect(c.id).toBeTruthy();
    expect(c.author).toBe("Alice");
    expect(c.text).toBe("Fix this");
    expect(c.resolved).toBe(false);
    expect(c.timestamp).toBeTruthy();
  });

  it("respects explicit id and timestamp", async () => {
    const doc = makeDoc();
    const c = await addComment(doc, {
      author: "Bob",
      text: "Note",
      id: "my-id",
      timestamp: "2025-01-01T00:00:00Z",
    });
    expect(c.id).toBe("my-id");
    expect(c.timestamp).toBe("2025-01-01T00:00:00Z");
  });

  it("includes optional fields when provided", async () => {
    const doc = makeDoc();
    const c = await addComment(doc, {
      author: "Carol",
      text: "Suggestion",
      line: 10,
      end_line: 12,
      type: "suggestion",
      severity: "medium",
    });
    expect(c.line).toBe(10);
    expect(c.end_line).toBe(12);
    expect(c.type).toBe("suggestion");
    expect(c.severity).toBe("medium");
  });
});

describe("resolveComment", () => {
  it("resolves a comment by ID", () => {
    const doc = makeDoc();
    doc.comments.push({
      id: "c-1",
      author: "A",
      timestamp: "",
      text: "x",
      resolved: false,
    });
    expect(resolveComment(doc, "c-1")).toBe(true);
    expect(doc.comments[0].resolved).toBe(true);
  });

  it("returns false for unknown ID", () => {
    const doc = makeDoc();
    expect(resolveComment(doc, "missing")).toBe(false);
  });

  it("does not cascade by default (§9)", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "c-1", author: "A", timestamp: "", text: "x", resolved: false },
      {
        id: "c-2",
        author: "B",
        timestamp: "",
        text: "reply",
        resolved: false,
        reply_to: "c-1",
      },
    );
    resolveComment(doc, "c-1", false);
    expect(doc.comments[0].resolved).toBe(true);
    expect(doc.comments[1].resolved).toBe(false);
  });

  it("cascades when requested", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "c-1", author: "A", timestamp: "", text: "x", resolved: false },
      {
        id: "c-2",
        author: "B",
        timestamp: "",
        text: "reply",
        resolved: false,
        reply_to: "c-1",
      },
    );
    resolveComment(doc, "c-1", true);
    expect(doc.comments[0].resolved).toBe(true);
    expect(doc.comments[1].resolved).toBe(true);
  });
});

describe("unresolveComment", () => {
  it("unresolves a comment", () => {
    const doc = makeDoc();
    doc.comments.push({
      id: "c-1",
      author: "A",
      timestamp: "",
      text: "x",
      resolved: true,
    });
    expect(unresolveComment(doc, "c-1")).toBe(true);
    expect(doc.comments[0].resolved).toBe(false);
  });
});

describe("removeComment", () => {
  it("removes a comment by ID", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "c-1", author: "A", timestamp: "", text: "a", resolved: false },
      { id: "c-2", author: "B", timestamp: "", text: "b", resolved: false },
    );
    expect(removeComment(doc, "c-1")).toBe(true);
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0].id).toBe("c-2");
  });

  it("promotes direct replies by inheriting parent anchor (§9.1)", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "p1", author: "A", timestamp: "", text: "parent", resolved: false, line: 10, end_line: 12, selected_text: "hello world" },
      { id: "r1", author: "B", timestamp: "", text: "reply", resolved: false, reply_to: "p1" },
    );
    expect(removeComment(doc, "p1")).toBe(true);
    expect(doc.comments).toHaveLength(1);
    const reply = doc.comments[0];
    expect(reply.id).toBe("r1");
    // Reply inherits parent anchor fields
    expect(reply.line).toBe(10);
    expect(reply.end_line).toBe(12);
    expect(reply.selected_text).toBe("hello world");
    // reply_to cleared (parent was root)
    expect(reply.reply_to).toBeUndefined();
  });

  it("preserves reply's own anchor fields when present", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "p1", author: "A", timestamp: "", text: "parent", resolved: false, line: 10, selected_text: "parent text" },
      { id: "r1", author: "B", timestamp: "", text: "reply", resolved: false, reply_to: "p1", line: 20, selected_text: "reply text" },
    );
    removeComment(doc, "p1");
    const reply = doc.comments[0];
    expect(reply.line).toBe(20);
    expect(reply.selected_text).toBe("reply text");
  });

  it("re-points reply_to to grandparent when parent is a reply itself", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "root", author: "A", timestamp: "", text: "root", resolved: false, line: 1 },
      { id: "mid", author: "B", timestamp: "", text: "mid", resolved: false, reply_to: "root", line: 5 },
      { id: "leaf", author: "C", timestamp: "", text: "leaf", resolved: false, reply_to: "mid" },
    );
    removeComment(doc, "mid");
    expect(doc.comments).toHaveLength(2);
    const leaf = doc.comments.find((c) => c.id === "leaf")!;
    expect(leaf.reply_to).toBe("root");
    expect(leaf.line).toBe(5); // inherited from mid
  });

  it("cascade removes direct replies along with parent", () => {
    const doc = makeDoc();
    doc.comments.push(
      { id: "p1", author: "A", timestamp: "", text: "parent", resolved: false, line: 10 },
      { id: "r1", author: "B", timestamp: "", text: "reply1", resolved: false, reply_to: "p1" },
      { id: "r2", author: "C", timestamp: "", text: "reply2", resolved: false, reply_to: "p1" },
      { id: "other", author: "D", timestamp: "", text: "other", resolved: false },
    );
    removeComment(doc, "p1", { cascade: true });
    expect(doc.comments).toHaveLength(1);
    expect(doc.comments[0].id).toBe("other");
  });

  it("returns false for non-existent comment", () => {
    const doc = makeDoc();
    expect(removeComment(doc, "nope")).toBe(false);
  });
});

describe("filterComments", () => {
  const comments: Comment[] = [
    { id: "1", author: "Alice", timestamp: "", text: "a", resolved: false, type: "issue", severity: "high" },
    { id: "2", author: "Bob", timestamp: "", text: "b", resolved: true, type: "suggestion" },
    { id: "3", author: "Alice", timestamp: "", text: "c", resolved: false },
  ];

  it("filters by open", () => {
    const result = filterComments(comments, { open: true });
    expect(result).toHaveLength(2);
  });

  it("filters by resolved", () => {
    const result = filterComments(comments, { resolved: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("filters by author", () => {
    const result = filterComments(comments, { author: "Alice" });
    expect(result).toHaveLength(2);
  });

  it("combines filters", () => {
    const result = filterComments(comments, { open: true, author: "Alice" });
    expect(result).toHaveLength(2);
  });
});

describe("getThreads", () => {
  it("groups replies under roots", () => {
    const comments: Comment[] = [
      { id: "root", author: "A", timestamp: "", text: "root", resolved: false },
      { id: "r1", author: "B", timestamp: "", text: "reply 1", resolved: false, reply_to: "root" },
      { id: "r2", author: "C", timestamp: "", text: "reply 2", resolved: false, reply_to: "root" },
      { id: "standalone", author: "D", timestamp: "", text: "solo", resolved: false },
    ];

    const threads = getThreads(comments);
    expect(threads.size).toBe(2);
    expect(threads.get("root")?.length).toBe(3); // root + 2 replies
    expect(threads.get("standalone")?.length).toBe(1);
  });
});

describe("summarize", () => {
  it("produces correct summary", () => {
    const comments: Comment[] = [
      { id: "1", author: "A", timestamp: "", text: "a", resolved: false, type: "issue", severity: "high" },
      { id: "2", author: "B", timestamp: "", text: "b", resolved: true, type: "suggestion" },
      { id: "3", author: "A", timestamp: "", text: "c", resolved: false, reply_to: "1" },
    ];

    const s = summarize(comments);
    expect(s.total).toBe(3);
    expect(s.open).toBe(2);
    expect(s.resolved).toBe(1);
    expect(s.threads).toBe(2); // "1" and "2" are roots
    expect(s.byType).toEqual({ issue: 1, suggestion: 1 });
    expect(s.bySeverity).toEqual({ high: 1 });
  });
});

describe("populateSelectedText", () => {
  it("sets selected_text from document lines", () => {
    const comment: Comment = {
      id: "c-1",
      author: "A",
      timestamp: "",
      text: "x",
      resolved: false,
      line: 2,
    };
    const lines = ["first line", "second line", "third line"];
    populateSelectedText(comment, lines);
    expect(comment.selected_text).toBe("second line");
    expect(comment.selected_text_hash).toBeTruthy();
  });

  it("handles column ranges", () => {
    const comment: Comment = {
      id: "c-1",
      author: "A",
      timestamp: "",
      text: "x",
      resolved: false,
      line: 1,
      start_column: 6,
      end_column: 10,
    };
    const lines = ["Hello World"];
    populateSelectedText(comment, lines);
    expect(comment.selected_text).toBe("Worl");
  });
});

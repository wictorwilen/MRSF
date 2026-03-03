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

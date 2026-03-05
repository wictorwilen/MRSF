import { describe, it, expect } from "vitest";
import { toSlimComments, groupByLine, resolveComments } from "../comments.js";
import type { SlimComment, CommentThread, LineMap } from "../types.js";

// ── Helpers ──────────────────────────────────────────────

/** Minimal MrsfDocument shape for testing. */
function makeDoc(comments: Record<string, unknown>[] = []) {
  return {
    mrsf_version: "1.0",
    document: "test.md",
    comments: comments as any[],
  };
}

function makeRawComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    author: "Alice",
    text: "Hello",
    line: 5,
    ...overrides,
  };
}

// ── toSlimComments ───────────────────────────────────────

describe("toSlimComments", () => {
  it("converts a basic comment", () => {
    const doc = makeDoc([makeRawComment()]);
    const result = toSlimComments(doc as any);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
    expect(result[0].author).toBe("Alice");
    expect(result[0].text).toBe("Hello");
    expect(result[0].line).toBe(5);
  });

  it("defaults missing fields to null/false", () => {
    const doc = makeDoc([{ id: "c1", author: "A", text: "B", line: 1 }]);
    const result = toSlimComments(doc as any);
    const c = result[0];
    expect(c.end_line).toBeNull();
    expect(c.start_column).toBeNull();
    expect(c.end_column).toBeNull();
    expect(c.selected_text).toBeNull();
    expect(c.resolved).toBe(false);
    expect(c.reply_to).toBeNull();
    expect(c.severity).toBeNull();
    expect(c.type).toBeNull();
    expect(c.timestamp).toBeNull();
  });

  it("maps all optional fields when present", () => {
    const doc = makeDoc([
      makeRawComment({
        end_line: 10,
        start_column: 2,
        end_column: 15,
        selected_text: "selected",
        resolved: true,
        reply_to: "parent",
        severity: "high",
        type: "issue",
        timestamp: "2026-01-01T00:00:00Z",
      }),
    ]);
    const result = toSlimComments(doc as any);
    const c = result[0];
    expect(c.end_line).toBe(10);
    expect(c.start_column).toBe(2);
    expect(c.end_column).toBe(15);
    expect(c.selected_text).toBe("selected");
    expect(c.resolved).toBe(true);
    expect(c.reply_to).toBe("parent");
    expect(c.severity).toBe("high");
    expect(c.type).toBe("issue");
    expect(c.timestamp).toBe("2026-01-01T00:00:00Z");
  });

  it("converts author default for empty/missing author", () => {
    const doc = makeDoc([{ id: "c1", author: "", text: "x", line: 1 }]);
    const result = toSlimComments(doc as any);
    expect(result[0].author).toBe("Unknown");
  });

  it("converts empty array", () => {
    expect(toSlimComments(makeDoc([]) as any)).toEqual([]);
  });

  it("handles multiple comments", () => {
    const doc = makeDoc([
      makeRawComment({ id: "c1", line: 1 }),
      makeRawComment({ id: "c2", line: 5 }),
      makeRawComment({ id: "c3", line: 10 }),
    ]);
    const result = toSlimComments(doc as any);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });
});

// ── groupByLine ──────────────────────────────────────────

describe("groupByLine", () => {
  function slim(overrides: Partial<SlimComment> = {}): SlimComment {
    return {
      id: "c1",
      author: "Alice",
      text: "Hello",
      line: 5,
      end_line: null,
      start_column: null,
      end_column: null,
      selected_text: null,
      resolved: false,
      reply_to: null,
      severity: null,
      type: null,
      timestamp: null,
      ...overrides,
    };
  }

  it("groups single root comment by line", () => {
    const map = groupByLine([slim()]);
    expect(map.size).toBe(1);
    expect(map.get(5)).toBeDefined();
    expect(map.get(5)![0].comment.id).toBe("c1");
  });

  it("groups multiple comments on same line", () => {
    const map = groupByLine([
      slim({ id: "c1", line: 5 }),
      slim({ id: "c2", line: 5 }),
    ]);
    expect(map.get(5)!.length).toBe(2);
  });

  it("groups comments on different lines", () => {
    const map = groupByLine([
      slim({ id: "c1", line: 3 }),
      slim({ id: "c2", line: 7 }),
    ]);
    expect(map.size).toBe(2);
    expect(map.get(3)![0].comment.id).toBe("c1");
    expect(map.get(7)![0].comment.id).toBe("c2");
  });

  it("threads replies under parent", () => {
    const map = groupByLine([
      slim({ id: "c1", line: 5 }),
      slim({ id: "r1", reply_to: "c1", line: null }),
    ]);
    const thread = map.get(5)![0];
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0].id).toBe("r1");
  });

  it("threads multiple replies under correct parent", () => {
    const map = groupByLine([
      slim({ id: "c1", line: 5 }),
      slim({ id: "c2", line: 10 }),
      slim({ id: "r1", reply_to: "c1", line: null }),
      slim({ id: "r2", reply_to: "c1", line: null }),
      slim({ id: "r3", reply_to: "c2", line: null }),
    ]);
    expect(map.get(5)![0].replies).toHaveLength(2);
    expect(map.get(10)![0].replies).toHaveLength(1);
  });

  it("ignores comments with null line (replies only)", () => {
    const map = groupByLine([
      slim({ id: "r1", reply_to: "c1", line: null }),
    ]);
    expect(map.size).toBe(0);
  });

  it("returns empty map for empty input", () => {
    expect(groupByLine([]).size).toBe(0);
  });

  it("orphan replies (no matching parent) are silently dropped from threads", () => {
    const map = groupByLine([
      slim({ id: "c1", line: 5 }),
      slim({ id: "r-orphan", reply_to: "nonexistent", line: null }),
    ]);
    const thread = map.get(5)![0];
    expect(thread.replies).toHaveLength(0);
  });
});

// ── resolveComments ──────────────────────────────────────

describe("resolveComments", () => {
  function slim(overrides: Partial<SlimComment> = {}): SlimComment {
    return {
      id: "c1",
      author: "Alice",
      text: "Hello",
      line: 5,
      end_line: null,
      start_column: null,
      end_column: null,
      selected_text: null,
      resolved: false,
      reply_to: null,
      severity: null,
      type: null,
      timestamp: null,
      ...overrides,
    };
  }

  it("returns null when loader returns null", () => {
    const result = resolveComments(() => null, {});
    expect(result).toBeNull();
  });

  it("returns null for empty comment array", () => {
    const result = resolveComments(() => makeDoc([]) as any, {});
    expect(result).toBeNull();
  });

  it("returns lineMap and comments for valid data", () => {
    const loader = () => makeDoc([makeRawComment()]) as any;
    const result = resolveComments(loader, {});
    expect(result).not.toBeNull();
    expect(result!.lineMap.size).toBe(1);
    expect(result!.comments).toHaveLength(1);
  });

  it("filters resolved comments when showResolved is false", () => {
    const loader = () =>
      makeDoc([
        makeRawComment({ id: "c1", resolved: false }),
        makeRawComment({ id: "c2", resolved: true }),
      ]) as any;
    const result = resolveComments(loader, { showResolved: false });
    expect(result!.comments).toHaveLength(1);
    expect(result!.comments[0].id).toBe("c1");
  });

  it("keeps resolved comments when showResolved is true", () => {
    const loader = () =>
      makeDoc([
        makeRawComment({ id: "c1", resolved: false }),
        makeRawComment({ id: "c2", resolved: true }),
      ]) as any;
    const result = resolveComments(loader, { showResolved: true });
    expect(result!.comments).toHaveLength(2);
  });

  it("defaults showResolved to true", () => {
    const loader = () =>
      makeDoc([makeRawComment({ resolved: true })]) as any;
    const result = resolveComments(loader, {});
    expect(result).not.toBeNull();
    expect(result!.comments).toHaveLength(1);
  });

  it("returns null when all comments filtered out", () => {
    const loader = () =>
      makeDoc([makeRawComment({ resolved: true })]) as any;
    const result = resolveComments(loader, { showResolved: false });
    expect(result).toBeNull();
  });

  it("passes options through to loader", () => {
    let capturedOptions: any;
    const loader = (opts: any) => {
      capturedOptions = opts;
      return makeDoc([makeRawComment()]) as any;
    };
    resolveComments(loader, { documentPath: "/test.md", showResolved: true });
    expect(capturedOptions.documentPath).toBe("/test.md");
  });
});

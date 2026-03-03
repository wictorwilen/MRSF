/**
 * Tests for the git integration module.
 */

import { describe, it, expect } from "vitest";
import { parseDiffHunks, getLineShift } from "../lib/git.js";
import type { DiffHunk } from "../lib/types.js";

describe("parseDiffHunks", () => {
  it("parses a simple unified diff", () => {
    const diff = `diff --git a/file.md b/file.md
index abc..def 100644
--- a/file.md
+++ b/file.md
@@ -3,0 +4,2 @@ some context
+inserted line 1
+inserted line 2
@@ -10,1 +13,1 @@ more context
-old line
+new line`;

    const hunks = parseDiffHunks(diff);
    expect(hunks).toHaveLength(2);

    expect(hunks[0].oldStart).toBe(3);
    expect(hunks[0].oldCount).toBe(0);
    expect(hunks[0].newStart).toBe(4);
    expect(hunks[0].newCount).toBe(2);

    expect(hunks[1].oldStart).toBe(10);
    expect(hunks[1].oldCount).toBe(1);
    expect(hunks[1].newStart).toBe(13);
    expect(hunks[1].newCount).toBe(1);
  });

  it("returns empty for no hunks", () => {
    expect(parseDiffHunks("")).toHaveLength(0);
  });
});

describe("getLineShift", () => {
  // 2 lines inserted at old line 3
  const hunks: DiffHunk[] = [
    { oldStart: 3, oldCount: 0, newStart: 4, newCount: 2, lines: [] },
  ];

  it("returns 0 shift for lines before the hunk", () => {
    const result = getLineShift(hunks, 1);
    expect(result.shift).toBe(0);
    expect(result.modified).toBe(false);
  });

  it("returns positive shift for lines after insertion", () => {
    const result = getLineShift(hunks, 5);
    expect(result.shift).toBe(2);
    expect(result.modified).toBe(false);
  });

  it("handles deletion hunks", () => {
    const deleteHunks: DiffHunk[] = [
      { oldStart: 5, oldCount: 3, newStart: 5, newCount: 0, lines: [] },
    ];
    const result = getLineShift(deleteHunks, 10);
    expect(result.shift).toBe(-3);
    expect(result.modified).toBe(false);
  });

  it("marks modified lines", () => {
    const modHunks: DiffHunk[] = [
      { oldStart: 5, oldCount: 2, newStart: 5, newCount: 2, lines: [] },
    ];
    const result = getLineShift(modHunks, 5);
    expect(result.modified).toBe(true);
  });

  it("handles multiple hunks cumulatively", () => {
    const multiHunks: DiffHunk[] = [
      { oldStart: 2, oldCount: 0, newStart: 2, newCount: 1, lines: [] }, // +1
      { oldStart: 5, oldCount: 0, newStart: 6, newCount: 2, lines: [] }, // +2
    ];
    const result = getLineShift(multiHunks, 10);
    expect(result.shift).toBe(3);
    expect(result.modified).toBe(false);
  });
});

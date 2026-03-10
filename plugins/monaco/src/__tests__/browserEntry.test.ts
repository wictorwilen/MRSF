import { describe, expect, it } from "vitest";
import { MemoryHostAdapter, MemoryHostSession, MonacoMrsfPlugin } from "../browser.js";
import type { CommentDraft } from "../browser.js";

describe("browser entry", () => {
  it("exports MonacoMrsfPlugin from the browser-safe entry", () => {
    expect(MonacoMrsfPlugin).toBeTypeOf("function");
    expect(MemoryHostAdapter).toBeTypeOf("function");
    expect(MemoryHostSession).toBeTypeOf("function");
  });

  it("exports CommentDraft from the browser-safe entry", () => {
    const draft: CommentDraft = {
      line: 2,
      text: "Review this line.",
    };

    expect(draft).toEqual({
      line: 2,
      text: "Review this line.",
    });
  });
});
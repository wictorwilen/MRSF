import { describe, expect, it } from "vitest";
import { formatAuthor, newCommentId, parseAuthor } from "../lib/identity.js";

describe("identity helpers", () => {
  it("formats authors with and without handles", () => {
    expect(formatAuthor("Jane Doe", "jdoe")).toBe("Jane Doe (jdoe)");
    expect(formatAuthor("Jane Doe")).toBe("Jane Doe");
    expect(formatAuthor("Jane Doe", "   ")).toBe("Jane Doe");
  });

  it("trims author inputs", () => {
    expect(formatAuthor("  Jane Doe  ", "  jdoe  ")).toBe("Jane Doe (jdoe)");
  });

  it("parses formatted authors", () => {
    const author = formatAuthor("Jane Doe", "jdoe");
    expect(parseAuthor(author)).toEqual({ name: "Jane Doe", handle: "jdoe" });
  });

  it("parses authors without parenthesized handles", () => {
    expect(parseAuthor("  Jane Doe  ")).toEqual({ name: "Jane Doe" });
  });

  it("generates unique UUIDv4 comment ids", () => {
    const first = newCommentId();
    const second = newCommentId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first).not.toBe(second);
  });
});

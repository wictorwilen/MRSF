import { describe, expect, it } from "vitest";
import {
  formatMrsfCount,
  resolveMrsfGutterAddButtonPresentation,
  resolveMrsfGutterBadgePresentation,
} from "../gutter.js";

describe("gutter helpers", () => {
  it("caps counts at 9+ by default", () => {
    expect(formatMrsfCount(3)).toBe("3");
    expect(formatMrsfCount(12)).toBe("9+");
  });

  it("merges badge renderer overrides with shared defaults", () => {
    const presentation = resolveMrsfGutterBadgePresentation(
      {
        line: 4,
        commentCount: 12,
        threadCount: 2,
        resolvedState: "open",
        highestSeverity: "high",
        isActive: false,
      },
      ({ defaultPresentation }) => ({
        icon: "🗨",
        label: `custom ${defaultPresentation.countText}`,
        attributes: { "data-custom": "true" },
      }),
    );

    expect(presentation.countText).toBe("9+");
    expect(presentation.icon).toBe("🗨");
    expect(presentation.label).toBe("custom 9+");
    expect(presentation.attributes).toEqual({ "data-custom": "true" });
  });

  it("merges add button renderer overrides with shared defaults", () => {
    const presentation = resolveMrsfGutterAddButtonPresentation(
      {
        line: 8,
        isActive: false,
      },
      () => ({
        label: "New",
        attributes: { "data-add": "custom" },
      }),
    );

    expect(presentation.label).toBe("New");
    expect(presentation.title).toBe("Add comment thread");
    expect(presentation.attributes).toEqual({ "data-add": "custom" });
  });
});
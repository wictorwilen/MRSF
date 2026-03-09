import { beforeEach, describe, expect, it } from "vitest";
import { __mock, ThemeColor } from "vscode";
import { MrsfStatusBar } from "../statusBar.js";

describe("MrsfStatusBar", () => {
  beforeEach(() => {
    __mock.reset();
  });

  it("shows the base label with a comment count", () => {
    const statusBar = new MrsfStatusBar();
    const item = __mock.statusBarItems[0];

    statusBar.setCommentCount(3);

    expect(item.text).toContain("Sidemark: 3");
    expect(item.command).toBe("mrsf.refreshComments");
  });

  it("shows stale comments as a warning and changes the command", () => {
    const statusBar = new MrsfStatusBar();
    const item = __mock.statusBarItems[0];

    statusBar.setStaleCount(2);

    expect(item.text).toContain("2 stale");
    expect(item.command).toBe("mrsf.reanchor");
    expect(item.backgroundColor).toEqual(new ThemeColor("statusBarItem.warningBackground"));
  });

  it("shows dirty anchors when there are no stale comments", () => {
    const statusBar = new MrsfStatusBar();
    const item = __mock.statusBarItems[0];

    statusBar.setDirtyAnchors(true);

    expect(item.text).toContain("anchors drifted");
    expect(item.command).toBe("mrsf.refreshComments");
  });

  it("keeps the spinner active until concurrent operations complete", async () => {
    const statusBar = new MrsfStatusBar();
    const item = __mock.statusBarItems[0];

    let releaseFirst!: () => void;
    let releaseSecond!: () => void;

    const first = statusBar.withProgress("Loading", () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    const second = statusBar.withProgress("Saving", () => new Promise<void>((resolve) => {
      releaseSecond = resolve;
    }));

    expect(item.text).toContain("Sidemark: Saving");

    releaseFirst();
    await first;
    expect(item.text).toContain("Sidemark: Saving");

    releaseSecond();
    await second;
    expect(item.text).toContain("Sidemark");
    expect(item.text).not.toContain("sync~spin");
  });
});
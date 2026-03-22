import { afterEach, describe, expect, it, vi } from "vitest";
import type { Comment, MrsfDocument } from "@mrsf/cli/browser";
import { MilkdownMrsfController } from "../MilkdownMrsfController.js";
import type { MilkdownMrsfHostAdapter } from "../host/HostAdapter.js";

interface HostHarness {
  host: MilkdownMrsfHostAdapter;
  sidecar: MrsfDocument;
  writes: MrsfDocument[];
}

function makeHarness(documentText = "alpha\nbeta\ngamma"): HostHarness {
  let sourceText = documentText;
  let sidecar: MrsfDocument = {
    mrsf_version: "1.0",
    document: "doc.md",
    comments: [
      {
        id: "root",
        author: "Reviewer",
        timestamp: "2025-01-01T00:00:00.000Z",
        text: "Root",
        resolved: false,
        line: 2,
        start_column: 0,
        end_column: 4,
        selected_text: "beta",
      },
    ],
  };
  const writes: MrsfDocument[] = [];

  return {
    get sidecar() {
      return sidecar;
    },
    writes,
    host: {
      async getDocumentText() {
        return sourceText;
      },
      async getDocumentPath() {
        return "/tmp/doc.md";
      },
      async discoverSidecar() {
        return "/tmp/doc.md.review.yaml";
      },
      async readSidecar() {
        return structuredClone(sidecar);
      },
      async writeSidecar(_path, document) {
        sidecar = structuredClone(document);
        writes.push(structuredClone(document));
      },
      async watchDocument() {
        return () => undefined;
      },
      async watchSidecar() {
        return () => undefined;
      },
    },
  };
}

describe("MilkdownMrsfController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads, edits, saves, and reanchors review state while reporting state sources", async () => {
    const harness = makeHarness();
    const sources: string[] = [];
    const controller = new MilkdownMrsfController(harness.host, {
      resourceId: "resource",
      defaultAuthor: "Demo User",
      onStateChange: (event) => {
        sources.push(event.source);
      },
    });

    const loaded = await controller.load();
    expect(loaded.sidecarPath).toBe("/tmp/doc.md.review.yaml");
    expect(controller.getCommentById("root")?.selected_text).toBe("beta");
    expect(controller.getThreadForComment("missing")).toBeNull();
    expect(controller.getThreadsAtLine(2)).toHaveLength(1);

    await controller.reloadFromHost("alpha\nbeta\ngamma");
    controller.refresh("alpha\nbeta\ngamma");
    controller.applyChanges([
      {
        range: {
          start: { lineIndex: 1, column: 4 },
          end: { lineIndex: 1, column: 4 },
        },
        text: "-updated",
      },
    ], "alpha\nbeta-updated\ngamma");
    controller.applyTextUpdate("alpha\nbeta-updated\ngamma", "alpha\nBETA-updated\ngamma");

    const added = await controller.addCommentFromSelection(
      {
        start: { lineIndex: 0, column: 1 },
        end: { lineIndex: 0, column: 3 },
      },
      "New comment",
      "lp",
      { severity: "medium", type: "note" },
    );
    expect(added.author).toBe("Demo User");

    const reply = await controller.reply("root", {
      text: "Reply",
      selected_text: "beta",
    });
    expect(controller.getThreadForComment(reply.id)?.replies).toHaveLength(1);

    controller.edit(reply.id, { text: "Edited reply", type: "question" });
    expect(controller.getCommentById(reply.id)?.text).toBe("Edited reply");

    expect(controller.toggleResolved("root")).toBe(true);
    expect(controller.getCommentById("root")?.resolved).toBe(true);
    expect(controller.toggleResolved("root")).toBe(true);
    expect(controller.resolve("missing")).toBe(false);
    expect(controller.unresolve("missing")).toBe(false);

    expect(controller.remove(reply.id)).toBe(true);
    expect(controller.remove("missing")).toBe(false);

    await controller.save({ reason: "manual-test" });
    expect(harness.writes).toHaveLength(1);

    const reanchored = await controller.reanchor({ updateText: true });
    expect(reanchored.lastReanchorResults).toBeDefined();
    expect(sources).toContain("load");
    expect(sources).toContain("external");
    expect(sources).toContain("refresh");
    expect(sources).toContain("content");
    expect(sources).toContain("save");
    expect(sources).toContain("reanchor");

    controller.dispose();
  });

  it("honors custom save requests and exposes null state before loading", async () => {
    const harness = makeHarness();
    const onSaveRequest = vi.fn(async ({ defaultSave }) => {
      await defaultSave();
    });
    const controller = new MilkdownMrsfController(harness.host, {
      resourceId: "resource",
      defaultAuthor: "Demo User",
      onSaveRequest,
    });

    expect(controller.getState()).toBeNull();
    await controller.save();
    expect(onSaveRequest).not.toHaveBeenCalled();

    await controller.load();
    await controller.save({ reason: "custom" });

    expect(onSaveRequest).toHaveBeenCalledOnce();
    expect(harness.writes).toHaveLength(1);
    controller.dispose();
  });
});
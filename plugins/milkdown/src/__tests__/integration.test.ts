// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { Editor, defaultValueCtx, rootCtx, editorViewCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import type { MrsfDocument } from "@mrsf/cli/browser";
import { createMilkdownMrsfPlugin, getMilkdownMrsfController, getMilkdownMrsfDecorationState } from "../index.js";
import type { MilkdownMrsfHostAdapter } from "../host/HostAdapter.js";

function flush(delay = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function waitFor(check: () => boolean, attempts = 20, delay = 25): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) {
      return;
    }
    await flush(delay);
  }

  throw new Error("Condition was not met in time.");
}

describe("Milkdown integration", () => {
  let editor: Editor | null = null;

  afterEach(async () => {
    if (editor) {
      await editor.destroy();
      editor = null;
    }
    document.body.innerHTML = "";
  });

  it("loads review state into a real Milkdown editor and tracks document edits", async () => {
    let sidecar: MrsfDocument = {
      mrsf_version: "1.0",
      document: "example.md",
      comments: [
        {
          id: "c1",
          author: "A",
          timestamp: "2025-01-01T00:00:00.000Z",
          text: "Comment",
          resolved: false,
          line: 1,
          start_column: 6,
          end_column: 11,
          selected_text: "world",
        },
      ],
    };

    const host: MilkdownMrsfHostAdapter = {
      async getDocumentText() {
        return "hello world";
      },
      async getDocumentPath() {
        return "example.md";
      },
      async discoverSidecar() {
        return "/tmp/example.review.yaml";
      },
      async readSidecar() {
        return structuredClone(sidecar);
      },
      async writeSidecar(_path, document) {
        sidecar = structuredClone(document);
      },
    };

    const root = document.createElement("div");
    document.body.appendChild(root);

    editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, "hello world");
      })
      .use(commonmark)
      .use(createMilkdownMrsfPlugin(host, {
        resourceId: "example",
        defaultAuthor: "Tester",
      }));

    await editor.create();

    const controller = getMilkdownMrsfController(editor);
    expect(controller).not.toBeNull();

    await waitFor(() => (controller?.getState()?.snapshot.inlineRanges.length ?? 0) === 1);
    await waitFor(() => getMilkdownMrsfDecorationState(editor!).decorations.find().length > 0);
    expect(controller?.getState()?.snapshot.gutterMarks).toHaveLength(1);
    expect(getMilkdownMrsfDecorationState(editor).decorations.find().length).toBeGreaterThan(0);

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const tr = view.state.tr.insertText("start ", 1);
      view.dispatch(tr);
    });

    await waitFor(() => (controller?.getState()?.document.comments[0]?.start_column ?? 0) === 12, 20, 40);

    expect(controller?.getState()?.document.comments[0]?.start_column).toBe(12);
    expect(controller?.getState()?.document.comments[0]?.end_column).toBe(17);

    await controller?.save({ reason: "test" });
    expect(sidecar.comments[0]?.start_column).toBe(12);
  });
});
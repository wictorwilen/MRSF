// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { MrsfDocument } from "@mrsf/cli/browser";
import { createTiptapMrsfExtension, getTiptapMrsfController } from "../index.js";
import type { TiptapMrsfHostAdapter } from "../host/HostAdapter.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) {
      return;
    }
    await flush();
  }

  throw new Error("Condition was not met in time.");
}

describe("Tiptap integration", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts in a real editor, decorates inline comments, and reloads from host", async () => {
    let sidecar: MrsfDocument = {
      mrsf_version: "1.0",
      document: "example.md",
      comments: [],
    };
    const onCommentClick = vi.fn();

    const writeSidecar = vi.fn(async (_path: string, document: typeof sidecar) => {
      sidecar = structuredClone(document);
    });

    const host: TiptapMrsfHostAdapter = {
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
      async writeSidecar(path, document) {
        await writeSidecar(path, document as typeof sidecar);
      },
    };

    const root = document.createElement("div");
    document.body.appendChild(root);

    const editor = new Editor({
      element: root,
      extensions: [
        StarterKit,
        createTiptapMrsfExtension(host, {
          resourceId: "example",
          defaultAuthor: "Tester",
          lineHighlight: true,
          onCommentClick,
        }),
      ],
      content: "<p>hello world</p>",
    });

    editor.view.coordsAtPos = ((pos: number) => ({
      top: 20 + pos,
      bottom: 40 + pos,
      left: 24,
      right: 120,
    })) as typeof editor.view.coordsAtPos;

    await flush();

    const controller = getTiptapMrsfController(editor);
    expect(controller).not.toBeNull();

    editor.commands.setTextSelection({ from: 1, to: 6 });
    await flush();
    expect(editor.commands.mrsfAddComment("Greeting")).toBe(true);
    await waitFor(() => (controller?.getState()?.document.comments.length ?? 0) === 1);
    await waitFor(() => !!root.querySelector(".mrsf-inline-highlight"));
    await waitFor(() => !!root.querySelector(".mrsf-badge"));
    await waitFor(() => !!root.querySelector(".mrsf-line-highlight-overlay"));

    expect(root.querySelector(".mrsf-inline-highlight")).not.toBeNull();
    expect(root.querySelector(".mrsf-badge")).not.toBeNull();
    expect(root.querySelector(".mrsf-line-highlight-overlay")).not.toBeNull();
    expect(controller?.getState()?.snapshot.inlineRanges).toHaveLength(1);

    root.querySelector<HTMLElement>(".mrsf-badge")?.click();
    expect(onCommentClick).toHaveBeenCalledTimes(1);
    expect(onCommentClick.mock.calls[0]?.[0]?.anchorRect).toBeTruthy();

    expect(editor.commands.mrsfSave("test")).toBe(true);
    await flush();
    expect(writeSidecar).toHaveBeenCalledTimes(1);

    sidecar = {
      ...sidecar,
      comments: [
        ...sidecar.comments,
        {
          id: "external-1",
          author: "External",
          timestamp: new Date().toISOString(),
          text: "External change",
          resolved: false,
          line: 1,
          start_column: 6,
          end_column: 11,
          selected_text: "world",
        },
      ],
    };

    expect(editor.commands.mrsfReload()).toBe(true);
    await waitFor(() => (controller?.getState()?.document.comments.length ?? 0) === 2);
    expect(root.querySelectorAll(".mrsf-inline-highlight").length).toBeGreaterThanOrEqual(1);

    editor.destroy();
  });
});
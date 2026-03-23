// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { Crepe } from "@milkdown/crepe";
import { TextSelection } from "@milkdown/prose/state";
import type { MrsfDocument } from "@mrsf/cli/browser";
import {
  createCrepeMrsfFeature,
  createCrepeMrsfToolbarConfig,
  createMilkdownMrsfPlugin,
  getCrepeMrsfController,
  getCrepeMrsfDecorationState,
} from "../index.js";
import type { MilkdownMrsfHostAdapter } from "../host/HostAdapter.js";
import { addCrepeMrsfToolbarItem, runCrepeAddComment } from "../ui/crepeCommentAction.js";

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

const DEMO_MARKDOWN = `# Milkdown MRSF Demo

This demo runs the same review runtime in direct Milkdown and Crepe.

Switch modes to compare the editing shell while the sidecar model stays the same.

## Workflow

- Select text and add a comment.
- Save to persist the current sidecar state.
- Reload or simulate an external sidecar change.

## Release Notes

Anchors should follow live edits in this editor.

Crepe and direct Milkdown share the same review controller.
`;

describe("Crepe integration", () => {
  let crepe: Crepe | null = null;
  let editor: Editor | null = null;

  beforeEach(() => {
    if (typeof Range !== "undefined") {
      Range.prototype.getClientRects ??= function getClientRects() {
        return [] as unknown as DOMRectList;
      };
      Range.prototype.getBoundingClientRect ??= function getBoundingClientRect() {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        };
      };
    }
  });

  afterEach(async () => {
    if (crepe) {
      await crepe.destroy();
      crepe = null;
    }
    if (editor) {
      await editor.destroy();
      editor = null;
    }
    document.body.innerHTML = "";
  });

  it("installs the MRSF runtime through a Crepe feature", async () => {
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

    crepe = new Crepe({
      root,
      defaultValue: "hello world",
      featureConfigs: {
        toolbar: createCrepeMrsfToolbarConfig({
          defaultAuthor: "Tester",
        }),
      },
    });
    crepe.addFeature(createCrepeMrsfFeature(host, {
      resourceId: "example-crepe",
      defaultAuthor: "Tester",
    }));

    await crepe.create();

    const controller = getCrepeMrsfController(crepe);
    expect(controller).not.toBeNull();

    await waitFor(() => (controller?.getState()?.snapshot.inlineRanges.length ?? 0) === 1);
    await waitFor(() => getCrepeMrsfDecorationState(crepe!).decorations.find().length > 0);

    expect(getCrepeMrsfDecorationState(crepe).decorations.find().length).toBeGreaterThan(0);

    await controller?.save({ reason: "crepe-test" });
    expect(sidecar.comments[0]?.selected_text).toBe("world");
  });

  it("renders overlay inline highlights when ProseMirror inline decorations are disabled", async () => {
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
    root.className = "editor-host";
    document.body.appendChild(root);

    crepe = new Crepe({
      root,
      defaultValue: "hello world",
      featureConfigs: {
        toolbar: createCrepeMrsfToolbarConfig({
          defaultAuthor: "Tester",
        }),
      },
    });
    crepe.addFeature(createCrepeMrsfFeature(host, {
      resourceId: "example-crepe-overlay",
      defaultAuthor: "Tester",
      inlineHighlights: false,
    }));

    await crepe.create();

    const controller = getCrepeMrsfController(crepe);
    expect(controller).not.toBeNull();

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = (pos: number) => ({
        top: 24,
        bottom: 44,
        left: 24 + pos * 8,
        right: 32 + pos * 8,
      });
    });

    await waitFor(() => (controller?.getState()?.snapshot.inlineRanges.length ?? 0) === 1);
    controller?.refresh("hello world");
    await waitFor(() => document.querySelectorAll(".mrsf-inline-highlight-overlay").length > 0);

    expect(document.querySelectorAll(".mrsf-inline-highlight")).toHaveLength(0);
    expect(document.querySelectorAll(".mrsf-inline-highlight-overlay").length).toBeGreaterThan(0);
  });

  it("can create Crepe after destroying a direct Milkdown editor", async () => {
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
          line: 2,
          start_column: 15,
          end_column: 34,
          selected_text: "same review runtime",
        },
      ],
    };

    const host: MilkdownMrsfHostAdapter = {
      async getDocumentText() {
        return [
          "Milkdown MRSF Demo",
          "This demo runs the same review runtime in direct Milkdown and Crepe.",
          "Switch modes to compare the editing shell while the sidecar model stays the same.",
          "Workflow",
          "Select text and add a comment.",
          "Save to persist the current sidecar state.",
          "Reload or simulate an external sidecar change.",
          "Release Notes",
          "Anchors should follow live edits in this editor.",
          "Crepe and direct Milkdown share the same review controller.",
        ].join("\n");
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
        ctx.set(defaultValueCtx, DEMO_MARKDOWN);
      })
      .use(commonmark)
      .use(createMilkdownMrsfPlugin(host, {
        resourceId: "example-milkdown",
        defaultAuthor: "Tester",
        interactive: true,
      }));

    await editor.create();
    await editor.destroy();
    editor = null;
    root.innerHTML = "";

    crepe = new Crepe({
      root,
      defaultValue: DEMO_MARKDOWN,
      featureConfigs: {
        toolbar: createCrepeMrsfToolbarConfig({
          defaultAuthor: "Tester",
          interactive: true,
        }),
      },
    });
    crepe.addFeature(createCrepeMrsfFeature(host, {
      resourceId: "example-crepe-switch",
      defaultAuthor: "Tester",
      interactive: true,
    }));

    await crepe.create();

    const controller = getCrepeMrsfController(crepe);
    expect(controller).not.toBeNull();
    await waitFor(() => getCrepeMrsfDecorationState(crepe!).decorations.find().length > 0);
  });

  it("adds an MRSF action into the Crepe toolbar builder", () => {
    let capturedItem:
      | {
          icon: string;
          active: () => boolean;
          onRun: (ctx: { value: string }) => void;
        }
      | undefined;
    const receivedContexts: Array<{ value: string }> = [];

    const builder = {
      addGroup(_key: string, _label: string) {
        return {
          addItem(
            _itemKey: string,
            item: {
              icon: string;
              active: () => boolean;
              onRun: (ctx: { value: string }) => void;
            },
          ) {
            capturedItem = item;
            return this;
          },
        };
      },
    };

    addCrepeMrsfToolbarItem(builder, (ctx) => {
      receivedContexts.push(ctx as { value: string });
    });

    expect(capturedItem).toBeDefined();
    expect(capturedItem?.icon).toContain("currentColor");
    expect(capturedItem?.active({ value: "unused" })).toBe(false);

    capturedItem?.onRun({ value: "toolbar" });
    expect(receivedContexts).toEqual([{ value: "toolbar" }]);
  });

  it("runs the native Crepe add-comment action against the current selection", async () => {
    let sidecar: MrsfDocument = {
      mrsf_version: "1.0",
      document: "example.md",
      comments: [],
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

    crepe = new Crepe({
      root,
      defaultValue: "hello world",
      featureConfigs: {
        toolbar: createCrepeMrsfToolbarConfig({
          defaultAuthor: "Tester",
          interactive: true,
        }),
      },
    });
    crepe.addFeature(createCrepeMrsfFeature(host, {
      resourceId: "example-crepe-menu",
      defaultAuthor: "Tester",
      interactive: true,
    }));

    await crepe.create();

    const controller = getCrepeMrsfController(crepe);
    expect(controller).not.toBeNull();

    const view = crepe.editor.action((ctx) => {
      const editorView = ctx.get(editorViewCtx);
      editorView.dispatch(
        editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, 1, 6)),
      );
      return editorView;
    });

    await runCrepeAddComment(view, controller, {
      composeAdd: () => ({
        text: "Menu comment",
        severity: "low",
        type: "note",
      }),
    });

    await waitFor(() => (controller?.getState()?.document.comments.length ?? 0) === 1);
    expect(controller?.getState()?.document.comments[0]?.text).toBe("Menu comment");
  });
});
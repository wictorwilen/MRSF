import { describe, expect, it } from "vitest";
import type * as monaco from "monaco-editor";
import { MemoryHostAdapter } from "../host/MemoryHostAdapter.js";
import { MonacoMrsfPlugin } from "../MonacoMrsfPlugin.js";

function disposable(): monaco.IDisposable {
  return { dispose() {} };
}

function createFakeEditor(resourceId: string, value: string): monaco.editor.IStandaloneCodeEditor {
  const model = {
    uri: { toString: () => resourceId },
    getLanguageId: () => "markdown",
    getValue: () => value,
    getLineCount: () => value.split("\n").length,
    getLineLength: (lineNumber: number) => value.split("\n")[lineNumber - 1]?.length ?? 0,
    deltaDecorations: (_oldIds: string[], newDecorations: monaco.editor.IModelDeltaDecoration[]) =>
      newDecorations.map((_, index) => `dec-${index}`),
    onDidChangeContent: () => disposable(),
  } as unknown as monaco.editor.ITextModel;

  return {
    getModel: () => model,
    getSelection: () => null,
    revealLineInCenter: () => {},
    onDidChangeCursorSelection: () => disposable(),
    onDidChangeModel: () => disposable(),
    onMouseDown: () => disposable(),
    onMouseMove: () => disposable(),
    addAction: () => disposable(),
  } as unknown as monaco.editor.IStandaloneCodeEditor;
}

describe("MonacoMrsfPlugin", () => {
  it("reloads state when the host sidecar changes", async () => {
    const resourceId = "file:///doc.md";
    const host = new MemoryHostAdapter({
      resources: {
        [resourceId]: {
          documentText: "alpha\nbeta",
          documentPath: "/tmp/doc.md",
          sidecarPath: "/tmp/doc.md.review.yaml",
          sidecar: {
            mrsf_version: "1.0",
            document: "doc.md",
            comments: [],
          },
        },
      },
    });

    const plugin = new MonacoMrsfPlugin(
      createFakeEditor(resourceId, "alpha\nbeta"),
      host,
      {
        autoLoad: false,
        registerActions: false,
        watchHostChanges: true,
      },
    );

    await plugin.loadCurrent();
    expect(plugin.getState()?.document.comments).toHaveLength(0);

    await host.updateSidecar(resourceId, {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [
        {
          id: "c1",
          author: "A",
          timestamp: "2025-01-01T00:00:00.000Z",
          text: "External comment",
          resolved: false,
          line: 2,
        },
      ],
    });

    expect(plugin.getState()?.document.comments).toHaveLength(1);
    expect(plugin.getState()?.snapshot.gutterMarks[0].line).toBe(2);

    plugin.dispose();
  });

  it("emits state changes and routes save through the host save hook", async () => {
    const resourceId = "file:///doc.md";
    const host = new MemoryHostAdapter({
      resources: {
        [resourceId]: {
          documentText: "alpha\nbeta",
          documentPath: "/tmp/doc.md",
          sidecarPath: "/tmp/doc.md.review.yaml",
          sidecar: {
            mrsf_version: "1.0",
            document: "doc.md",
            comments: [],
          },
        },
      },
    });

    const sources: string[] = [];
    const reasons: string[] = [];
    const plugin = new MonacoMrsfPlugin(
      createFakeEditor(resourceId, "alpha\nbeta"),
      host,
      {
        autoLoad: false,
        registerActions: false,
        watchHostChanges: false,
        onStateChange: ({ source }) => {
          sources.push(source);
        },
        onSaveRequest: async ({ reason, defaultSave }) => {
          reasons.push(reason);
          await defaultSave();
        },
      },
    );

    await plugin.loadCurrent();
    await plugin.addComment({
      text: "Comment",
      author: "Tester",
      line: 2,
    });
    await plugin.save({ reason: "toolbar" });

    expect(sources).toContain("load");
    expect(sources).toContain("save");
    expect(reasons).toEqual(["toolbar"]);

    plugin.dispose();
  });
});
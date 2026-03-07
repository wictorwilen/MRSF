import { describe, expect, it } from "vitest";
import type * as monaco from "monaco-editor";
import { registerMonacoActions } from "../MonacoActions.js";
import type { MonacoMrsfPlugin } from "../MonacoMrsfPlugin.js";

function disposable(): monaco.IDisposable {
  return { dispose() {} };
}

describe("MonacoActions", () => {
  it("registers add-comment as a selection context action", () => {
    const actions: Array<Record<string, unknown>> = [];
    const editor = {
      addAction(config: Record<string, unknown>) {
        actions.push(config);
        return disposable();
      },
    } as unknown as monaco.editor.IStandaloneCodeEditor;

    registerMonacoActions(editor, {} as MonacoMrsfPlugin);

    const addAction = actions.find((entry) => entry.id === "mrsf.addComment");
    expect(addAction?.precondition).toBe("editorHasSelection");
  });
});
import type * as monaco from "monaco-editor";
import type {
  DecorationSnapshot,
  DocumentGeometry,
  EditorContentChange,
  EditorSelection,
  MonacoDecorationOptions,
} from "./types.js";
import {
  createMonacoDecorationSet,
  defaultMonacoDecorationClasses,
  injectDefaultMonacoDecorationStyles,
} from "./MonacoDecorations.js";

export interface MonacoViewAdapterOptions extends MonacoDecorationOptions {
  injectStyles?: boolean;
  targetDocument?: Document;
}

function toEditorSelection(
  selection: monaco.Selection | monaco.Range,
): EditorSelection {
  return {
    start: {
      lineIndex: selection.startLineNumber - 1,
      column: selection.startColumn - 1,
    },
    end: {
      lineIndex: selection.endLineNumber - 1,
      column: selection.endColumn - 1,
    },
  };
}

function toEditorChange(
  change: monaco.editor.IModelContentChange,
): EditorContentChange {
  return {
    range: {
      start: {
        lineIndex: change.range.startLineNumber - 1,
        column: change.range.startColumn - 1,
      },
      end: {
        lineIndex: change.range.endLineNumber - 1,
        column: change.range.endColumn - 1,
      },
    },
    text: change.text,
  };
}

export class MonacoViewAdapter {
  private gutterDecorationIds: string[] = [];
  private inlineDecorationIds: string[] = [];

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly options: MonacoViewAdapterOptions = {},
  ) {
    if (options.injectStyles !== false) {
      injectDefaultMonacoDecorationStyles(
        options.targetDocument,
        {
          ...defaultMonacoDecorationClasses(),
          ...options.classes,
        },
      );
    }
  }

  getResourceId(): string | null {
    return this.editor.getModel()?.uri.toString() ?? null;
  }

  getLanguageId(): string | null {
    return this.editor.getModel()?.getLanguageId() ?? null;
  }

  getText(): string {
    return this.editor.getModel()?.getValue() ?? "";
  }

  getSelection(): EditorSelection | null {
    const selection = this.editor.getSelection();
    return selection ? toEditorSelection(selection) : null;
  }

  getGeometry(): DocumentGeometry | null {
    const model = this.editor.getModel();
    if (!model) return null;

    return {
      lineCount: model.getLineCount(),
      getLineLength: (lineIndex: number) => model.getLineLength(lineIndex + 1),
    };
  }

  applySnapshot(snapshot: DecorationSnapshot): void {
    const model = this.editor.getModel();
    if (!model) return;

    const decorations = createMonacoDecorationSet(snapshot, this.options);
    this.gutterDecorationIds = model.deltaDecorations(
      this.gutterDecorationIds,
      decorations.gutter,
    );
    this.inlineDecorationIds = model.deltaDecorations(
      this.inlineDecorationIds,
      decorations.inline,
    );
  }

  clearDecorations(): void {
    const model = this.editor.getModel();
    if (!model) return;

    this.gutterDecorationIds = model.deltaDecorations(this.gutterDecorationIds, []);
    this.inlineDecorationIds = model.deltaDecorations(this.inlineDecorationIds, []);
  }

  revealLine(line: number): void {
    this.editor.revealLineInCenter(line);
  }

  onDidChangeContent(
    listener: (changes: readonly EditorContentChange[]) => void,
  ): monaco.IDisposable {
    const model = this.editor.getModel();
    if (!model) {
      return { dispose() {} };
    }

    return model.onDidChangeContent((event) => {
      listener(event.changes.map(toEditorChange));
    });
  }

  onDidChangeSelection(
    listener: (selection: EditorSelection | null) => void,
  ): monaco.IDisposable {
    return this.editor.onDidChangeCursorSelection((event) => {
      listener(event.selection ? toEditorSelection(event.selection) : null);
    });
  }

  onDidChangeModel(listener: () => void): monaco.IDisposable {
    return this.editor.onDidChangeModel(() => {
      this.gutterDecorationIds = [];
      this.inlineDecorationIds = [];
      listener();
    });
  }

  dispose(): void {
    this.clearDecorations();
  }
}
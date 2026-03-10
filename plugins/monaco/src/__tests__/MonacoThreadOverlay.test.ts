import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type * as monaco from "monaco-editor";
import { MonacoThreadOverlay } from "../MonacoThreadOverlay.js";
import type { ReviewState } from "../types.js";

function disposable(): monaco.IDisposable {
  return { dispose() {} };
}

class FakeEditor {
  private mouseDownListener: ((event: monaco.editor.IEditorMouseEvent) => void) | null = null;
  private mouseMoveListener: ((event: monaco.editor.IEditorMouseEvent) => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly lineCount = 4,
  ) {}

  getContainerDomNode(): HTMLElement {
    return this.container;
  }

  getModel(): monaco.editor.ITextModel {
    return {
      getLineCount: () => this.lineCount,
    } as monaco.editor.ITextModel;
  }

  getLayoutInfo(): monaco.editor.EditorLayoutInfo {
    return {
      contentLeft: 96,
      glyphMarginLeft: 20,
    } as monaco.editor.EditorLayoutInfo;
  }

  getVisibleRanges(): monaco.Range[] {
    return [
      {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: this.lineCount,
        endColumn: 1,
      } as monaco.Range,
    ];
  }

  getTopForLineNumber(line: number): number {
    return (line - 1) * 24;
  }

  getScrollTop(): number {
    return 0;
  }

  onDidScrollChange(): monaco.IDisposable {
    return disposable();
  }

  onDidLayoutChange(): monaco.IDisposable {
    return disposable();
  }

  onDidChangeModel(): monaco.IDisposable {
    return disposable();
  }

  onMouseDown(listener: (event: monaco.editor.IEditorMouseEvent) => void): monaco.IDisposable {
    this.mouseDownListener = listener;
    return disposable();
  }

  onMouseMove(listener: (event: monaco.editor.IEditorMouseEvent) => void): monaco.IDisposable {
    this.mouseMoveListener = listener;
    return disposable();
  }

  triggerMouseDown(): void {
    this.mouseDownListener?.({} as monaco.editor.IEditorMouseEvent);
  }

  triggerMouseMove(lineNumber: number, column: number, clientX: number, clientY: number): void {
    this.mouseMoveListener?.({
      target: {
        position: { lineNumber, column },
      },
      event: {
        browserEvent: { clientX, clientY },
      },
    } as monaco.editor.IEditorMouseEvent);
  }
}

function makeState(): ReviewState {
  return {
    resourceId: "file:///doc.md",
    document: {
      mrsf_version: "1.0",
      document: "doc.md",
      comments: [
        {
          id: "c1",
          author: "Alice",
          timestamp: "2026-03-07T12:00:00.000Z",
          text: "Inline comment",
          resolved: false,
          line: 2,
          start_column: 1,
          end_column: 5,
          selected_text: "beta",
        },
      ],
    },
    sidecarPath: "/tmp/doc.md.review.yaml",
    documentPath: "/tmp/doc.md",
    documentLines: ["alpha", "beta", "gamma", "delta"],
    snapshot: {
      threadsByLine: [
        {
          line: 2,
          threads: [
            {
              line: 2,
              rootCommentId: "c1",
              commentIds: ["c1"],
              replyCount: 0,
              resolved: false,
              highestSeverity: null,
              range: {
                start: { lineIndex: 1, column: 1 },
                end: { lineIndex: 1, column: 5 },
              },
            },
          ],
        },
      ],
      gutterMarks: [
        {
          line: 2,
          threadCount: 1,
          commentCount: 1,
          resolvedState: "open",
          highestSeverity: null,
        },
      ],
      inlineRanges: [
        {
          commentId: "c1",
          line: 2,
          selectedText: "beta",
          resolved: false,
          severity: null,
          range: {
            start: { lineIndex: 1, column: 1 },
            end: { lineIndex: 1, column: 5 },
          },
        },
      ],
      hoverTargets: [],
      documentLevelCommentIds: [],
      orphanedCommentIds: [],
    },
    loaded: true,
    dirty: false,
    hasPendingShifts: false,
    lastReanchorResults: [],
  };
}

function makeMultiThreadState(): ReviewState {
  const state = makeState();
  state.document.comments.push(
    {
      id: "c2",
      author: "Bob",
      timestamp: "2026-03-07T13:00:00.000Z",
      text: "Second thread",
      resolved: false,
      line: 2,
      type: "question",
    } as ReviewState["document"]["comments"][number],
    {
      id: "c3",
      author: "Carol",
      timestamp: "2026-03-07T13:05:00.000Z",
      text: "Reply",
      resolved: false,
      reply_to: "c2",
    } as ReviewState["document"]["comments"][number],
  );
  state.snapshot.threadsByLine = [
    {
      line: 2,
      threads: [
        state.snapshot.threadsByLine[0].threads[0],
        {
          line: 2,
          rootCommentId: "c2",
          commentIds: ["c2", "c3"],
          replyCount: 1,
          resolved: false,
          highestSeverity: null,
        },
      ],
    },
  ];
  state.snapshot.gutterMarks = [
    {
      line: 2,
      threadCount: 2,
      commentCount: 3,
      resolvedState: "open",
      highestSeverity: null,
    },
  ];
  return state;
}

describe("MonacoThreadOverlay", () => {
  it("renders add buttons for visible empty lines and calls onAddLine", () => {
    const dom = new JSDOM("<div id=editor></div>");
    const container = dom.window.document.getElementById("editor") as HTMLDivElement;
    container.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      x: 0,
      y: 0,
      toJSON() { return {}; },
    });
    const editor = new FakeEditor(container);
    const addedLines: number[] = [];

    const overlay = new MonacoThreadOverlay(editor as unknown as monaco.editor.IStandaloneCodeEditor, {
      targetDocument: dom.window.document,
      getState: () => makeState(),
      getThreadsAtLine: (line) => line === 2 ? [{ line: 2, rootComment: makeState().document.comments[0] as any, replies: [] }] : [],
      onAddLine: (line) => {
        addedLines.push(line);
      },
    });

    overlay.update(makeState());

    const addButton = container.querySelector('[data-add-line="true"][data-line="1"]') as HTMLButtonElement;
    expect(addButton).not.toBeNull();
    addButton.click();
    expect(addedLines).toEqual([1]);

    overlay.dispose();
  });

  it("positions inline-hover panel near cursor and closes on editor click", () => {
    const dom = new JSDOM("<div id=editor></div>");
    const container = dom.window.document.getElementById("editor") as HTMLDivElement;
    container.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      x: 0,
      y: 0,
      toJSON() { return {}; },
    });
    const editor = new FakeEditor(container);
    const state = makeState();

    const overlay = new MonacoThreadOverlay(editor as unknown as monaco.editor.IStandaloneCodeEditor, {
      targetDocument: dom.window.document,
      getState: () => state,
      getThreadsAtLine: () => [{ line: 2, rootComment: state.document.comments[0] as any, replies: [] }],
    });

    overlay.update(state);
    const root = container.querySelector('.mrsf-monaco-overlay-root') as HTMLDivElement;
    root.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      x: 0,
      y: 0,
      toJSON() { return {}; },
    });
    editor.triggerMouseMove(2, 3, 180, 120);

    const panel = container.querySelector('.mrsf-monaco-panel') as HTMLDivElement;
    expect(panel.hidden).toBe(false);
    expect(panel.style.left).toBe('194px');
    expect(panel.style.top).toBe('134px');

    editor.triggerMouseDown();
    expect(panel.hidden).toBe(true);

    overlay.dispose();
  });

  it("renders multi-thread tabs and filters to a selected thread", () => {
    const dom = new JSDOM("<div id=editor></div>");
    const container = dom.window.document.getElementById("editor") as HTMLDivElement;
    container.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      x: 0,
      y: 0,
      toJSON() { return {}; },
    });
    const editor = new FakeEditor(container);
    const state = makeMultiThreadState();

    const overlay = new MonacoThreadOverlay(editor as unknown as monaco.editor.IStandaloneCodeEditor, {
      targetDocument: dom.window.document,
      getState: () => state,
      getThreadsAtLine: () => [
        { line: 2, rootComment: state.document.comments[0] as any, replies: [] },
        { line: 2, rootComment: state.document.comments[1] as any, replies: [state.document.comments[2] as any] },
      ],
    });

    overlay.update(state);
    const badge = container.querySelector('[data-line="2"]') as HTMLButtonElement;
    badge.click();

    const tabs = container.querySelectorAll('.mrsf-monaco-thread-tab');
    expect(tabs).toHaveLength(3);

    const secondTab = tabs[2] as HTMLButtonElement;
    secondTab.click();

    const panel = container.querySelector('.mrsf-monaco-panel') as HTMLDivElement;
    expect(panel.innerHTML).toContain('Second thread');
    expect(panel.innerHTML).not.toContain('Inline comment');

    overlay.dispose();
  });
});
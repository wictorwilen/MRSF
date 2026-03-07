import type * as monaco from "monaco-editor";
import type { ReviewState, ReviewThread } from "./types.js";

function quoteBlock(text: string | undefined): string {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderThread(thread: ReviewThread): string {
  const lines: string[] = [];
  const root = thread.rootComment;
  const headerParts = [`**${root.author}**`];
  if (root.severity) headerParts.push(`_${root.severity}_`);
  if (root.type) headerParts.push(`\`${root.type}\``);
  if (root.resolved) headerParts.push("resolved");

  lines.push(headerParts.join(" · "));

  if (root.selected_text) {
    lines.push(quoteBlock(root.selected_text));
  }

  lines.push(root.text);

  for (const reply of thread.replies) {
    lines.push("");
    lines.push(`↳ **${reply.author}**${reply.resolved ? " · resolved" : ""}`);
    lines.push(reply.text);
  }

  return lines.join("\n\n");
}

export function buildHoverContents(
  state: ReviewState,
  threads: ReviewThread[],
  line: number,
): monaco.languages.Hover | null {
  if (threads.length === 0) return null;

  const lineSnapshot = state.snapshot.threadsByLine.find((entry) => entry.line === line);
  const firstRange = lineSnapshot?.threads.find((thread) => thread.range)?.range;

  return {
    range: firstRange
      ? {
          startLineNumber: firstRange.start.lineIndex + 1,
          startColumn: firstRange.start.column + 1,
          endLineNumber: firstRange.end.lineIndex + 1,
          endColumn: firstRange.end.column + 1,
        }
      : undefined,
    contents: threads.map((thread) => ({ value: renderThread(thread) })),
  };
}

export function createMonacoHoverProvider(
  getState: () => ReviewState | null,
  getThreadsAtLine: (line: number) => ReviewThread[],
): monaco.languages.HoverProvider {
  return {
    provideHover(_model, position) {
      const state = getState();
      if (!state) return null;
      const threads = getThreadsAtLine(position.lineNumber);
      return buildHoverContents(state, threads, position.lineNumber);
    },
  };
}
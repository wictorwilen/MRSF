import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import type { EditorState } from "@tiptap/pm/state";
import { type Comment, type MrsfDocument } from "@mrsf/cli/browser";
import {
  createTiptapMrsfExtension,
  getDocumentText,
  openTiptapMrsfFormDialog,
  createTiptapMrsfThreadPopoverHandler,
  getTiptapMrsfController,
  rangeFromOffsets,
  type ReviewState,
  type TiptapMrsfCommentClickEvent,
  type TiptapMrsfHostAdapter,
} from "@mrsf/tiptap-mrsf";
import "@mrsf/tiptap-mrsf/style.css";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { parse as parseYaml } from "yaml";

type DemoSidecar = MrsfDocument;

const resourceId = "demo:tiptap";
let currentDocumentPath = "/examples/tiptap-demo/demo.md";
let currentSidecarPath = "/examples/tiptap-demo/demo.md.review.yaml";

const initialHtml = `
  <h1>Tiptap MRSF Demo</h1>
  <p>Edit this page like a live product brief.</p>
  <p>Inline highlights follow the selected text while the sidecar stays in memory until the host saves.</p>
  <h2>Review workflow</h2>
  <ul>
    <li>Select text and use Add Comment to create a new review thread.</li>
    <li>Click a highlight to open the default thread popover and use resolve, reply, edit, or delete.</li>
    <li>Use External Sidecar Change to simulate another collaborator or backend update.</li>
  </ul>
  <h2>Review matrix</h2>
  <table>
    <thead>
      <tr>
        <th>Area</th>
        <th>Owner</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Selection UX</td>
        <td>Design Systems</td>
        <td>Needs tighter placement</td>
      </tr>
      <tr>
        <td>Table rendering</td>
        <td>Editor Platform</td>
        <td>Validate line and inline anchors</td>
      </tr>
      <tr>
        <td>Host save flow</td>
        <td>Product Engineering</td>
        <td>Ready for review</td>
      </tr>
    </tbody>
  </table>
  <h2>Notes</h2>
  <p>The plugin tracks line movement during editing.</p>
  <p>Reload pulls the latest sidecar from the host.</p>
  <p>Save persists the current review state back to the host snapshot.</p>
`;

const hostSnapshot = {
  documentText: [
    "Tiptap MRSF Demo",
    "Edit this page like a live product brief.",
    "Inline highlights follow the selected text while the sidecar stays in memory until the host saves.",
    "Review workflow",
    "Select text and use Add Comment to create a new review thread.",
    "Click a highlight to open the default thread popover and use resolve, reply, edit, or delete.",
    "Use External Sidecar Change to simulate another collaborator or backend update.",
    "Review matrix",
    "Area\tOwner\tStatus",
    "Selection UX\tDesign Systems\tNeeds tighter placement",
    "Table rendering\tEditor Platform\tValidate line and inline anchors",
    "Host save flow\tProduct Engineering\tReady for review",
    "Notes",
    "The plugin tracks line movement during editing.",
    "Reload pulls the latest sidecar from the host.",
    "Save persists the current review state back to the host snapshot.",
  ].join("\n"),
  sidecar: null as DemoSidecar | null,
};

function getLineNumber(documentText: string, lineText: string): number {
  const lines = documentText.split("\n");
  const index = lines.findIndex((line) => line === lineText);
  if (index === -1) {
    throw new Error(`Unable to find line '${lineText}' in demo document.`);
  }
  return index + 1;
}

function getInlineAnchor(documentText: string, lineText: string, selectedText: string) {
  const lines = documentText.split("\n");
  const lineIndex = lines.findIndex((line) => line === lineText);
  if (lineIndex === -1) {
    throw new Error(`Unable to find line '${lineText}' in demo document.`);
  }

  const start = lines[lineIndex].indexOf(selectedText);
  if (start === -1) {
    throw new Error(`Unable to find selection '${selectedText}' in line '${lineText}'.`);
  }

  return {
    line: lineIndex + 1,
    start_column: start,
    end_column: start + selectedText.length,
    selected_text: selectedText,
  };
}

function createEmptySidecar(documentPath: string): DemoSidecar {
  return {
    mrsf_version: "1.0",
    document: documentPath,
    comments: [],
  };
}

function cloneSidecar(sidecar: DemoSidecar): DemoSidecar {
  return {
    ...sidecar,
    comments: sidecar.comments.map((comment) => ({ ...comment })),
  };
}

function parseSidecarContent(content: string, filename: string): DemoSidecar {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Sidecar file is empty.");
  }

  const isJson = trimmed.startsWith("{") || filename.endsWith(".json");
  const parsed = isJson ? JSON.parse(trimmed) : parseYaml(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MRSF sidecar must be a YAML or JSON object.");
  }

  const sidecar = parsed as DemoSidecar;
  if (!Array.isArray(sidecar.comments)) {
    throw new Error("MRSF sidecar is missing a comments array.");
  }

  return {
    mrsf_version: sidecar.mrsf_version ?? "1.0",
    document: typeof sidecar.document === "string" ? sidecar.document : filename,
    comments: sidecar.comments.map((comment) => ({ ...comment })),
  };
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function joinBlockSegments(segments: string[]): string {
  return segments.filter((segment) => segment.length > 0).join("\n");
}

function markdownAstToEditorText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return "";
  }

  const current = node as {
    type?: string;
    value?: string;
    alt?: string;
    ordered?: boolean;
    children?: unknown[];
  };
  const children = current.children ?? [];

  switch (current.type) {
    case "root":
      return joinBlockSegments(children.map(markdownAstToEditorText));
    case "heading":
    case "paragraph":
    case "strong":
    case "emphasis":
    case "delete":
    case "link":
    case "linkReference":
      return children.map(markdownAstToEditorText).join("");
    case "blockquote":
      return joinBlockSegments(children.map(markdownAstToEditorText));
    case "list":
      return joinBlockSegments(children.map(markdownAstToEditorText));
    case "listItem":
      return joinBlockSegments(children.map(markdownAstToEditorText));
    case "table":
      return children.map(markdownAstToEditorText).join("\n");
    case "tableRow":
      return children.map(markdownAstToEditorText).join("\t");
    case "tableCell":
      return children.map(markdownAstToEditorText).join("");
    case "inlineCode":
    case "text":
      return current.value ?? "";
    case "code":
      return current.value ?? "";
    case "image":
      return current.alt ?? "";
    case "break":
      return "\n";
    default:
      return children.map(markdownAstToEditorText).join("");
  }
}

function markdownFragmentToEditorText(markdown: string): string {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree = processor.parse(markdown);
  return normalizeNewlines(markdownAstToEditorText(tree)).trim();
}

function countLines(text: string): number {
  return normalizeNewlines(text).split("\n").length;
}

function estimateEditorLineFromSourceLine(markdownText: string, sourceLine: number): number | null {
  if (!Number.isFinite(sourceLine) || sourceLine < 1) {
    return null;
  }

  const lines = normalizeNewlines(markdownText).split("\n");
  const prefix = lines.slice(0, Math.max(0, sourceLine - 1)).join("\n");
  if (!prefix.trim()) {
    return 1;
  }

  const visiblePrefix = markdownFragmentToEditorText(prefix);
  return visiblePrefix ? countLines(visiblePrefix) + 1 : 1;
}

function extractMarkdownAnchorFragment(markdownText: string, comment: Comment): string | null {
  if (comment.line == null) {
    return null;
  }

  const lines = normalizeNewlines(markdownText).split("\n");
  const startIndex = comment.line - 1;
  const endIndex = (comment.end_line ?? comment.line) - 1;
  if (startIndex < 0 || endIndex >= lines.length || endIndex < startIndex) {
    return null;
  }

  const selectedLines: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    let line = lines[index] ?? "";
    if (index === startIndex && comment.start_column != null) {
      line = line.slice(comment.start_column);
    }
    if (index === endIndex && comment.end_column != null) {
      line = line.slice(0, comment.end_column);
    }
    selectedLines.push(line);
  }

  return selectedLines.join("\n");
}

function mapVisibleExcerptToEditorRange(editorText: string, excerpt: string, preferredLine?: number | null) {
  const normalizedExcerpt = normalizeNewlines(excerpt).trim();
  if (!normalizedExcerpt) {
    return null;
  }

  const matches: Array<{ distance: number; startOffset: number; range: ReturnType<typeof rangeFromOffsets> }> = [];
  let searchOffset = -1;

  while ((searchOffset = editorText.indexOf(normalizedExcerpt, searchOffset + 1)) !== -1) {
    const range = rangeFromOffsets(searchOffset, searchOffset + normalizedExcerpt.length, editorText);
    const startLine = range.start.lineIndex + 1;
    matches.push({
      distance: preferredLine == null ? 0 : Math.abs(startLine - preferredLine),
      startOffset: searchOffset,
      range,
    });
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => left.distance - right.distance || left.startOffset - right.startOffset);
  return matches[0]?.range ?? null;
}

function fallbackRangeForVisibleText(preferredLine: number | null, visibleText: string, editorText: string) {
  if (preferredLine == null || preferredLine < 1) {
    return null;
  }

  const editorLines = normalizeNewlines(editorText).split("\n");
  const lineCount = editorLines.length;
  const startLine = Math.min(preferredLine, Math.max(1, lineCount));
  const excerptLines = Math.max(1, countLines(visibleText));
  const endLine = Math.min(lineCount, startLine + excerptLines - 1);
  return {
    start: { lineIndex: startLine - 1, column: 0 },
    end: {
      lineIndex: endLine - 1,
      column: (editorLines[endLine - 1] ?? "").length,
    },
  };
}

function prepareUploadedCommentAnchors(sidecar: DemoSidecar, markdownText: string, editorText: string): DemoSidecar {
  const prepared = cloneSidecar(sidecar);
  const roots = new Map<string, Comment>();

  for (const comment of prepared.comments) {
    if (comment.reply_to) {
      continue;
    }

    const sourceFragment = comment.selected_text || extractMarkdownAnchorFragment(markdownText, comment);
    if (!sourceFragment) {
      roots.set(comment.id, comment);
      continue;
    }

    const visibleText = markdownFragmentToEditorText(sourceFragment);
    const preferredLine = estimateEditorLineFromSourceLine(markdownText, comment.line ?? 0);
    const mappedRange = mapVisibleExcerptToEditorRange(editorText, visibleText, preferredLine)
      ?? fallbackRangeForVisibleText(preferredLine, visibleText, editorText);
    if (!mappedRange) {
      roots.set(comment.id, comment);
      continue;
    }

    comment.line = mappedRange.start.lineIndex + 1;
    comment.start_column = mappedRange.start.column;
    comment.end_line = mappedRange.end.lineIndex === mappedRange.start.lineIndex
      ? undefined
      : mappedRange.end.lineIndex + 1;
    comment.end_column = mappedRange.end.column;
    comment.selected_text = visibleText;
    delete comment.selected_text_hash;
    roots.set(comment.id, comment);
  }

  for (const comment of prepared.comments) {
    if (!comment.reply_to) {
      continue;
    }

    const root = roots.get(comment.reply_to);
    if (!root) {
      continue;
    }

    comment.line = root.line;
    comment.end_line = root.end_line;
    comment.start_column = root.start_column;
    comment.end_column = root.end_column;
    if (!comment.selected_text && root.selected_text) {
      comment.selected_text = root.selected_text;
      delete comment.selected_text_hash;
    }
  }

  return prepared;
}

async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);

  return String(rendered);
}

function prepareUploadedSidecar(sidecar: DemoSidecar, documentPath: string): DemoSidecar {
  const uploaded = cloneSidecar(sidecar);
  uploaded.document = documentPath;
  return uploaded;
}

function createInitialSidecar(documentText: string): DemoSidecar {
  return {
    mrsf_version: "1.0",
    document: currentDocumentPath,
    comments: [
      {
        id: "brief-root",
        author: "Demo Reviewer",
        timestamp: "2026-03-20T10:00:00.000Z",
        text: "This opening note is a good place to explain the editing model in one sentence.",
        resolved: false,
        line: getLineNumber(documentText, "Edit this page like a live product brief."),
        severity: "medium",
        type: "note",
      },
      {
        id: "notes-root",
        author: "Docs Review",
        timestamp: "2026-03-20T10:02:00.000Z",
        text: "Keep one pure line comment in the notes section so the gutter shows a non-inline anchor clearly.",
        resolved: false,
        line: getLineNumber(documentText, "The plugin tracks line movement during editing."),
        severity: "low",
        type: "clarity",
      },
      {
        id: "memory-inline",
        author: "QA Review",
        timestamp: "2026-03-20T10:04:00.000Z",
        text: "This phrase captures the explicit-save contract. Keep it visible in the demo.",
        resolved: false,
        ...getInlineAnchor(
          documentText,
          "Inline highlights follow the selected text while the sidecar stays in memory until the host saves.",
          "sidecar stays in memory until the host saves",
        ),
        severity: "high",
        type: "issue",
      },
      {
        id: "popover-root",
        author: "Design Review",
        timestamp: "2026-03-20T10:06:00.000Z",
        text: "Keep this line. It demonstrates the default popover flow for clicked highlights.",
        resolved: false,
        ...getInlineAnchor(
          documentText,
          "Click a highlight to open the default thread popover and use resolve, reply, edit, or delete.",
          "default thread popover",
        ),
        severity: "low",
        type: "question",
      },
      {
        id: "save-root",
        author: "Engineering",
        timestamp: "2026-03-20T10:07:00.000Z",
        text: "This line is a good place to show a multi-comment gutter badge instead of only a single marker.",
        resolved: false,
        line: getLineNumber(documentText, "Save persists the current review state back to the host snapshot."),
        severity: "medium",
        type: "suggestion",
      },
      {
        id: "save-reply",
        author: "Product",
        timestamp: "2026-03-20T10:07:30.000Z",
        text: "Using the save row for a reply makes the gutter count look intentional in the demo.",
        resolved: false,
        reply_to: "save-root",
      },
      {
        id: "popover-reply",
        author: "Product",
        timestamp: "2026-03-20T10:08:00.000Z",
        text: "Replying here should feel immediate, even with the host still controlling persistence.",
        resolved: false,
        reply_to: "popover-root",
      },
      {
        id: "table-line-root",
        author: "QA Review",
        timestamp: "2026-03-20T10:09:00.000Z",
        text: "Keep one line-only comment on a table row so the gutter behavior is visible against structured content.",
        resolved: false,
        line: getLineNumber(documentText, "Selection UX\tDesign Systems\tNeeds tighter placement"),
        severity: "medium",
        type: "table",
      },
      {
        id: "table-inline-root",
        author: "Editor Platform",
        timestamp: "2026-03-20T10:09:30.000Z",
        text: "This inline selection in a table cell is the main regression target for the TipTap table text model.",
        resolved: false,
        ...getInlineAnchor(
          documentText,
          "Table rendering\tEditor Platform\tValidate line and inline anchors",
          "Validate line and inline anchors",
        ),
        severity: "high",
        type: "table",
      },
      {
        id: "table-inline-reply",
        author: "Product",
        timestamp: "2026-03-20T10:10:00.000Z",
        text: "The reply makes it easier to verify the popover rendering against table-backed anchors.",
        resolved: false,
        reply_to: "table-inline-root",
      },
    ],
  };
}

hostSnapshot.sidecar = createInitialSidecar(hostSnapshot.documentText);

async function main(): Promise<void> {
  const editorContainer = document.getElementById("editor");
  const editorStage = editorContainer?.parentElement;
  const toolbar = document.getElementById("editor-toolbar");
  const selectionAction = document.getElementById("selection-action");
  const selectionAddCommentButton = document.getElementById("selection-add-comment");
  const statusPill = document.getElementById("status-pill");
  const saveIndicator = document.getElementById("save-indicator");
  const anchorIndicator = document.getElementById("anchor-indicator");
  const lastSaved = document.getElementById("last-saved");
  const markdownUploadInput = document.getElementById("markdown-upload") as HTMLInputElement | null;
  const sidecarUploadInput = document.getElementById("sidecar-upload") as HTMLInputElement | null;
  const loadUploadsButton = document.getElementById("load-uploads");
  const uploadStatus = document.getElementById("upload-status");
  const editorSummary = document.getElementById("editor-summary");
  const statusPanel = document.getElementById("status-panel");
  const stateOutput = document.getElementById("state-output");
  const hostOutput = document.getElementById("host-output");
  const addCommentButton = document.getElementById("add-comment");
  const saveSidecarButton = document.getElementById("save-sidecar");
  const reloadSidecarButton = document.getElementById("reload-sidecar");
  const reanchorSidecarButton = document.getElementById("reanchor-sidecar");
  const externalSidecarButton = document.getElementById("external-sidecar");

  if (
    !editorContainer
    || !editorStage
    || !toolbar
    || !selectionAction
    || !selectionAddCommentButton
    || !statusPill
    || !saveIndicator
    || !anchorIndicator
    || !lastSaved
    || !markdownUploadInput
    || !sidecarUploadInput
    || !loadUploadsButton
    || !uploadStatus
    || !editorSummary
    || !statusPanel
    || !stateOutput
    || !hostOutput
    || !addCommentButton
    || !saveSidecarButton
    || !reloadSidecarButton
    || !reanchorSidecarButton
    || !externalSidecarButton
  ) {
    throw new Error("Tiptap demo shell is missing required DOM nodes.");
  }

  let currentState: ReviewState | null = null;
  let lastSavedAt = "No host write yet";
  let editor: Editor | null = null;
  let lastCommentSelection: { from: number; to: number } | null = null;
  let suppressPanelRendering = false;
  let panelRenderScheduled = false;

  const host: TiptapMrsfHostAdapter = {
    async getDocumentText() {
      return hostSnapshot.documentText;
    },
    async getDocumentPath() {
      return currentDocumentPath;
    },
    async discoverSidecar() {
      return currentSidecarPath;
    },
    async readSidecar() {
      return hostSnapshot.sidecar ? structuredClone(hostSnapshot.sidecar) : null;
    },
    async writeSidecar(_path, document) {
      hostSnapshot.sidecar = structuredClone(document) as DemoSidecar;
      lastSavedAt = new Date().toLocaleTimeString();
    },
  };

  function setStatus(message: string): void {
    statusPill.textContent = message;
  }

  function setUploadStatus(message: string): void {
    uploadStatus.textContent = message;
  }

  async function loadUploadedContent(markdownFile: File, sidecarFile: File | null): Promise<void> {
    if (!editor) {
      return;
    }

    suppressPanelRendering = true;

    try {
      const markdownText = await markdownFile.text();
      const html = await renderMarkdownToHtml(markdownText);
      currentDocumentPath = `/${markdownFile.name}`;
      currentSidecarPath = sidecarFile
        ? `/${sidecarFile.name}`
        : `/${markdownFile.name}.review.yaml`;

      editor.commands.setContent(html);
      const renderedText = getDocumentText(editor.state.doc);
      hostSnapshot.documentText = renderedText;

      if (sidecarFile) {
        const sidecarText = await sidecarFile.text();
        const uploadedSidecar = parseSidecarContent(sidecarText, sidecarFile.name);
        hostSnapshot.sidecar = prepareUploadedCommentAnchors(
          prepareUploadedSidecar(uploadedSidecar, currentDocumentPath),
          markdownText,
          renderedText,
        );
      } else {
        hostSnapshot.sidecar = createEmptySidecar(currentDocumentPath);
      }

      lastSavedAt = "Loaded from uploads";
      await getTiptapMrsfController(editor)?.loadCurrent("external");
      currentState = getTiptapMrsfController(editor)?.getState() ?? null;
      rememberCommentSelection(editor.state);
      renderPanels();
      refreshToolbarState();
      updateSelectionAction();

      setUploadStatus(
        sidecarFile
          ? `Loaded ${markdownFile.name} with ${sidecarFile.name}.`
          : `Loaded ${markdownFile.name} without a sidecar.`,
      );
      setStatus("Uploaded Markdown rendered with rehype");
    } finally {
      suppressPanelRendering = false;
    }
  }

  function updateIndicators(state: ReviewState | null): void {
    const dirty = state?.dirty ?? false;
    const hasPendingShifts = state?.hasPendingShifts ?? false;

    saveIndicator.textContent = dirty ? "Unsaved" : "Saved";
    saveIndicator.className = `meta-pill ${dirty ? "meta-pill-dirty" : "meta-pill-clean"}`;

    anchorIndicator.textContent = hasPendingShifts ? "Anchors shifted in memory" : "Anchors in sync";
    anchorIndicator.className = `meta-pill ${hasPendingShifts ? "meta-pill-warning" : "meta-pill-clean"}`;

    lastSaved.textContent = lastSavedAt;
    editorSummary.textContent = dirty
      ? "The editor has local review changes. Write Host Snapshot to persist the sidecar, or Reload Sidecar to discard host-side differences."
      : "Select text and click Add Comment to create a review thread. Click a highlighted range to open the default thread popover and manage the thread in place.";
  }

  function summarizeStateForPanel(state: ReviewState | null) {
    if (!state) {
      return null;
    }

    const openComments = state.document.comments.filter((comment) => !comment.resolved).length;
    const projectedInlineComments = state.projectedDocument.comments
      .filter((comment) => !comment.reply_to && comment.start_column != null && comment.end_column != null)
      .slice(0, 12)
      .map((comment) => ({
        id: comment.id,
        line: comment.line ?? null,
        end_line: comment.end_line ?? null,
        start_column: comment.start_column ?? null,
        end_column: comment.end_column ?? null,
        selected_text: comment.selected_text ?? null,
      }));

    return {
      dirty: state.dirty,
      hasPendingShifts: state.hasPendingShifts,
      lastReanchorResults: state.lastReanchorResults.slice(0, 10),
      counts: {
        comments: state.document.comments.length,
        openComments,
        resolvedComments: state.document.comments.length - openComments,
        gutterMarks: state.snapshot.gutterMarks.length,
        inlineRanges: state.snapshot.inlineRanges.length,
        orphanedCommentIds: state.snapshot.orphanedCommentIds.length,
      },
      visibleThreads: state.snapshot.threadsByLine.slice(0, 20),
      projectedInlineComments,
      truncated: {
        visibleThreads: Math.max(0, state.snapshot.threadsByLine.length - 20),
        projectedInlineComments: Math.max(0, state.projectedDocument.comments.length - projectedInlineComments.length),
      },
    };
  }

  function summarizeHostSnapshot() {
    const lineCount = hostSnapshot.documentText ? hostSnapshot.documentText.split("\n").length : 0;

    return {
      documentPath: currentDocumentPath,
      sidecarPath: currentSidecarPath,
      lineCount,
      characterCount: hostSnapshot.documentText.length,
      sidecarCommentCount: hostSnapshot.sidecar?.comments.length ?? 0,
      sidecarPreview: hostSnapshot.sidecar
        ? {
            document: hostSnapshot.sidecar.document,
            mrsf_version: hostSnapshot.sidecar.mrsf_version,
            firstComments: hostSnapshot.sidecar.comments.slice(0, 8).map((comment) => ({
              id: comment.id,
              line: comment.line ?? null,
              end_line: comment.end_line ?? null,
              start_column: comment.start_column ?? null,
              end_column: comment.end_column ?? null,
              selected_text: comment.selected_text ?? null,
              reply_to: comment.reply_to ?? null,
            })),
            truncatedComments: Math.max(0, hostSnapshot.sidecar.comments.length - 8),
          }
        : null,
    };
  }

  function renderStatusPanel(state: ReviewState | null): void {
    if (!state) {
      statusPanel.innerHTML = "";
      return;
    }

    const openComments = state.document.comments.filter((comment) => !comment.resolved).length;
    const resolvedComments = state.document.comments.length - openComments;
    const inlineRanges = state.snapshot.inlineRanges.length;
    const threads = state.snapshot.threadsByLine.reduce((sum, entry) => sum + entry.threads.length, 0);

    statusPanel.innerHTML = [
      ["Comments", String(state.document.comments.length)],
      ["Open", String(openComments)],
      ["Resolved", String(resolvedComments)],
      ["Threads", String(threads)],
      ["Inline highlights", String(inlineRanges)],
      ["Line-only threads", String(getLineOnlyRootComments(state).length)],
      ["Pending shifts", state.hasPendingShifts ? "Yes" : "No"],
    ].map(([label, value]) => `
      <div class="status-row">
        <span class="status-label">${label}</span>
        <strong class="status-value">${value}</strong>
      </div>
    `).join("");
  }

  function renderPanels(): void {
    renderStatusPanel(currentState);
    stateOutput.textContent = JSON.stringify(summarizeStateForPanel(currentState), null, 2);
    hostOutput.textContent = JSON.stringify(summarizeHostSnapshot(), null, 2);
    updateIndicators(currentState);
  }

  function schedulePanelRender(): void {
    if (suppressPanelRendering || panelRenderScheduled) {
      return;
    }

    panelRenderScheduled = true;
    requestAnimationFrame(() => {
      panelRenderScheduled = false;
      if (suppressPanelRendering) {
        return;
      }

      renderPanels();
    });
  }

  function getLineOnlyRootComments(state: ReviewState): Array<ReviewState["document"]["comments"][number]> {
    const inlineIds = new Set(state.snapshot.inlineRanges.map((entry) => entry.commentId));
    return state.document.comments.filter((comment) =>
      !comment.reply_to
      && comment.line != null
      && !inlineIds.has(comment.id),
    );
  }

  function refreshToolbarState(): void {
    if (!editor) {
      return;
    }

    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-command]")) {
      const command = button.dataset.command;
      const level = Number(button.dataset.level || "0");
      let active = false;

      if (command === "bold") active = editor.isActive("bold");
      if (command === "italic") active = editor.isActive("italic");
      if (command === "bulletList") active = editor.isActive("bulletList");
      if (command === "heading") active = editor.isActive("heading", level ? { level } : undefined);

      button.classList.toggle("is-active", active);
    }
  }

  function rememberCommentSelection(state: EditorState): void {
    const { from, to } = state.selection;
    if (from !== to) {
      lastCommentSelection = { from, to };
    }
  }

  function hideSelectionAction(): void {
    selectionAction.classList.add("is-hidden");
  }

  function updateSelectionAction(): void {
    if (!editor) {
      hideSelectionAction();
      return;
    }

    const { from, to } = editor.state.selection;
    if (from === to || !editor.isFocused) {
      hideSelectionAction();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideSelectionAction();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = editorStage.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      hideSelectionAction();
      return;
    }

    const left = Math.max(24, Math.min(containerRect.width - 24, rect.left - containerRect.left + rect.width / 2));
    const top = Math.max(16, rect.top - containerRect.top - 10);
    selectionAction.style.left = `${left}px`;
    selectionAction.style.top = `${top}px`;
    selectionAction.classList.remove("is-hidden");
  }

  function promptAndAddSelectionComment(): void {
    if (!editor) {
      return;
    }

    const currentSelection = editor.state.selection;
    const selection = currentSelection.from !== currentSelection.to
      ? { from: currentSelection.from, to: currentSelection.to }
      : lastCommentSelection;

    if (selection) {
      editor.chain().focus().setTextSelection(selection).run();
    }

    const { from, to } = editor.state.selection;
    if (from === to) {
      setStatus("Select text to add a comment");
      hideSelectionAction();
      return;
    }

    const selectedText = editor.state.doc.textBetween(from, to, "\n", "\n");

    void openTiptapMrsfFormDialog({
      action: "add",
      initialSeverity: "medium",
      initialType: "note",
      selectionText: selectedText,
      targetDocument: editorContainer.ownerDocument,
      themeSource: editorStage,
      title: "Add review comment",
    }).then((result) => {
      if (!result) {
        setStatus("Add comment cancelled");
        return;
      }

      editor?.commands.mrsfAddComment(result.text, {
        author: "Browser Demo",
        severity: result.severity ?? undefined,
        type: result.type ?? undefined,
      });
      hideSelectionAction();
      setStatus("Comment added");
    });
  }

  const handleCommentClick = (event: TiptapMrsfCommentClickEvent) => {
    if (!editor) {
      return;
    }

    return createTiptapMrsfThreadPopoverHandler(editor, {
      onOpen(thread) {
        setStatus(`Opened thread on line ${thread.line}`);
      },
      onClose() {
        setStatus("Closed thread popover");
      },
      themeSource: editorStage,
    })(event);
  };

  editor = new Editor({
  element: editorContainer,
  extensions: [
    StarterKit,
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    createTiptapMrsfExtension(host, {
      resourceId,
      defaultAuthor: "Browser Demo",
      gutterPosition: "left",
      gutterForInline: true,
      lineHighlight: true,
      onCommentClick: handleCommentClick,
      onStateChange: ({ state, source }) => {
        currentState = state;
        schedulePanelRender();
        setStatus(
          source === "save"
            ? "Host snapshot written"
            : source === "reanchor"
              ? "Current sidecar reanchored"
              : source === "external"
                ? "Reloaded sidecar from host"
                : source === "content"
                  ? "Editor content updated"
                  : "Review state updated",
        );
      },
      onSaveRequest: async ({ defaultSave }) => {
        await defaultSave();
        schedulePanelRender();
      },
    }),
  ],
  content: initialHtml,
  onSelectionUpdate() {
    rememberCommentSelection(editor.state);
    refreshToolbarState();
    updateSelectionAction();
  },
  onUpdate({ editor: nextEditor }) {
    hostSnapshot.documentText = nextEditor.getText({ blockSeparator: "\n" });
    rememberCommentSelection(nextEditor.state);
    refreshToolbarState();
    updateSelectionAction();
    schedulePanelRender();
  },
  onBlur() {
    hideSelectionAction();
  },
  });

  await getTiptapMrsfController(editor)?.loadCurrent();
  currentState = getTiptapMrsfController(editor)?.getState() ?? null;
  rememberCommentSelection(editor.state);
  renderPanels();
  refreshToolbarState();
  updateSelectionAction();

  toolbar.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-command]");
    if (!button || !editor) {
      return;
    }

    const command = button.dataset.command;
    const chain = editor.chain().focus();
    if (command === "bold") chain.toggleBold().run();
    if (command === "italic") chain.toggleItalic().run();
    if (command === "bulletList") chain.toggleBulletList().run();
    if (command === "heading") chain.toggleHeading({ level: Number(button.dataset.level || "2") as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    refreshToolbarState();
  });

  addCommentButton.addEventListener("click", () => {
    promptAndAddSelectionComment();
  });

  addCommentButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  selectionAddCommentButton.addEventListener("click", () => {
    promptAndAddSelectionComment();
  });

  selectionAddCommentButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  document.addEventListener("scroll", () => {
    updateSelectionAction();
  }, true);

  window.addEventListener("resize", () => {
    updateSelectionAction();
  });

  saveSidecarButton.addEventListener("click", () => {
    if (!editor) {
      return;
    }

    editor.commands.mrsfSave("manual");
  });

  reloadSidecarButton.addEventListener("click", () => {
    if (!editor) {
      return;
    }

    editor.commands.mrsfReload();
  });

  reanchorSidecarButton.addEventListener("click", () => {
    if (!editor) {
      return;
    }

    editor.commands.mrsfReanchor({ updateText: true });
  });

  externalSidecarButton.addEventListener("click", () => {
    if (!hostSnapshot.sidecar) {
      return;
    }

    const anchor = getInlineAnchor(
      hostSnapshot.documentText,
      "Reload pulls the latest sidecar from the host.",
      "latest sidecar",
    );

    hostSnapshot.sidecar.comments = [
      ...hostSnapshot.sidecar.comments,
      {
        id: `external-${Date.now()}`,
        author: "External Host",
        timestamp: new Date().toISOString(),
        text: "This comment came from outside the editor. Use Reload Sidecar to pull it into the active review state.",
        resolved: false,
        ...anchor,
        severity: "medium",
        type: "note",
      },
    ];

    schedulePanelRender();
    setStatus("External sidecar change queued");
  });

  loadUploadsButton.addEventListener("click", () => {
    const markdownFile = markdownUploadInput.files?.[0] ?? null;
    const sidecarFile = sidecarUploadInput.files?.[0] ?? null;

    if (!markdownFile) {
      setUploadStatus("Choose a Markdown file before loading uploads.");
      setStatus("Upload requires a Markdown file");
      return;
    }

    setUploadStatus("Loading uploaded files...");
    void loadUploadedContent(markdownFile, sidecarFile).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setUploadStatus(`Failed to load uploads: ${message}`);
      setStatus("Upload failed");
      console.error(error);
    });
  });
}

void main().catch((error) => {
  console.error(error);
});
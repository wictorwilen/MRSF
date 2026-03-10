import type { Comment, MrsfDocument, ReanchorResult } from "@mrsf/cli/browser";

export interface EditorPoint {
  lineIndex: number;
  column: number;
}

export interface EditorRange {
  start: EditorPoint;
  end: EditorPoint;
}

export type EditorSelection = EditorRange;

export interface EditorContentChange {
  range: EditorRange;
  text: string;
}

export interface AnchorFields {
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
}

export interface DocumentGeometry {
  lineCount: number;
  getLineLength(lineIndex: number): number;
}

export interface ThreadProjectionOptions {
  showResolved?: boolean;
  geometry?: DocumentGeometry;
}

export interface RenderedThreadSnapshot {
  line: number;
  rootCommentId: string;
  commentIds: string[];
  replyCount: number;
  resolved: boolean;
  highestSeverity: string | null;
  range?: EditorRange;
}

export interface LineThreadSnapshot {
  line: number;
  threads: RenderedThreadSnapshot[];
}

export interface GutterMarkSnapshot {
  line: number;
  threadCount: number;
  commentCount: number;
  resolvedState: "open" | "resolved" | "mixed";
  highestSeverity: string | null;
}

export interface InlineDecorationSnapshot {
  commentId: string;
  line: number;
  selectedText: string | null;
  resolved: boolean;
  severity: string | null;
  range: EditorRange;
}

export interface HoverTargetSnapshot {
  line: number;
  commentIds: string[];
  range?: EditorRange;
}

export interface DecorationSnapshot {
  threadsByLine: LineThreadSnapshot[];
  gutterMarks: GutterMarkSnapshot[];
  inlineRanges: InlineDecorationSnapshot[];
  hoverTargets: HoverTargetSnapshot[];
  documentLevelCommentIds: string[];
  orphanedCommentIds: string[];
}

export interface ReviewLoadResult {
  document: MrsfDocument;
  sidecarPath: string | null;
}

export interface MonacoMrsfPluginOptions {
  resourceId: string;
  showResolved?: boolean;
  inlineHighlights?: boolean;
  gutterIcons?: boolean;
  hover?: boolean;
}

export interface CommentDraft extends AnchorFields {
  text: string;
  author?: string;
  selected_text?: string;
  severity?: Comment["severity"];
  type?: Comment["type"];
}

export interface ReviewActionRequest {
  resourceId: string;
  action: "add" | "edit" | "reply" | "resolve" | "unresolve" | "delete" | "navigate" | "reanchor";
  commentId?: string;
  selection?: EditorSelection;
  draft?: CommentDraft;
}

export interface ReviewReanchorOptions {
  threshold?: number;
  updateText?: boolean;
  force?: boolean;
  autoSave?: boolean;
}

export interface ReviewState {
  resourceId: string;
  document: MrsfDocument;
  sidecarPath: string | null;
  documentPath: string | null;
  documentLines: string[];
  snapshot: DecorationSnapshot;
  loaded: boolean;
  dirty: boolean;
  hasPendingShifts: boolean;
  lastReanchorResults: ReanchorResult[];
}

export interface ReviewThread {
  line: number;
  rootComment: Comment;
  replies: Comment[];
}

export interface ReviewLoadOptions {
  geometry?: DocumentGeometry;
  documentText?: string;
}

export type MonacoMrsfStateChangeSource =
  | "load"
  | "external"
  | "refresh"
  | "content"
  | "save"
  | "reanchor";

export interface MonacoMrsfStateChangeEvent {
  resourceId: string;
  state: ReviewState;
  dirty: boolean;
  hasPendingShifts: boolean;
  source: MonacoMrsfStateChangeSource;
}

export interface MonacoMrsfPluginSaveOptions {
  reason?: string;
}

export interface MonacoMrsfPluginSaveRequest {
  resourceId: string;
  state: ReviewState;
  reason: string;
  defaultSave: () => Promise<void>;
}

export interface MonacoDecorationClasses {
  lineOpen: string;
  lineResolved: string;
  lineMixed: string;
  lineHigh: string;
  lineMedium: string;
  lineLow: string;
  inlineBase: string;
  inlineResolved: string;
  inlineHigh: string;
  inlineMedium: string;
  inlineLow: string;
}

export interface MonacoDecorationOptions {
  showResolved?: boolean;
  gutterIcons?: boolean;
  inlineHighlights?: boolean;
  hover?: boolean;
  decorationZIndex?: number;
  classes?: Partial<MonacoDecorationClasses>;
}

export interface MonacoDecorationSet {
  gutter: import("monaco-editor").editor.IModelDeltaDecoration[];
  inline: import("monaco-editor").editor.IModelDeltaDecoration[];
}

export interface MonacoActionContext {
  resourceId: string;
  state: ReviewState;
  line: number;
  selection: EditorSelection | null;
  thread?: ReviewThread;
}

export interface MonacoActionHandlers {
  createCommentDraft?(
    context: MonacoActionContext,
  ): Promise<Partial<CommentDraft> | null> | Partial<CommentDraft> | null;
  createReplyDraft?(
    context: MonacoActionContext,
  ): Promise<Partial<Omit<CommentDraft, "line">> | null> | Partial<Omit<CommentDraft, "line">> | null;
}
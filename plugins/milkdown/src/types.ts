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
  inline: boolean;
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

export interface CommentDraft extends AnchorFields {
  text: string;
  author?: string;
  selected_text?: string;
  severity?: Comment["severity"];
  type?: Comment["type"];
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

export interface ReviewReanchorOptions {
  threshold?: number;
  updateText?: boolean;
  force?: boolean;
  autoSave?: boolean;
}

export interface ReviewState {
  resourceId: string;
  document: MrsfDocument;
  projectedDocument: MrsfDocument;
  sidecarPath: string | null;
  documentPath: string | null;
  documentLines: string[];
  /**
   * The original markdown source text as provided by the host at load time
   * (or via the most recent host re-read). Used to build the
   * SourceLineMap that translates between markdown source line numbers
   * (the spec coordinate system) and PM-text-model line indices (what
   * decorations need). Stays anchored to the on-disk markdown — live PM
   * edits do NOT mutate this; the map staleness is bounded by how much
   * the user has edited since the last sidecar load/save.
   */
  sourceText: string;
  snapshot: DecorationSnapshot;
  loaded: boolean;
  dirty: boolean;
  hasPendingShifts: boolean;
  lastReanchorResults: ReanchorResult[];
}

export type MilkdownMrsfStateChangeSource =
  | "load"
  | "external"
  | "refresh"
  | "content"
  | "save"
  | "reanchor";

export interface MilkdownMrsfStateChangeEvent {
  resourceId: string;
  state: ReviewState;
  dirty: boolean;
  hasPendingShifts: boolean;
  source: MilkdownMrsfStateChangeSource;
}

export interface MilkdownMrsfPluginSaveOptions {
  reason?: string;
}

export interface MilkdownMrsfPluginSaveRequest {
  resourceId: string;
  state: ReviewState;
  reason: string;
  defaultSave: () => Promise<void>;
}

export interface MilkdownMrsfComposeResult {
  text: string;
  severity?: Comment["severity"];
  type?: Comment["type"];
}

export type MilkdownMrsfLiveTrackingMode = "eager" | "debounced" | "save-only";

export interface MilkdownMrsfSelectionActionContext {
  selection: EditorSelection;
  selectedText: string;
}

export interface MilkdownMrsfTooltipActionContext {
  comment: Comment;
  thread: ReviewThread;
}

export interface MilkdownMrsfControllerOptions {
  resourceId: string;
  showResolved?: boolean;
  inlineHighlights?: boolean;
  liveTracking?: MilkdownMrsfLiveTrackingMode;
  showSelectionAddButton?: boolean;
  defaultAuthor?: string;
  onStateChange?: (event: MilkdownMrsfStateChangeEvent) => void;
  onSaveRequest?: (request: MilkdownMrsfPluginSaveRequest) => void | Promise<void>;
  interactive?: boolean;
  onCommentSelect?: (commentId: string) => void;
  composeAdd?: (context: MilkdownMrsfSelectionActionContext) => MilkdownMrsfComposeResult | null | Promise<MilkdownMrsfComposeResult | null>;
  composeReply?: (context: MilkdownMrsfTooltipActionContext) => MilkdownMrsfComposeResult | null | Promise<MilkdownMrsfComposeResult | null>;
  composeEdit?: (context: MilkdownMrsfTooltipActionContext) => MilkdownMrsfComposeResult | null | Promise<MilkdownMrsfComposeResult | null>;
  confirmDelete?: (context: MilkdownMrsfTooltipActionContext) => boolean | Promise<boolean>;
}
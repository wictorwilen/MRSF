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
  snapshot: DecorationSnapshot;
  loaded: boolean;
  dirty: boolean;
  hasPendingShifts: boolean;
  lastReanchorResults: ReanchorResult[];
}

export type TiptapMrsfStateChangeSource =
  | "load"
  | "external"
  | "refresh"
  | "content"
  | "save"
  | "reanchor";

export interface TiptapMrsfStateChangeEvent {
  resourceId: string;
  state: ReviewState;
  dirty: boolean;
  hasPendingShifts: boolean;
  source: TiptapMrsfStateChangeSource;
}

export interface TiptapMrsfPluginSaveOptions {
  reason?: string;
}

export interface TiptapMrsfPluginSaveRequest {
  resourceId: string;
  state: ReviewState;
  reason: string;
  defaultSave: () => Promise<void>;
}

export interface TiptapMrsfCommentClickEvent {
  resourceId: string;
  commentId: string;
  comment: Comment;
  state: ReviewState;
  anchorRect?: DOMRect | null;
}

export interface TiptapMrsfDialogFormResult {
  text: string;
  type: Comment["type"] | null;
  severity: Comment["severity"] | null;
}

export interface TiptapMrsfDialogThemeOptions {
  targetDocument?: Document;
  themeSource?: HTMLElement | null;
}

export interface TiptapMrsfFormDialogOptions extends TiptapMrsfDialogThemeOptions {
  action: "add" | "reply" | "edit";
  title?: string;
  initialText?: string;
  initialType?: Comment["type"] | null;
  initialSeverity?: Comment["severity"] | null;
  selectionText?: string | null;
}

export interface TiptapMrsfConfirmDialogOptions extends TiptapMrsfDialogThemeOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

export type TiptapMrsfTheme = "light" | "dark" | "auto";

export type TiptapMrsfGutterPosition = "left" | "right";

export interface TiptapMrsfDisplayOptions {
  interactive?: boolean;
  inlineHighlights?: boolean;
  gutterPosition?: TiptapMrsfGutterPosition;
  gutterForInline?: boolean;
  lineHighlight?: boolean;
  theme?: TiptapMrsfTheme;
}

export interface TiptapMrsfPluginControllerOptions extends TiptapMrsfDisplayOptions {
  resourceId: string;
  showResolved?: boolean;
  defaultAuthor?: string;
  onStateChange?: (event: TiptapMrsfStateChangeEvent) => void;
  onSaveRequest?: (request: TiptapMrsfPluginSaveRequest) => void | Promise<void>;
  onCommentClick?: (event: TiptapMrsfCommentClickEvent) => void;
}

export interface TiptapMrsfExtensionOptions extends TiptapMrsfPluginControllerOptions {
  name?: string;
}

export interface TiptapMrsfStorage {
  controller: import("./TiptapMrsfPlugin.js").TiptapMrsfPlugin | null;
}

export interface TiptapMrsfThreadPopoverOptions {
  commentId?: string;
  anchorRect?: DOMRect | null;
  interactive?: boolean;
  theme?: TiptapMrsfTheme;
  title?: string;
  onReply?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
  onResolve?: (commentId: string) => void;
  onUnresolve?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onClose?: () => void;
}

export interface TiptapMrsfThreadPopoverHandlerOptions {
  name?: string;
  title?: string;
  interactive?: boolean;
  theme?: TiptapMrsfTheme;
  targetDocument?: Document;
  themeSource?: HTMLElement | null;
  composeReply?: (comment: Comment, thread: ReviewThread) => TiptapMrsfDialogFormResult | null | Promise<TiptapMrsfDialogFormResult | null>;
  composeEdit?: (comment: Comment, thread: ReviewThread) => TiptapMrsfDialogFormResult | null | Promise<TiptapMrsfDialogFormResult | null>;
  confirmDelete?: (comment: Comment, thread: ReviewThread) => boolean | Promise<boolean>;
  onOpen?: (thread: ReviewThread) => void;
  onClose?: () => void;
}
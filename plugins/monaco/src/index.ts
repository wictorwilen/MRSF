export type {
  AnchorFields,
  CommentDraft,
  DecorationSnapshot,
  DocumentGeometry,
  EditorContentChange,
  EditorPoint,
  EditorRange,
  EditorSelection,
  GutterMarkSnapshot,
  HoverTargetSnapshot,
  InlineDecorationSnapshot,
  LineThreadSnapshot,
  MonacoActionContext,
  MonacoActionHandlers,
  MonacoDecorationClasses,
  MonacoDecorationOptions,
  MonacoDecorationSet,
  MonacoMrsfPluginSaveOptions,
  MonacoMrsfPluginSaveRequest,
  MonacoMrsfStateChangeEvent,
  MonacoMrsfStateChangeSource,
  MonacoMrsfPluginOptions,
  RenderedThreadSnapshot,
  ReviewActionRequest,
  ReviewLoadOptions,
  ReviewLoadResult,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
  ThreadProjectionOptions,
} from "./types.js";

export type {
  HostDisposer,
  MonacoMrsfHostAdapter,
} from "./host/HostAdapter.js";

export { splitDocumentLines } from "./host/HostAdapter.js";

export {
  MemoryHostAdapter,
} from "./host/MemoryHostAdapter.js";

export { MemoryHostSession } from "./host/MemoryHostSession.js";

export {
  comparePoints,
  normalizeRange,
  commentToEditorRange,
  selectionToAnchor,
  isInlineComment,
  isDocumentLevelComment,
} from "./core/positions.js";

export { applyLineShifts } from "./core/liveLineTracker.js";

export { projectDecorationSnapshot } from "./core/threadProjection.js";

export { ReviewStore } from "./core/ReviewStore.js";

export {
  createMonacoDecorationSet,
  defaultMonacoDecorationClasses,
  injectDefaultMonacoDecorationStyles,
} from "./MonacoDecorations.js";

export { MonacoThreadOverlay } from "./MonacoThreadOverlay.js";

export {
  buildHoverContents,
  createMonacoHoverProvider,
} from "./MonacoHover.js";

export {
  openMrsfConfirmDialog,
  openMrsfFormDialog,
} from "./ui/dialogs.js";

export {
  escapeHtml,
  renderReviewThreadHtml,
} from "./ui/threadHtml.js";

export {
  registerMonacoActions,
} from "./MonacoActions.js";

export {
  MonacoViewAdapter,
} from "./MonacoViewAdapter.js";

export {
  MonacoMrsfPlugin,
  type MonacoMrsfPluginControllerOptions,
} from "./MonacoMrsfPlugin.js";
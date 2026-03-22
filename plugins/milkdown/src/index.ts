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
  MilkdownMrsfControllerOptions,
  MilkdownMrsfPluginSaveOptions,
  MilkdownMrsfPluginSaveRequest,
  MilkdownMrsfStateChangeEvent,
  MilkdownMrsfStateChangeSource,
  RenderedThreadSnapshot,
  ReviewLoadOptions,
  ReviewReanchorOptions,
  ReviewState,
  ReviewThread,
  ThreadProjectionOptions,
} from "./types.js";
export type { MilkdownMrsfPluginOptions } from "./milkdown.js";

export type { HostDisposer, MilkdownMrsfHostAdapter } from "./host/HostAdapter.js";

export type { Comment, DiffHunk, MrsfDocument, ReanchorResult, ReanchorStatus } from "@mrsf/cli/browser";

export { MilkdownMrsfController } from "./MilkdownMrsfController.js";
export {
  createCrepeMrsfFeature,
  getCrepeMrsfController,
  getCrepeMrsfDecorationState,
  getCrepeMrsfSelectedText,
  getCrepeMrsfSelection,
} from "./crepe.js";
export {
  createMilkdownMrsfPlugin,
  getMilkdownMrsfController,
  getMilkdownMrsfDecorationState,
  getMilkdownMrsfSelectedText,
  getMilkdownMrsfSelection,
  milkdownMrsfControllerCtx,
} from "./milkdown.js";
export { splitDocumentLines } from "./host/HostAdapter.js";
export { ReviewStore } from "./core/ReviewStore.js";
export { addComment, populateSelectedText, removeComment, resolveComment, setSelectedText, unresolveComment } from "./core/browserComments.js";
export { buildInlineDecorations } from "./core/decorations.js";
export { applyLineShifts } from "./core/liveLineTracker.js";
export {
  comparePoints,
  normalizeRange,
  commentToEditorRange,
  selectionToAnchor,
  isInlineComment,
  isDocumentLevelComment,
} from "./core/positions.js";
export { projectDecorationSnapshot } from "./core/threadProjection.js";
export {
  createLineIndex,
  diffTextChange,
  geometryFromText,
  getDocumentText,
  getSelectedText,
  offsetToPoint,
  pmPosToTextOffset,
  pointToOffset,
  rangeFromOffsets,
  selectionToEditorSelection,
  textOffsetToPmPos,
} from "./core/textModel.js";
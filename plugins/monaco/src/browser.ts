export type {
	AnchorFields,
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
	MonacoDecorationClasses,
	MonacoDecorationOptions,
	MonacoDecorationSet,
	RenderedThreadSnapshot,
	ReviewState,
	ReviewThread,
	ThreadProjectionOptions,
} from "./types.js";

export type {
	HostDisposer,
	MonacoMrsfHostAdapter,
} from "./host/HostAdapter.js";

export type {
	Comment,
	DiffHunk,
	MrsfDocument,
	ReanchorResult,
	ReanchorStatus,
} from "@mrsf/cli/browser";

export {
	applyReanchorResults,
	DEFAULT_THRESHOLD,
	HIGH_THRESHOLD,
	reanchorComment,
	reanchorDocumentLines,
	reanchorDocumentText,
	toReanchorLines,
} from "@mrsf/cli/browser";

export { splitDocumentLines } from "./host/HostAdapter.js";
export { MemoryHostAdapter } from "./host/MemoryHostAdapter.js";

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

export {
	createMonacoDecorationSet,
	defaultMonacoDecorationClasses,
	injectDefaultMonacoDecorationStyles,
} from "./MonacoDecorations.js";

export { MonacoThreadOverlay } from "./MonacoThreadOverlay.js";

export { MonacoViewAdapter } from "./MonacoViewAdapter.js";

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
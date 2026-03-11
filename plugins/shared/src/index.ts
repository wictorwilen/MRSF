/**
 * @mrsf/plugin-shared — Shared internals for MRSF rendering plugins.
 */

export type {
  MrsfPluginOptions,
  SlimComment,
  CommentThread,
  LineMap,
  CommentLoader,
} from "./types.js";

export type {
  MrsfBadgeSource,
  MrsfGutterAddButtonContext,
  MrsfGutterAddButtonPresentation,
  MrsfGutterAddButtonRenderContext,
  MrsfGutterBadgeContext,
  MrsfGutterBadgePresentation,
  MrsfGutterBadgeRenderContext,
  MrsfGutterRenderers,
  MrsfResolvedState,
} from "./gutter.js";

export {
  toSlimComments,
  groupByLine,
  resolveComments,
} from "./comments.js";

export {
  escapeHtml,
  formatTime,
  renderCommentHtml,
  renderThreadHtml,
} from "./html.js";

export {
  createMrsfGutterAddButtonPresentation,
  createMrsfGutterBadgePresentation,
  formatMrsfCount,
  resolveMrsfGutterAddButtonPresentation,
  resolveMrsfGutterBadgePresentation,
} from "./gutter.js";

/**
 * @mrsf/plugin-shared — Shared internals for MRSF rendering plugins.
 */

export type {
  MrsfPluginOptions,
  SlimComment,
  CommentThread,
  LineMap,
} from "./types.js";

export type { CommentLoader } from "./comments.js";

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

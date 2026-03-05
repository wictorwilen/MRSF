/* ---------------------------------------------------------------
 * AUTO-GENERATED — DO NOT EDIT
 *
 * Source: plugins/shared/src/types.ts
 * Run `node plugins/sync-types.mjs` to regenerate.
 * --------------------------------------------------------------- */

/**
 * Shared type definitions for MRSF rendering plugins.
 *
 * These types are used by both @mrsf/markdown-it-mrsf and @mrsf/rehype-mrsf.
 */

import type { MrsfDocument } from "@mrsf/cli";

/** Base options shared by all MRSF rendering plugins. */
export interface MrsfPluginOptions {
  /**
   * Path to the Markdown document on disk.
   * Used for auto-discovery of the sidecar file via `@mrsf/cli`.
   */
  documentPath?: string;

  /**
   * Explicit path to the `.review.yaml` or `.review.json` sidecar file.
   * Takes precedence over auto-discovery.
   */
  sidecarPath?: string;

  /**
   * Pre-loaded MRSF sidecar data.
   * Takes precedence over `loader`, `sidecarPath`, and `documentPath`.
   * Enables browser use, custom pipelines, and testing.
   */
  comments?: MrsfDocument;

  /**
   * Custom loader function that returns sidecar data.
   * Takes precedence over `sidecarPath` and `documentPath`.
   * Useful for integrations that manage their own sidecar state.
   */
  loader?: () => MrsfDocument | null;

  /** Whether to show resolved comments (default: true). */
  showResolved?: boolean;

  /**
   * Enable interactive mode — adds action buttons with `data-mrsf-action`
   * attributes for host applications to hook into (default: false).
   */
  interactive?: boolean;

  /**
   * Position of the gutter badge relative to the line content.
   * - `'left'`: badge in a left margin gutter, outside the content area
   * - `'tight'`: badge inline, immediately before the text
   * - `'right'`: badge floated to the right of the content (default)
   */
  gutterPosition?: "left" | "tight" | "right";

  /**
   * Whether to show the gutter badge on lines that have inline-highlighted
   * comments (i.e. comments with `selected_text`). When false, lines where
   * ALL comments have inline highlights will not get a gutter badge — the
   * inline tooltip is the only way to view the comment. Default: true.
   */
  gutterForInline?: boolean;

  /**
   * Whether to render inline text highlights for comments that have
   * `selected_text`. When false, only gutter badges are shown.
   * Default: true.
   */
  inlineHighlights?: boolean;

  /** Color scheme hint (default: 'auto'). */
  theme?: "light" | "dark" | "auto";

  /** Working directory for sidecar discovery (default: process.cwd()). */
  cwd?: string;
}

/** Slim comment shape used internally after loading. */
export interface SlimComment {
  id: string;
  author: string;
  text: string;
  line: number | null;
  end_line: number | null;
  start_column: number | null;
  end_column: number | null;
  selected_text: string | null;
  resolved: boolean;
  reply_to: string | null;
  severity: string | null;
  type: string | null;
  timestamp: string | null;
}

/** A root comment with its threaded replies. */
export interface CommentThread {
  comment: SlimComment;
  replies: SlimComment[];
}

/** Comments grouped by their anchored source line. */
export type LineMap = Map<number, CommentThread[]>;

/** A function that loads sidecar data from plugin options. */
export type CommentLoader = (options: MrsfPluginOptions) => MrsfDocument | null;

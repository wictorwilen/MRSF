/**
 * MRSF Types — shared type definitions for the MRSF CLI and library.
 */

// ---------------------------------------------------------------------------
// MRSF Document
// ---------------------------------------------------------------------------

/** A parsed MRSF sidecar document. */
export interface MrsfDocument {
  mrsf_version: string;
  document: string;
  comments: Comment[];
  /** Catch-all for unknown / x_-prefixed extension fields at the top level. */
  [key: string]: unknown;
}

/** A single review comment. */
export interface Comment {
  // Required
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;

  // Optional — anchoring
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  selected_text_hash?: string;
  anchored_text?: string;

  // Optional — metadata
  commit?: string;
  type?: string;
  severity?: "low" | "medium" | "high";
  reply_to?: string;

  /** Catch-all for unknown / x_-prefixed extension fields. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Configuration (.mrsf.yaml)
// ---------------------------------------------------------------------------

export interface MrsfConfig {
  sidecar_root?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = "error" | "warning";

export interface ValidationDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Path within the document, e.g. "/comments/0/end_line". */
  path?: string;
  /** The comment id this diagnostic relates to, if applicable. */
  commentId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationDiagnostic[];
  warnings: ValidationDiagnostic[];
}

// ---------------------------------------------------------------------------
// Re-anchoring
// ---------------------------------------------------------------------------

export type ReanchorStatus =
  | "anchored"       // exact match, high confidence
  | "shifted"        // diff-based line shift, text unchanged
  | "fuzzy"          // fuzzy match found
  | "ambiguous"      // multiple matches, cannot disambiguate
  | "orphaned";      // no match found

export interface ReanchorResult {
  commentId: string;
  status: ReanchorStatus;
  /** Confidence score 0.0–1.0; 1.0 for exact/shifted. */
  score: number;
  /** Updated line (if changed). */
  newLine?: number;
  newEndLine?: number;
  newStartColumn?: number;
  newEndColumn?: number;
  /** Text currently at the resolved anchor position (for anchored_text field). */
  anchoredText?: string;
  /** Previous selected_text before update (for audit / --update-text). */
  previousSelectedText?: string;
  /** Human-readable explanation of the resolution. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

export interface FuzzyCandidate {
  /** Matched text in the document. */
  text: string;
  /** 1-based start line of the match. */
  line: number;
  /** 1-based end line (inclusive). */
  endLine: number;
  /** 0-based start column on the start line. */
  startColumn: number;
  /** 0-based end column on the end line. */
  endColumn: number;
  /** Similarity score 0.0–1.0. */
  score: number;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export interface DiffHunk {
  /** Original file start line (1-based). */
  oldStart: number;
  /** Number of lines in the original. */
  oldCount: number;
  /** New file start line (1-based). */
  newStart: number;
  /** Number of lines in the new file. */
  newCount: number;
  /** Raw diff lines (prefixed with +, -, or space). */
  lines: string[];
}

// ---------------------------------------------------------------------------
// Comment operations
// ---------------------------------------------------------------------------

export interface AddCommentOptions {
  text: string;
  author: string;
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  type?: string;
  severity?: "low" | "medium" | "high";
  commit?: string;
  reply_to?: string;
  /** Override auto-generated id. */
  id?: string;
  /** Override auto-generated timestamp. */
  timestamp?: string;
}

export interface CommentFilter {
  open?: boolean;
  resolved?: boolean;
  orphaned?: boolean;
  author?: string;
  type?: string;
  severity?: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type AnchorHealth =
  | "fresh"          // commit matches HEAD, text matches
  | "stale"          // commit differs from HEAD
  | "orphaned"       // marked orphaned
  | "unknown";       // no commit or no git

export interface StatusResult {
  commentId: string;
  health: AnchorHealth;
  commitAge?: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

export interface BaseOptions {
  /** Working directory (defaults to process.cwd()). */
  cwd?: string;
  /** Path to .mrsf.yaml config. */
  configPath?: string;
}

export interface ReanchorOptions extends BaseOptions {
  /** Dry run — report without modifying files. */
  dryRun?: boolean;
  /** Fuzzy match threshold 0.0–1.0 (default 0.6). */
  threshold?: number;
  /** Write updated anchors back to sidecar. */
  autoUpdate?: boolean;
  /** Only process sidecars for staged Markdown files. */
  staged?: boolean;
  /** Disable git integration. */
  noGit?: boolean;
  /** Override from-commit for all comments. */
  fromCommit?: string;
  /** Update selected_text to match anchored_text (opt-in per §6.2). */
  updateText?: boolean;
}

export interface ValidateOptions extends BaseOptions {
  /** Treat warnings as errors. */
  strict?: boolean;
}

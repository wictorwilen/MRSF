/**
 * MRSF — Public API (library surface).
 *
 * Usage:
 *   import { validate, reanchorFile, addComment, ... } from "mrsf";
 */

// Types
export type {
  MrsfDocument,
  Comment,
  MrsfConfig,
  DiagnosticSeverity,
  ValidationDiagnostic,
  ValidationResult,
  ReanchorStatus,
  ReanchorResult,
  FuzzyCandidate,
  DiffHunk,
  AddCommentOptions,
  CommentFilter,
  AnchorHealth,
  StatusResult,
  BaseOptions,
  ReanchorOptions,
  ValidateOptions,
} from "./lib/types.js";

// Discovery
export {
  findWorkspaceRoot,
  loadConfig,
  discoverSidecar,
  sidecarToDocument,
  discoverAllSidecars,
} from "./lib/discovery.js";

// File resolution
export { resolveSidecarPaths } from "./lib/resolve-files.js";

// Parsing
export {
  parseSidecar,
  parseSidecarContent,
  readDocumentLines,
} from "./lib/parser.js";

// Writing
export {
  computeHash,
  syncHash,
  toYaml,
  toJson,
  writeSidecar,
} from "./lib/writer.js";

// Validation
export { validate, validateFile } from "./lib/validator.js";

// Fuzzy matching
export {
  exactMatch,
  normalizedMatch,
  fuzzySearch,
  combinedScore,
} from "./lib/fuzzy.js";

// Git
export {
  isGitAvailable,
  findRepoRoot,
  getCurrentCommit,
  isStale,
  getDiff,
  getLineShift,
  getFileAtCommit,
  getStagedFiles,
  detectRenames,
  parseDiffHunks,
} from "./lib/git.js";

// Re-anchoring
export {
  reanchorComment,
  reanchorDocument,
  applyReanchorResults,
  reanchorFile,
} from "./lib/reanchor.js";

// Comments
export {
  addComment,
  populateSelectedText,
  resolveComment,
  unresolveComment,
  removeComment,
  filterComments,
  getThreads,
  summarize,
} from "./lib/comments.js";
export type { CommentSummary } from "./lib/comments.js";

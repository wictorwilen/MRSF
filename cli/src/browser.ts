export type {
  Comment,
  DiffHunk,
  FuzzyCandidate,
  MrsfDocument,
  ReanchorResult,
  ReanchorStatus,
} from "./lib/types.js";

export {
  combinedScore,
  exactMatch,
  fuzzySearch,
  levenshteinScore,
  normalizedMatch,
  tokenLcsScore,
} from "./lib/fuzzy.js";

export {
  applyReanchorResults,
  DEFAULT_THRESHOLD,
  HIGH_THRESHOLD,
  reanchorComment,
  reanchorDocumentLines,
  reanchorDocumentText,
  toReanchorLines,
} from "./lib/reanchor-core.js";
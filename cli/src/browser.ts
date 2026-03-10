import * as fuzzy from "./lib/fuzzy.js";
import * as reanchorCore from "./lib/reanchor-core.js";

export type {
  Comment,
  DiffHunk,
  FuzzyCandidate,
  MrsfDocument,
  ReanchorResult,
  ReanchorStatus,
} from "./lib/types.js";

export const combinedScore = fuzzy.combinedScore;
export const exactMatch = fuzzy.exactMatch;
export const fuzzySearch = fuzzy.fuzzySearch;
export const levenshteinScore = fuzzy.levenshteinScore;
export const normalizedMatch = fuzzy.normalizedMatch;
export const tokenLcsScore = fuzzy.tokenLcsScore;

export const applyReanchorResults = reanchorCore.applyReanchorResults;
export const DEFAULT_THRESHOLD = reanchorCore.DEFAULT_THRESHOLD;
export const HIGH_THRESHOLD = reanchorCore.HIGH_THRESHOLD;
export const reanchorComment = reanchorCore.reanchorComment;
export const reanchorDocumentLines = reanchorCore.reanchorDocumentLines;
export const reanchorDocumentText = reanchorCore.reanchorDocumentText;
export const toReanchorLines = reanchorCore.toReanchorLines;
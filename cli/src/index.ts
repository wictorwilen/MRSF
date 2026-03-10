/**
 * MRSF — Public API (library surface).
 *
 * Usage:
 *   import { validate, reanchorFile, addComment, ... } from "mrsf";
 */

import * as discovery from "./lib/discovery.js";
import * as resolveFiles from "./lib/resolve-files.js";
import * as parser from "./lib/parser.js";
import * as writer from "./lib/writer.js";
import * as validator from "./lib/validator.js";
import * as fuzzy from "./lib/fuzzy.js";
import * as git from "./lib/git.js";
import * as reanchor from "./lib/reanchor.js";
import * as comments from "./lib/comments.js";

// Types
export type {
  MrsfDocument,
  Comment,
  CommentExtensions,
  CommentExtensionValue,
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
export const findWorkspaceRoot = discovery.findWorkspaceRoot;
export const loadConfig = discovery.loadConfig;
export const discoverSidecar = discovery.discoverSidecar;
export const sidecarToDocument = discovery.sidecarToDocument;
export const discoverAllSidecars = discovery.discoverAllSidecars;

// File resolution
export const resolveSidecarPaths = resolveFiles.resolveSidecarPaths;

// Parsing
export const parseSidecar = parser.parseSidecar;
export const parseSidecarContent = parser.parseSidecarContent;
export const parseSidecarLenient = parser.parseSidecarLenient;
export const parseSidecarContentLenient = parser.parseSidecarContentLenient;
export const readDocumentLines = parser.readDocumentLines;

export type { LenientParseResult } from "./lib/parser.js";

// Writing
export const computeHash = writer.computeHash;
export const syncHash = writer.syncHash;
export const toYaml = writer.toYaml;
export const toJson = writer.toJson;
export const writeSidecar = writer.writeSidecar;

// Validation
export const validate = validator.validate;
export const validateFile = validator.validateFile;

// Fuzzy matching
export const exactMatch = fuzzy.exactMatch;
export const normalizedMatch = fuzzy.normalizedMatch;
export const fuzzySearch = fuzzy.fuzzySearch;
export const combinedScore = fuzzy.combinedScore;

// Git
export const isGitAvailable = git.isGitAvailable;
export const findRepoRoot = git.findRepoRoot;
export const getCurrentCommit = git.getCurrentCommit;
export const isStale = git.isStale;
export const getDiff = git.getDiff;
export const getLineShift = git.getLineShift;
export const getFileAtCommit = git.getFileAtCommit;
export const getStagedFiles = git.getStagedFiles;
export const detectRenames = git.detectRenames;
export const parseDiffHunks = git.parseDiffHunks;

// Re-anchoring
export const DEFAULT_THRESHOLD = reanchor.DEFAULT_THRESHOLD;
export const HIGH_THRESHOLD = reanchor.HIGH_THRESHOLD;
export const reanchorComment = reanchor.reanchorComment;
export const reanchorDocumentLines = reanchor.reanchorDocumentLines;
export const reanchorDocumentText = reanchor.reanchorDocumentText;
export const toReanchorLines = reanchor.toReanchorLines;
export const reanchorDocument = reanchor.reanchorDocument;
export const applyReanchorResults = reanchor.applyReanchorResults;
export const reanchorFile = reanchor.reanchorFile;

// Comments
export const addComment = comments.addComment;
export const normalizeCommentExtensions = comments.normalizeCommentExtensions;
export const populateSelectedText = comments.populateSelectedText;
export const resolveComment = comments.resolveComment;
export const unresolveComment = comments.unresolveComment;
export const removeComment = comments.removeComment;
export const filterComments = comments.filterComments;
export const getThreads = comments.getThreads;
export const summarize = comments.summarize;
export type { CommentSummary, RemoveCommentOptions } from "./lib/comments.js";

---
description: "Sidemark (MRSF) programmatic API reference for @mrsf/cli — all exported functions and types for discovery, parsing, validation, re-anchoring, and comment management."
---

# Library API Reference

The `@mrsf/cli` package exports a full programmatic API alongside the CLI binary. The MCP server, VS Code extension, and rendering plugins all consume this API internally.

```bash
npm install @mrsf/cli
```

```ts
import {
  discoverSidecar,
  parseSidecar,
  validate,
  reanchorFile,
  addComment,
} from "@mrsf/cli";
```

## Discovery

Functions for finding sidecar files and loading configuration.

### `findWorkspaceRoot(startDir?: string): Promise<string>`

Walk up from `startDir` (defaults to `process.cwd()`) to find the workspace / repository root.

### `loadConfig(root?: string): Promise<MrsfConfig | undefined>`

Load the `.mrsf.yaml` configuration file from the workspace root. Returns `undefined` if no config file exists.

### `discoverSidecar(documentPath: string, config?: MrsfConfig): Promise<string | undefined>`

Given a Markdown document path, return the path to its sidecar file (`.review.yaml` or `.review.json`). Respects `sidecar_root` from config. Returns `undefined` if no sidecar exists.

### `sidecarToDocument(sidecarPath: string, config?: MrsfConfig): string`

Reverse of `discoverSidecar` — given a sidecar path, return the path to the Markdown document it annotates.

### `discoverAllSidecars(root?: string, config?: MrsfConfig): Promise<string[]>`

Recursively discover all sidecar files under the given root directory.

## File Resolution

### `resolveSidecarPaths(patterns: string[], config?: MrsfConfig): Promise<{ sidecarPath: string; documentPath: string }[]>`

Resolve glob patterns or file paths into pairs of sidecar + document paths.

## Parsing

### `parseSidecar(sidecarPath: string): Promise<MrsfDocument>`

Read and parse a sidecar file from disk. Throws on invalid YAML/JSON.

### `parseSidecarContent(content: string, format?: "yaml" | "json"): MrsfDocument`

Parse sidecar content from a string. Useful when you already have the file contents in memory.

### `parseSidecarLenient(sidecarPath: string): Promise<LenientParseResult>`

Parse a sidecar file, returning both the document and any parse warnings. Does not throw on recoverable issues.

### `parseSidecarContentLenient(content: string, format?: "yaml" | "json"): LenientParseResult`

Lenient parse from a string.

### `readDocumentLines(documentPath: string): Promise<string[]>`

Read a Markdown document and return its lines as an array.

## Writing

### `toYaml(doc: MrsfDocument): string`

Serialize an `MrsfDocument` to YAML string.

### `toJson(doc: MrsfDocument): string`

Serialize an `MrsfDocument` to pretty-printed JSON string.

### `writeSidecar(sidecarPath: string, doc: MrsfDocument): Promise<void>`

Write an `MrsfDocument` to disk. Format is inferred from the file extension (`.yaml` or `.json`).

### `computeHash(text: string): string`

Compute the SHA-256 hex digest of a string (used for `selected_text_hash`).

### `syncHash(comment: Comment): Comment`

Recompute `selected_text_hash` if `selected_text` is present.

## Validation

### `validate(doc: MrsfDocument, options?: ValidateOptions): ValidationResult`

Validate an in-memory `MrsfDocument` against the JSON Schema and MRSF rules. Returns diagnostics with severity levels.

### `validateFile(sidecarPath: string, options?: ValidateOptions): Promise<ValidationResult>`

Read a sidecar file from disk and validate it. Combines `parseSidecar` + `validate`.

## Fuzzy Matching

Functions used internally by re-anchoring, also available for custom integrations.

### `exactMatch(needle: string, haystack: string[]): number[]`

Search for an exact match of `needle` across the lines in `haystack`. Returns matching line indices.

### `normalizedMatch(needle: string, haystack: string[]): number[]`

Like `exactMatch` but normalizes whitespace before comparing.

### `fuzzySearch(needle: string, haystack: string[], threshold?: number): FuzzyCandidate[]`

Search for fuzzy matches using Levenshtein distance. Returns candidates with similarity scores.

### `combinedScore(candidate: FuzzyCandidate, originalLine: number): number`

Combine fuzzy similarity score with proximity to the original line for ranking.

## Git Integration

### `isGitAvailable(): Promise<boolean>`

Check whether `git` is available on the system.

### `findRepoRoot(startDir?: string): Promise<string | undefined>`

Find the git repository root from `startDir`.

### `getCurrentCommit(repoRoot?: string): Promise<string | undefined>`

Get the current HEAD commit hash.

### `isStale(comment: Comment, repoRoot?: string): Promise<boolean>`

Check whether a comment's `commit` differs from the current HEAD.

### `getDiff(fromCommit: string, toCommit?: string, filePath?: string): Promise<string>`

Get a git diff between two commits, optionally scoped to a file.

### `getLineShift(diff: string, originalLine: number): number`

Calculate how many lines a position has shifted based on a diff.

### `getFileAtCommit(filePath: string, commit: string): Promise<string>`

Retrieve the contents of a file at a specific commit.

### `getStagedFiles(): Promise<string[]>`

Get the list of currently staged files.

### `detectRenames(fromCommit: string, toCommit?: string): Promise<Map<string, string>>`

Detect renamed files between two commits.

### `parseDiffHunks(diff: string): DiffHunk[]`

Parse a unified diff into structured hunk objects.

## Re-anchoring

### `reanchorComment(comment: Comment, lines: string[], options?: ReanchorOptions): ReanchorResult`

Re-anchor a single comment against the current document lines. Returns the result with the new position and status.

### `reanchorDocument(doc: MrsfDocument, lines: string[], options?: ReanchorOptions): ReanchorResult[]`

Re-anchor all comments in a document. Returns an array of results.

### `applyReanchorResults(doc: MrsfDocument, results: ReanchorResult[]): MrsfDocument`

Apply re-anchor results back to the document, updating line/column fields.

### `reanchorFile(sidecarPath: string, options?: ReanchorOptions): Promise<ReanchorResult[]>`

Read a sidecar file, re-anchor all comments against the current document, write the updated sidecar, and return results. This is the all-in-one function the CLI `reanchor` command uses.

## Comments

### `addComment(sidecarPath: string, options: AddCommentOptions): Promise<Comment>`

Add a new comment to a sidecar file. Creates the sidecar if it doesn't exist.

`AddCommentOptions` accepts an optional `extensions` map for tool-specific metadata. Keys must start with `x_`, for example:

```ts
await addComment(doc, {
  author: "review-bot",
  text: "Needs a second pass",
  line: 12,
  extensions: {
    x_source: "review-bot",
    x_score: 0.91,
    x_labels: ["needs-review", "docs"],
  },
});
```

Extension entries are flattened onto the persisted comment as standard MRSF `x_*` fields.

### `populateSelectedText(comment: Comment, lines: string[]): Comment`

Fill in `selected_text` from the document lines based on the comment's line/column anchors.

### `resolveComment(sidecarPath: string, commentId: string): Promise<void>`

Mark a comment as resolved (`resolved: true`).

### `unresolveComment(sidecarPath: string, commentId: string): Promise<void>`

Mark a comment as unresolved (`resolved: false`).

### `removeComment(sidecarPath: string, commentId: string, options?: RemoveCommentOptions): Promise<void>`

Remove a comment from a sidecar file. Handles reply promotion (re-parenting orphaned replies).

### `filterComments(comments: Comment[], filter: CommentFilter): Comment[]`

Filter comments by author, resolved state, severity, labels, etc.

### `getThreads(comments: Comment[]): Comment[][]`

Group comments into threads based on `reply_to` relationships.

### `summarize(doc: MrsfDocument): CommentSummary`

Return a summary of comment counts (total, resolved, unresolved, by severity, etc.).

## Types

All types are exported from `@mrsf/cli`:

```ts
import type {
  MrsfDocument,       // Top-level sidecar structure
  Comment,            // A single review comment
  MrsfConfig,         // .mrsf.yaml configuration
  ValidationResult,   // Result of validate()
  ValidationDiagnostic, // A single diagnostic (error/warning)
  DiagnosticSeverity, // "error" | "warning" | "info"
  ReanchorResult,     // Result of re-anchoring a comment
  ReanchorStatus,     // "exact" | "fuzzy" | "shifted" | "orphaned" | ...
  FuzzyCandidate,     // A fuzzy match candidate
  DiffHunk,           // A parsed diff hunk
  AddCommentOptions,  // Options for addComment()
  CommentFilter,      // Filter criteria for filterComments()
  AnchorHealth,       // Health status of a comment's anchor
  StatusResult,       // Result of status check
  BaseOptions,        // Shared options
  ReanchorOptions,    // Options for reanchor functions
  ValidateOptions,    // Options for validate functions
  CommentSummary,     // Summary statistics
  RemoveCommentOptions, // Options for removeComment()
  LenientParseResult, // Result of lenient parsing
} from "@mrsf/cli";
```

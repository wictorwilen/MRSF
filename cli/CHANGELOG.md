# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-11-03

### Fixed
- `mrsf add` captures selected text from the requested line rather than the preceding line.
- Use Git-style repository-relative paths for revision-based reanchoring on Windows, so nested documents retain their source-revision evidence.

### Changed
- Document column offsets as zero-based UTF-16 code units, with an exclusive end.

## [0.7.1] - 2026-08-18

### Added
- `mrsf add` can resolve the comment author from repository-local Git `user.name` when `--author` is omitted.
- Exported `getGitUserName()` for repository-aware integrations such as the VS Code extension.

## [0.7.0] - 2026-08-18

### Added
- Anchor Mesh reanchoring with source-revision projection, Markdown structural context, confidence calibration, and same-section landmark reconciliation.
- Bounded lexical and Unicode trigram candidate retrieval shared across comments.
- Language-neutral correctness, mutation, scaling, parity, and performance evaluation gates.
- Public Node and browser exports for revision projection, structural context, confidence calibration, and reconciliation.

### Changed
- Reanchoring now prefers reviewable `ambiguous` or `fuzzy` results over weak exact relocations.
- Git revision names and abbreviated SHAs are canonicalized for shared caches and reconciliation groups.

## [0.6.0] - 2026-06-28

### Added
- Node-free `serialize` core: `parseSidecarContent`, `parseSidecarContentLenient`, `toYaml`, and `toJson` extracted into a browser-safe module and exported from the `@mrsf/cli/browser` entry point (issue #15).
- "Entry points" documentation distinguishing the full vs. core/browser surfaces, plus structured-validation (`ValidationResult` / `ValidationDiagnostic`) reference with the full diagnostic-code list (issue #18).

### Fixed
- §7.4 step 1a re-anchoring no longer "teleports" a comment across the document: a proximity guard prevents a unique-but-distant single-occurrence match from yanking an anchor when the original location was edited in place (issue #13).

## [0.5.0] - 2026-06-27

### Added
- `@mrsf/cli/browser` embedder API guarantees: side-effect-free and no Node.js built-ins.
- `resolveAnchor()` positional resolver returning `{ from, to }` offsets.
- `formatAuthor()`, `newCommentId()`, and `parseAuthor()` helpers.
- Browser-safe `validateDocument()` and exported `mrsfSchema`.
- Stable `code` field on validation diagnostics.

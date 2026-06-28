# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

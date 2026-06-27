# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-06-27

### Added
- `@mrsf/cli/browser` embedder API guarantees: side-effect-free and no Node.js built-ins.
- `resolveAnchor()` positional resolver returning `{ from, to }` offsets.
- `formatAuthor()`, `newCommentId()`, and `parseAuthor()` helpers.
- Browser-safe `validateDocument()` and exported `mrsfSchema`.
- Stable `code` field on validation diagnostics.

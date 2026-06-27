# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.8] - 2026-06-27

### Added
- `core/sourceLineMap.ts`: builds and caches a map that translates between
  markdown **source** line numbers (the spec coordinate system) and
  PM-text-model line indices. New comments are now stored with source line
  numbers instead of PM-text line numbers.
- `core/textMatch.ts`: block-scoped `selected_text` matching against
  ProseMirror text blocks, so an inline highlight stays within a single visual
  block instead of bleeding across sibling blocks.

### Changed
- Inline decorations now resolve primarily by matching `selected_text` against
  PM block content (robust to source-vs-PM coordinate differences), falling
  back to the stored column range only when there is no match.
- Overlay inline-highlight rectangles are now collected per visual line via a
  real DOM `Range` (with a `coordsAtPos` fallback for jsdom), avoiding the
  oversized single bounding box for multi-line selections.
- `ReviewState` carries the original markdown `sourceText` so the source-line
  map can be (re)built on load, refresh, and save.
- Bumped `@mrsf/cli` dependency range to `^0.5.0` for compatibility with the
  latest core library.

### Notes
- This release replays the performance and correctness work previously
  published as 0.3.5–0.3.7 (which were released from an out-of-tree working
  copy), recovered from the published source maps and re-validated against the
  test suite, and realigns the package onto `@mrsf/cli ^0.5.0`.

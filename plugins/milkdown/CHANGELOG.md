# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-08-18

### Changed
- Reanchoring uses the bounded browser-safe Anchor Mesh core from `@mrsf/cli` 0.7.0.
- Widened the `@mrsf/cli` dependency range through `^0.7.0`.

## [0.4.0] - 2026-06-28

### Added
- `builtinUi?: boolean` option (default `true`) on the plugin/controller options. Setting `builtinUi: false` suppresses all built-in review chrome — the gutter/thread overlay, inline and thread tooltips, the selection add button, and the modal add/edit/reply/delete dialogs (including the Crepe toolbar fallback) — while keeping anchoring, live line-tracking, the decoration state, the controller, and all callbacks active. The Milkdown analogue of the rehype plugin's `window.mrsfDisableBuiltinUi` (issue #14).
- `"sideEffects": ["**/*.css"]` manifest declaration so bundlers treat the JS as tree-shakeable while retaining CSS (issue #16).
- Documented bundling guarantees (ESM-only exports map, neutral vs. browser builds, separate `style.css`, `sideEffects`, `@milkdown/*` peer range `>=7 <8` covering 7.21.x) and the full controller event/callback surface for custom UIs (issues #16, #19).

### Changed
- Widened the `@mrsf/cli` dependency range to `^0.5.0 || ^0.6.0`.

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

# Changelog

All notable changes to the **Sidemark** VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-08-18

### Added
- New comments, replies, and edit ownership use repository-local Git `user.name` when `sidemark.author` is empty.

## [0.5.0] - 2026-08-18

### Changed
- Reanchoring now uses the Anchor Mesh implementation from `@mrsf/cli` 0.7.0, combining Git revision evidence, Markdown structure, bounded text matching, confidence calibration, and comment landmarks.
- Weak or conflicting relocations are presented for review rather than applied automatically.

## [0.4.4] - 2026-03-30

### Fixed
- Reanchor comments when a Markdown file is reloaded after an external disk write, such as an AI agent updating the file directly.
- Avoid using the live line-tracker heuristic for clean-document external reloads, which could leave anchors on the wrong lines after large replacements.
- Preserve existing live tracking behavior for normal dirty edits while skipping the external-reload reanchor path for undo and redo events.

## [0.1.0] - 2026-03-03

### Added
- Gutter icons for commented lines (open, resolved, orphaned, multiple)
- Inline background highlights for column-span comments
- Rich hover cards with threaded comments, timestamps, badges, and action links
- Sidebar panel with comment listing, sorting (by line/date), and resolved-comment filter toggle
- Commands: Add Line Comment, Add Comment on Selection, Reply, Resolve, Unresolve, Delete
- Interactive reanchor review with old/new anchor decorations and accept/reject controls
- Automatic reanchoring on save (configurable via `sidemark.reanchorOnSave`)
- Anchor drift detection with status bar warning
- Staleness warnings for comments referencing a different git commit than HEAD
- Status bar with comment count, spinner during operations, and stale/drift indicators
- Context menu integration for Markdown files
- Editor line-number context menu for adding line comments
- Configurable settings: author, showResolved, gutterIcons, inlineHighlights, reanchorThreshold, reanchorAutoAcceptScore, reanchorOnSave

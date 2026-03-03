# Changelog

All notable changes to the **Sidemark** VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

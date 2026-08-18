# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-08-18

### Changed
- Rebuilt against `@mrsf/cli` 0.7.0, providing Anchor Mesh reanchoring for MCP file operations.
- Uncertain relocations may now be returned as `ambiguous` or `fuzzy` instead of being accepted from weak exact evidence.

## [0.6.1] - 2026-06-28

### Changed
- Rebuilt against `@mrsf/cli` 0.6.0 (picks up the §7.4 re-anchoring proximity-guard fix and the Node-free `@mrsf/cli/browser` exports).

### Added
- Documented the concurrency & write-conflict contract: single-process serialized/atomic `writeSidecar` (last-write-wins) and the cross-process optimistic-concurrency guard (`version` / `expectedVersion`, `version-mismatch` conflicts), with a recommended watch/reload/retry pattern (issue #17).

## [0.6.0] - 2026-06-27

### Added
- Buffer-aware tools with optional inline `documentText` on add, update, and reanchor operations.
- Optimistic-concurrency `expectedVersion` sidecar-hash checks with conflict errors.
- Sidecar content hash returned in responses.
- Documented re-read-after-mutation pattern.
- Validation `code` surfaced in diagnostics.

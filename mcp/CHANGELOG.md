# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-06-27

### Added
- Buffer-aware tools with optional inline `documentText` on add, update, and reanchor operations.
- Optimistic-concurrency `expectedVersion` sidecar-hash checks with conflict errors.
- Sidecar content hash returned in responses.
- Documented re-read-after-mutation pattern.
- Validation `code` surfaced in diagnostics.

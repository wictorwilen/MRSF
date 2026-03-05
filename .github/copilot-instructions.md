# Copilot Instructions for MRSF

## Project Overview

MRSF (Markdown Review Sidecar Format), also known as **Sidemark**, is a specification plus tooling for storing review comments in sidecar files alongside Markdown documents. The canonical spec is `MRSF-v1.0.md`.

## Repository Architecture

This is a **multi-package monorepo** with no root package.json. Each package is managed independently:

| Package | Path | npm name | Build | Purpose |
|---------|------|----------|-------|---------|
| CLI & library | `cli/` | `@mrsf/cli` | `tsc` | Core library + CLI binary (`mrsf`) |
| MCP server | `mcp/` | `@mrsf/mcp` | `esbuild` | Model Context Protocol server for AI agents |
| Plugin shared | `plugins/shared/` | `@mrsf/plugin-shared` | `tsc` | Shared types, comment logic, CSS, and controller for rendering plugins (private) |
| markdown-it plugin | `plugins/markdown-it/` | `@mrsf/markdown-it-mrsf` | `tsc` | Standalone markdown-it plugin for rendering comments |
| rehype plugin | `plugins/rehype/` | `@mrsf/rehype-mrsf` | `tsc` | Standalone rehype plugin for rendering comments (unified ecosystem) |
| VS Code extension | `vscode/` | `mrsf-vscode` | `esbuild` | Editor integration (marketplace: `wictor.mrsf-vscode`) |
| Documentation | `docs/` | (private) | VitePress | Site deployed to Azure Static Web Apps |

**Key dependencies**:
- `@mrsf/mcp` depends on `@mrsf/cli` via `file:../cli`
- `@mrsf/markdown-it-mrsf` and `@mrsf/rehype-mrsf` depend on `@mrsf/plugin-shared` via `file:../shared` and `@mrsf/cli` via `file:../../cli`

## Build, Test, and Lint

All commands run from within the respective package directory — there is no root-level build.

### TypeScript packages (cli/, mcp/, vscode/, plugins/)

```bash
# Build
npm run build

# Run all tests (Vitest)
npm test

# Run a single test file
npx vitest run src/__tests__/reanchor.test.ts

# Run tests matching a pattern
npx vitest run -t "fuzzy match"

# Type-check without emitting
npm run lint
```

Tests live in `src/__tests__/` within each package. Packages with test suites: `cli` (most comprehensive), `mcp`, `plugins/markdown-it`, `plugins/rehype`. The VS Code extension and `plugins/shared` have no tests.

### Python package (python/)

```bash
cd python
source .venv/bin/activate   # uses a local venv

pytest -v                   # run all tests
pytest tests/test_validator.py  # single file
pytest -k "test_reanchor"   # pattern match

ruff check .                # lint
mypy src/                   # type-check (strict)
```

### Build order for cross-package changes

When modifying `@mrsf/cli`, rebuild dependents in order: `cli` → `mcp`, `plugins/shared` → `plugins/markdown-it`, `plugins/rehype`. Plugin builds copy CSS and JS assets from `plugins/shared/` into their own dist.

## Spec ↔ Schema Sync

When adding or changing sidecar fields, you **must** update all three of:

1. **`MRSF-v1.0.md`** — the normative specification
2. **`mrsf.schema.json`** — JSON Schema for sidecar files
3. **`cli/src/lib/types.ts`** — TypeScript type definitions

The config schema (`mrsf-config.schema.json`) is separate and covers `.mrsf.yaml` configuration files only.

## Key Conventions

- **RFC 2119 keywords**: The spec uses MUST, SHOULD, MAY (uppercase) as normative requirement levels. Preserve this convention.
- **Field naming**: YAML/JSON sidecar fields use `snake_case` (e.g., `selected_text`, `end_line`). TypeScript interfaces mirror the snake_case field names for serialization fidelity, while internal function/method names use `camelCase`.
- **ESM only**: All packages use `"type": "module"` with `NodeNext` module resolution. Use `.js` extensions in TypeScript import paths.
- **Strict TypeScript**: `strict: true` in all tsconfig files. Target is ES2022.
- **Sidecar discovery**: Sidecar files are named `<document>.review.yaml` (or `.review.json`), co-located by default. Alternate locations via `.mrsf.yaml` config with `sidecar_root`.

## CLI Library Exports

The `@mrsf/cli` package exports both the CLI binary and a programmatic API. The MCP server consumes the library API directly — functions like `discoverSidecar`, `parseSidecar`, `validate`, `reanchorDocument`, `addComment`, etc. are all imported from `@mrsf/cli` into the MCP server. When modifying library functions, check for MCP server usage.

## Code Patterns

- **Graceful git degradation**: Git operations return `null` when git is unavailable rather than throwing. Git availability is cached. All git calls use `execFile` (no shell) with a 10-second timeout.
- **Config discovery**: `.mrsf.yaml` is found by walking up the directory tree toward the git root. The `sidecar_root` config value rejects absolute paths and `..` traversal for safety.
- **Schema validation**: Uses `ajv` (TypeScript) / `jsonschema` (Python). Schemas are loaded once and cached globally. The CLI resolves the schema path from multiple fallback locations (dist, dev, cwd).
- **Test fixtures**: Tests use inline helper functions (`makeDoc`, `makeComment`) rather than external fixture files. Temp directories are created in `beforeEach` and cleaned up in `afterEach`. Path assertions use regex to handle OS differences: `expect(result).toMatch(/docs[/\\]guide/)`.

## Python Package

The `python/` package is a 1:1 port of the Node.js CLI with identical module structure (`validator.py` ↔ `validator.ts`, `discovery.py` ↔ `discovery.ts`, etc.) and the same test cases. Uses `ruamel.yaml` for round-trip YAML preservation with `yaml.indent(mapping=2, sequence=4, offset=2)` to match MRSF sidecar formatting.

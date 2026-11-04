# Contributing to MRSF

Thanks for helping improve the Markdown Review Sidecar Format (MRSF). This document describes how to propose changes, file issues, and keep the spec and schema in sync.

## How to Contribute
- **Issues:** Use GitHub issues for bugs, clarifications, and proposals. Include context, examples, and expected behavior.
- **Pull Requests:** Keep PRs focused. Link to related issues. Describe the change, rationale, and any interoperability impact.
- **Draft Status:** The spec is a draft; small normative adjustments are expected. Breaking changes should be rare and well-justified.

## Style and Editorial Guidelines
- Use RFC 2119/8174 key words (MUST, SHOULD, MAY) consistently for normative requirements.
- Keep YAML as the primary example format; JSON examples should remain equivalent. Use spaces, not tabs, in examples.
- When adding or changing fields, update **both** the narrative spec and `mrsf.schema.json`, and include an example.
- Prefer concise, testable requirements. Note interoperability or migration guidance when changing behavior.

## Validation
- Validate examples against `mrsf.schema.json` (e.g., with a JSON Schema validator). Keep examples schema-compliant.
- Check that line/column and `selected_text` anchors are consistent in examples.

### Tooling checks

There is no root npm workspace. Run `npm run lint`, `npm run build`, and `npm test` within each TypeScript package. Build `cli` first, then `plugins/shared`, before building packages that consume them. CI runs all package suites, retains renderer coverage checks, and checks libraries and VS Code on Windows and Linux.

For Python, run these commands from `python`:

```bash
python -m pip install ".[dev]" build
python -m ruff check .
python -m mypy src
python -m pytest -q
python -m build
```

CI checks Python 3.10 and 3.13 on Windows and Linux. Permission-error tests inject the filesystem error instead of relying on platform-specific `chmod` behavior.

For the library-only Rust crate, run these commands from `rust`:

```bash
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-features
cargo package --locked
```

CI checks the declared minimum Rust version and stable on Windows and Linux.
`cargo package` verifies the distributable without relying on files outside the
crate. Keep both bundled schemas in `rust/schemas` byte-identical to their
canonical root copies. Keep shared reanchoring fixtures aligned with
`evaluation/reanchor`; do not change expected outcomes to accommodate a port.

After building `cli` and installing the Python SDK, run the cross-language
round-trip checks from the repository root:

```bash
python examples/test-rust-interop.py
```

The harness exercises YAML and JSON produced, updated, and validated by all
three SDKs. The Rust executable it uses is a development example, not a CLI
distributed by the crate. Do not add a competing Rust CLI or a publishing step
as part of ordinary SDK changes.

After building the plugin dependencies, build documentation with `npm run docs:build` in `docs`. In `examples`, run `npm run demo:marp:build`, `npm run demo:milkdown:build`, `npm run demo:monaco:build`, `npm run demo:tiptap:build`, and `npm run test:monaco-demo`.

## Versioning
- `mrsf_version` denotes the format version. Bump the minor version for backward-compatible additions; bump major only for breaking changes.
- Document notable changes in the spec’s text; consider adding a brief changelog entry in PR descriptions.

## Security and Privacy
- Avoid adding examples with sensitive data. Call out privacy/security considerations when introducing new fields.

## Communication
- Propose substantive changes in an issue before opening a large PR.
- Be explicit about intended compatibility (backward/forward) and migration expectations.
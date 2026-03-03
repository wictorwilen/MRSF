# Markdown Review Sidecar Format (MRSF) — Draft

The **Markdown Review Sidecar Format (MRSF)** defines a portable, version-controlled, and machine-actionable way to store review comments *outside* Markdown documents. It keeps Markdown files clean while enabling durable review history, automated processing by AI agents, and precise anchoring to document content.

Sidecar files live next to the Markdown file they annotate and follow this naming pattern:

```
<document>.review.yaml
```

Example: docs/architecture.md.review.yaml

Alternatively, a `.mrsf.yaml` config at the repo root can redirect sidecars to a separate directory:

```yaml
sidecar_root: .reviews
```

With this config, `docs/architecture.md` → `.reviews/docs/architecture.md.review.yaml`. See the [specification](MRSF-v1.0.md) for full discovery rules.

## Minimal Example

``` yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
  - id: 1d3c72b0
    author: Wictor (wictorwilen)
    timestamp: '2026-03-02T18:22:59.713284+00:00'
    text: "This section needs clarification."
    resolved: false
    line: 9
    commit: 02eb613a3f4b8c9d1e5a7b2c4d6f8e0a1b3c5d7e
```

## Advanced Example (Precise Text Span)

``` yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
  - id: 3eeccbd3
    author: Wictor (wictorwilen)
    timestamp: '2026-03-02T18:24:51.742976+00:00'
    text: "Is this phrasing correct?"
    type: question
    resolved: false
    commit: 02eb613a3f4b8c9d1e5a7b2c4d6f8e0a1b3c5d7e
    line: 12
    end_line: 12
    start_column: 42
    end_column: 73
    selected_text: "While many concepts are represented"
```

## Specification

The full specification is available in [MRSF-v1.0.md](MRSF-v1.0.md).

## JSON Schema

A machine-readable schema is available in [mrsf.schema.json](mrsf.schema.json).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Examples

A worked example (Markdown file + sidecar) is available in the [examples/](examples/) folder.

## CLI

The **`mrsf`** command-line tool validates, re-anchors, and manages MRSF sidecar files. Install it from npm:

```bash
npm install -g @mrsf/cli
```

Quick start:

```bash
mrsf init docs/architecture.md          # create a sidecar
mrsf add docs/architecture.md -l 12     # add a comment
mrsf validate                           # validate all sidecars
mrsf reanchor                           # re-anchor after edits
mrsf status                             # check anchor health
```

See the full CLI documentation in [`cli/README.md`](cli/README.md), or run `mrsf --help`.

## Status

Draft — this specification is open for feedback and may change. Please file issues or pull requests with suggestions.
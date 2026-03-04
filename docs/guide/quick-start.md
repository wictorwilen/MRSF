---
description: "Install the Sidemark (MRSF) CLI and create your first sidecar review file in under 2 minutes."
---

# Quick Start

Get up and running with MRSF in under 2 minutes.

## Install the CLI

```bash
npm install -g @mrsf/cli
```

Or use without installing:

```bash
npx @mrsf/cli --help
```

## Create a Sidecar

```bash
mrsf init docs/architecture.md
```

This creates `docs/architecture.md.review.yaml` with the basic structure.

## Add a Comment

```bash
mrsf add docs/architecture.md -l 12 "This section needs more detail."
```

This adds an anchored comment at line 12, automatically capturing the `selected_text` and current git commit.

## Validate

```bash
mrsf validate
```

Discovers all sidecars in the workspace and checks them against the MRSF schema.

## Re-anchor After Edits

After editing the Markdown document:

```bash
mrsf reanchor
```

This finds where anchored text has moved and updates line numbers. Use `--dry-run` to preview changes.

## Check Status

```bash
mrsf status
```

Reports anchor health for every comment:

| Health | Meaning |
|--------|---------|
| **fresh** | Text matches at the recorded position |
| **stale** | Commit is behind HEAD; text may have moved |
| **orphaned** | Text can't be found in the current document |

## List & Filter Comments

```bash
# All open comments
mrsf list --open

# Summary statistics
mrsf list --summary

# Filter by author
mrsf list --author "Jane Doe"
```

## Next Steps

- [Examples](./examples) — worked examples for every re-anchoring strategy
- [Full CLI Reference](/cli/) — all commands and options
- [MCP Server](/mcp/) — expose MRSF to AI assistants
- [Specification](/specification) — the complete MRSF v1.0 spec

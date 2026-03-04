---
description: Integrate Sidemark (MRSF) validation and re-anchoring into your CI/CD pipeline with GitHub Actions, Azure DevOps, or any other CI system.
---

# CI/CD Integration

Automate MRSF validation and re-anchoring in your CI pipeline to catch broken sidecars, stale anchors, and schema violations before they land in your main branch.

## GitHub Actions

### Validate on every pull request

Add this workflow to `.github/workflows/mrsf-validate.yml`:

```yaml
name: MRSF Validate

on:
  pull_request:
    paths:
      - "**/*.md"
      - "**/*.review.yaml"
      - "**/*.review.json"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Validate sidecars
        run: npx -y @mrsf/cli validate --strict
```

The `--strict` flag treats warnings as errors, so the job fails on any schema warning or stale anchor.

### Re-anchor after document changes

You can also re-anchor comments automatically and commit the updated sidecars:

```yaml
name: MRSF Re-anchor

on:
  push:
    branches: [main]
    paths:
      - "docs/**/*.md"

jobs:
  reanchor:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history for git diff analysis

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Re-anchor all sidecars
        run: npx -y @mrsf/cli reanchor

      - name: Commit updated sidecars
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "**/*.review.yaml" "**/*.review.json"
          git diff --cached --quiet || git commit -m "chore: re-anchor MRSF sidecars"
          git push
```

::: tip
Use `fetch-depth: 0` so the CLI can access git history for diff-based re-anchoring. Without full history, only exact and fuzzy matching are available.
:::

### Combined workflow

For a single workflow that validates on PRs and re-anchors on push to `main`:

```yaml
name: MRSF

on:
  pull_request:
    paths: ["**/*.md", "**/*.review.yaml", "**/*.review.json"]
  push:
    branches: [main]
    paths: ["docs/**/*.md"]

jobs:
  validate:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx -y @mrsf/cli validate --strict

  reanchor:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx -y @mrsf/cli reanchor
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add "**/*.review.yaml" "**/*.review.json"
          git diff --cached --quiet || git commit -m "chore: re-anchor MRSF sidecars"
          git push
```

## Azure DevOps Pipelines

```yaml
trigger:
  paths:
    include:
      - "**/*.md"
      - "**/*.review.yaml"

pool:
  vmImage: "ubuntu-latest"

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "20.x"

  - script: npx -y @mrsf/cli validate --strict
    displayName: "Validate MRSF sidecars"
```

## Generic CI

For any CI system that supports Node.js:

```bash
# Install globally (or use npx)
npm install -g @mrsf/cli

# Validate all sidecars in the repo
mrsf validate --strict

# Or validate a specific file
mrsf validate docs/architecture.md

# Check comment health (stale anchors, orphans)
mrsf status
```

The `validate` command exits with a non-zero code when errors are found, making it suitable for any CI gate.

## What gets checked

| Check | `validate` | `validate --strict` |
|-------|-----------|-------------------|
| Schema compliance | ✅ Error | ✅ Error |
| Missing required fields | ✅ Error | ✅ Error |
| Stale anchors (`selected_text` mismatch) | ⚠️ Warning | ✅ Error |
| Orphaned comments | ⚠️ Warning | ✅ Error |
| Hash inconsistencies | ⚠️ Warning | ✅ Error |
| Document file missing | ✅ Error | ✅ Error |

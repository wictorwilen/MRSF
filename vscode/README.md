# Sidemark – MRSF Review Comments for VS Code

Add, manage, and navigate **Markdown Review Sidecar Format** ([MRSF](https://sidemark.org)) comments directly inside Visual Studio Code — without touching your Markdown source files.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue?logo=visual-studio-code)
![License](https://img.shields.io/badge/license-MIT-green)

[![Sidemark for VS Code](https://raw.githubusercontent.com/wictorwilen/MRSF/main/media/sidemark-vscode-screenshot.png)](https://github.com/wictorwilen/MRSF)

## Features

### Gutter icons & inline highlights

Every commented line gets a color-coded gutter icon (open 💬, resolved ✅, orphaned ⚠️, multiple comments). Inline/column-span comments are highlighted directly in the editor text.

### Rich hover cards

Hover over any commented line to see the full comment thread with author, timestamp, badges, and one-click action links:

- **Resolve / Unresolve** — toggle comment state without leaving the editor
- **Reply** — add a threaded reply
- **Delete** — remove the comment

### Sidebar panel

A dedicated **Sidemark** activity-bar panel lists all comments for the active Markdown file:

- Sort by **line number** or **date**
- Toggle **resolved comments** visibility
- Navigate to any comment with a single click
- **Reanchor** all comments from the sidebar
- Add new comments directly

### Automatic reanchoring on save

When you save a Markdown file, Sidemark silently reanchors all comments using the MRSF multi-step resolution algorithm (exact text → fuzzy match → line fallback). High-confidence results are applied automatically; uncertain results are flagged for manual review.

### Interactive reanchor review

Run **Sidemark: Reanchor Comments** from the command palette for a guided review session. Each uncertain result is shown with old/new anchor decorations and accept/reject/skip controls.

### Anchor drift detection

When you insert or delete lines, the status bar warns you that comment anchors may have drifted. Saving the file clears the warning after reanchor runs.

### Staleness warnings

If any comments reference a different git commit than HEAD, the status bar shows an orange warning with the count of stale comments. Click it to reanchor.

## Getting Started

1. **Install** the extension from the VS Code Marketplace (or install the `.vsix` manually).
2. **Open a Markdown file** that has a co-located `.review.yaml` sidecar — or create one:
   - Right-click a line → **Sidemark: Add Line Comment**
   - Select text → **Sidemark: Add Comment on Selection**
3. View comments in the **Sidemark** sidebar, or hover over commented lines.

> **Tip:** The first time you add a comment, Sidemark will ask for your author name. It's saved globally so you only enter it once.

## Commands

| Command | Description |
|---|---|
| `Sidemark: Add Line Comment` | Add a comment on the current line |
| `Sidemark: Add Comment on Selection` | Add an inline comment on the selected text |
| `Sidemark: Reply to Comment` | Reply to an existing comment |
| `Sidemark: Resolve Comment` | Resolve a comment (with optional cascade) |
| `Sidemark: Unresolve Comment` | Unresolve a previously resolved comment |
| `Sidemark: Delete Comment` | Delete a comment |
| `Sidemark: Reanchor Comments` | Run interactive reanchor for uncertain results |
| `Sidemark: Go to Comment` | Navigate to a comment's anchor position |
| `Sidemark: Refresh Comments` | Reload the sidecar from disk |

All commands are also available from the editor context menu (right-click) on Markdown files.

## Settings

All settings are under the **Sidemark** section in VS Code Settings.

| Setting | Type | Default | Description |
|---|---|---|---|
| `sidemark.author` | `string` | `""` | Default author name for new comments |
| `sidemark.showResolved` | `boolean` | `true` | Show resolved comments in decorations and sidebar |
| `sidemark.gutterIcons` | `boolean` | `true` | Show gutter icons for commented lines |
| `sidemark.inlineHighlights` | `boolean` | `true` | Show inline background highlights for text-specific comments |
| `sidemark.reanchorOnSave` | `boolean` | `true` | Automatically reanchor comments when a Markdown file is saved |
| `sidemark.reanchorThreshold` | `number` | `0.6` | Fuzzy match threshold for reanchoring (0.0–1.0) |
| `sidemark.reanchorAutoAcceptScore` | `number` | `1.0` | Auto-accept reanchor results at or above this confidence score |

## How It Works

Sidemark stores review comments in **sidecar files** alongside your Markdown documents, following the [MRSF v1.0 specification](https://github.com/wictorwilen/MRSF/blob/main/MRSF-v1.0.md):

```
docs/
  architecture.md                    ← your document
  architecture.md.review.yaml       ← sidecar with comments
```

Comments are anchored to specific lines or text ranges using `line`, `end_line`, `start_column`, `end_column`, and `selected_text`. When the document is edited, the reanchor algorithm relocates comments using exact text matching, fuzzy matching, and positional fallback.

### Sidecar format

```yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
  - id: 1d3c72b0
    author: Alice (alice)
    timestamp: "2026-03-02T18:22:59Z"
    text: "This section needs clarification."
    resolved: false
    line: 9
    selected_text: "The gateway component routes all inbound traffic."
    commit: 02eb613
```

See the [specification](https://github.com/wictorwilen/MRSF/blob/main/MRSF-v1.0.md) for the full schema, including threading (`reply_to`), types, severity levels, and extension fields (`x_*`).

## Alternate Sidecar Location

Place a `.mrsf.yaml` at your repository root to store sidecars in a central directory:

```yaml
sidecar_root: .reviews
```

With this config, the sidecar for `docs/architecture.md` is resolved as `.reviews/docs/architecture.md.review.yaml`.

## CLI Companion

The **[@mrsf/cli](https://www.npmjs.com/package/@mrsf/cli)** package provides command-line access to the same functionality — validate, add, resolve, reanchor, and list comments from the terminal or CI/CD pipelines:

```bash
npx @mrsf/cli validate --strict
npx @mrsf/cli reanchor --staged
npx @mrsf/cli list --open
```

## Requirements

- VS Code 1.85 or later
- Git (optional — enables commit-based staleness detection and diff-based reanchoring)

## Links

- **[sidemark.org](https://sidemark.org)** — Official website and documentation
- [MRSF v1.0 Specification](https://github.com/wictorwilen/MRSF/blob/main/MRSF-v1.0.md) — Full format specification
- [@mrsf/cli on npm](https://www.npmjs.com/package/@mrsf/cli) — CLI companion package
- [GitHub Repository](https://github.com/wictorwilen/MRSF) — Source code and issue tracker

## License

[MIT](https://github.com/wictorwilen/MRSF/blob/main/LICENSE) — Copyright (c) 2026 Wictor Wilén

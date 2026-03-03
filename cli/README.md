# MRSF CLI

Command-line tool and Node.js library for the **Markdown Review Sidecar Format** ([MRSF v1.0](../MRSF-v1.0.md)).

Validate sidecars, add and resolve review comments, re-anchor comments after document edits, and integrate MRSF into CI/CD pipelines — all from the terminal.

```
  ╔╦╗╦═╗╔═╗╔═╗
  ║║║╠╦╝╚═╗╠╣
  ╩ ╩╩╚═╚═╝╚
  Markdown Review Sidecar Format
```

## Quick Start

```bash
# Install globally
npm install -g @mrsf/cli

# …or run without installing
npx @mrsf/cli --help
```

### From source

```bash
git clone https://github.com/wictorwilen/MRSF.git
cd MRSF/cli
npm install
npm run build
node dist/bin.js --help
```

## Commands

### `mrsf validate [files...]`

Validate sidecar files against the JSON Schema and MRSF spec rules.

```bash
# Validate a single sidecar
mrsf validate docs/architecture.md.review.yaml

# Validate all sidecars discovered in the workspace
mrsf validate

# Treat warnings as errors (useful for CI)
mrsf validate --strict
```

| Option | Description |
|---|---|
| `-s, --strict` | Treat warnings as errors (exit non-zero) |

---

### `mrsf add <document>`

Add a review comment to a document's sidecar file. Creates the sidecar if it doesn't exist. Automatically populates `selected_text` from the document when a line is specified, and stamps the current git commit.

```bash
# Add a line comment
mrsf add docs/api.md \
  --author "alice" \
  --text "Clarify the rate limit behavior" \
  --line 42

# Add a column-span comment with type and severity
mrsf add docs/api.md \
  --author "bob" \
  --text "Typo: should be 'response'" \
  --line 18 --start-column 10 --end-column 18 \
  --type suggestion --severity low

# Reply to an existing comment
mrsf add docs/api.md \
  --author "alice" \
  --text "Good catch, fixed in abc123" \
  --reply-to 3eeccbd3
```

| Option | Description |
|---|---|
| `-a, --author <name>` | Comment author (required) |
| `-t, --text <text>` | Comment body (required) |
| `-l, --line <n>` | Line number (1-based) |
| `--end-line <n>` | End line (inclusive) |
| `--start-column <n>` | Start column (0-based) |
| `--end-column <n>` | End column (0-based) |
| `--type <type>` | Category: `suggestion`, `issue`, `question`, `accuracy`, `style`, `clarity` |
| `--severity <level>` | Importance: `low`, `medium`, `high` |
| `--reply-to <id>` | Reply to an existing comment by ID |
| `--selected-text <text>` | Override auto-detected selected text |

---

### `mrsf resolve <sidecar> <id>`

Resolve (or unresolve) a comment by ID.

```bash
# Resolve a comment
mrsf resolve docs/api.md.review.yaml 1d3c72b0

# Unresolve it
mrsf resolve --undo docs/api.md.review.yaml 1d3c72b0

# Resolve and cascade to all direct replies
mrsf resolve --cascade docs/api.md.review.yaml 1d3c72b0
```

| Option | Description |
|---|---|
| `--cascade` | Also resolve direct replies |
| `-u, --undo` | Unresolve instead of resolving |

---

### `mrsf list [files...]`

List and filter comments across one or more sidecar files.

```bash
# List all open comments
mrsf list --open docs/api.md.review.yaml

# Filter by author and severity
mrsf list --author alice --severity high

# Summary view (counts, types, severities)
mrsf list --summary

# Machine-readable JSON output
mrsf list --json --open
```

| Option | Description |
|---|---|
| `--open` | Show only open (unresolved) comments |
| `--resolved` | Show only resolved comments |
| `--orphaned` | Show only orphaned comments |
| `--author <name>` | Filter by author |
| `--type <type>` | Filter by comment type |
| `--severity <level>` | Filter by severity |
| `--summary` | Show aggregate summary instead of individual comments |
| `--json` | Output as JSON |

---

### `mrsf reanchor [files...]`

Re-anchor comments after the source document has been edited. Uses a multi-step resolution algorithm (§7.4):

1. **Diff-based shift** — uses `git diff` to calculate line offsets
2. **Exact text match** — searches for `selected_text` verbatim
3. **Fuzzy match** — token-level LCS + Levenshtein similarity
4. **Line/column fallback** — checks whether original position is still plausible
5. **Orphan** — retains unresolvable comments and marks them for review

```bash
# Dry run — see what would change without writing
mrsf reanchor --dry-run docs/api.md.review.yaml

# Re-anchor with a higher fuzzy threshold (stricter matching)
mrsf reanchor --threshold 0.8

# Only process sidecars for staged files (pre-commit hook)
mrsf reanchor --staged

# Disable git (pure text-based matching only)
mrsf reanchor --no-git

# Override the from-commit for all comments
mrsf reanchor --from abc1234

# Also update selected_text to match the current document text (opt-in)
mrsf reanchor --update-text
```

| Option | Description | Default |
|---|---|---|
| `-n, --dry-run` | Report without modifying files | `false` |
| `-t, --threshold <n>` | Fuzzy match threshold (0.0–1.0) | `0.6` |
| `--staged` | Only process sidecars for git-staged documents | `false` |
| `--no-git` | Disable git integration entirely | git enabled |
| `--from <commit>` | Override from-commit for diff calculation | per-comment `commit` field |
| `--update-text` | Also replace `selected_text` with current document text | `false` |

> **Text preservation (§6.2):** By default, re-anchoring preserves the
> original `selected_text` and records the current document text in
> `anchored_text`. Use `--update-text` to opt in to overwriting
> `selected_text` directly.

---

### `mrsf status [files...]`

Assess anchor health for each comment.

```bash
mrsf status docs/api.md.review.yaml
mrsf status --json
```

Health states:

| State | Meaning |
|---|---|
| `fresh` | `selected_text` matches at the recorded position |
| `stale` | `selected_text` matches but at a different position, or commit differs |
| `orphaned` | `selected_text` not found in the document |
| `unknown` | No `selected_text` to verify |

| Option | Description |
|---|---|
| `--json` | Output as JSON |

---

### `mrsf init <document>`

Create an empty sidecar file for a Markdown document.

```bash
mrsf init docs/new-feature.md
mrsf init --force docs/existing.md   # overwrite
```

| Option | Description |
|---|---|
| `-f, --force` | Overwrite an existing sidecar |

---

### `mrsf rename <old-document> <new-document>`

Update a sidecar after its source document has been renamed or moved.

```bash
mrsf rename docs/old-name.md docs/new-name.md
```

Updates the `document` field inside the sidecar, writes it to the new path, and removes the old sidecar file.

## Global Options

These apply to all commands:

| Option | Description |
|---|---|
| `--cwd <dir>` | Override the working directory |
| `--config <path>` | Path to `.mrsf.yaml` configuration |
| `--no-color` | Disable coloured output |
| `-q, --quiet` | Suppress informational output |
| `-V, --version` | Print version |
| `-h, --help` | Show help |

## CI/CD Integration

### GitHub Actions

```yaml
name: MRSF Review Lint
on: [pull_request]
jobs:
  mrsf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx @mrsf/cli validate --strict
      - run: npx @mrsf/cli reanchor --staged --dry-run
```

### Git Pre-commit Hook

```bash
#!/usr/bin/env bash
# .git/hooks/pre-commit
npx @mrsf/cli reanchor --staged
npx @mrsf/cli validate --strict
```

### Git Post-merge Hook

```bash
#!/usr/bin/env bash
# .git/hooks/post-merge
npx @mrsf/cli reanchor
```

## Library Usage

The CLI is built library-first. All functionality is available as importable functions:

```typescript
import {
  parseSidecar,
  writeSidecar,
  validate,
  reanchorDocument,
  addComment,
  resolveComment,
  filterComments,
  summarize,
  discoverSidecar,
  discoverAllSidecars,
} from "mrsf";

// Validate a sidecar programmatically
const doc = await parseSidecar("docs/api.md.review.yaml");
const result = await validate(doc);
console.log(result.valid, result.errors, result.warnings);

// Add a comment
const updated = addComment(doc, lines, {
  author: "ci-bot",
  text: "Auto-generated review comment",
  line: 10,
});
await writeSidecar("docs/api.md.review.yaml", updated);
```

## Configuration

Place a `.mrsf.yaml` at your repository root to configure sidecar discovery:

```yaml
# Store all sidecars in a central directory instead of co-located
sidecar_root: .reviews
```

With this config, the sidecar for `docs/architecture.md` is resolved as `.reviews/docs/architecture.md.review.yaml`.

See [§3.2 Alternate Sidecar Location](../MRSF-v1.0.md) in the spec for details.

## Requirements

- Node.js 18 or later
- Git (optional — enables diff-based re-anchoring, commit stamping, rename detection)

## License

MIT — see [LICENSE](../LICENSE).

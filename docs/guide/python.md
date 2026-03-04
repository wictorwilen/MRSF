---
description: "Sidemark (MRSF) Python CLI and SDK — install via pip, use the same commands as the Node.js CLI, or import the library in your Python projects."
---

# Python CLI & SDK

The `mrsf` Python package provides the same CLI commands and a full programmatic SDK, mirroring the Node.js [`@mrsf/cli`](/cli/) package.

## Installation

```bash
pip install mrsf
```

The `mrsf` command is now available in your terminal — with the same commands and options as the Node.js version.

## CLI Usage

All 9 commands from the Node.js CLI are available:

```bash
# Create a sidecar
mrsf init docs/architecture.md

# Add a review comment
mrsf add docs/architecture.md -a "Alice" -t "Needs more detail" -l 12

# Validate all sidecars
mrsf validate

# Re-anchor after edits
mrsf reanchor
mrsf reanchor --staged --force

# Check anchor health
mrsf status

# List & filter comments
mrsf list --open --severity high
mrsf list --summary --json

# Resolve / unresolve
mrsf resolve doc.md.review.yaml abc123
mrsf resolve doc.md.review.yaml abc123 --undo

# Rename document + sidecar
mrsf rename old.md new.md

# Watch for changes
mrsf watch docs/ --reanchor
```

### Global Options

| Option | Description |
|--------|-------------|
| `--cwd <dir>` | Working directory |
| `--config <path>` | Path to `.mrsf.yaml` config |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --verbose` | Detailed diagnostic output |
| `--no-color` | Disable color output |
| `--version` | Show version |

## SDK Usage

Import the library directly in your Python code:

```python
import mrsf

# Parse a sidecar file
doc = mrsf.parse_sidecar("README.md.review.yaml")

# Iterate comments
for comment in doc.comments:
    print(f"{comment.author}: {comment.text} (line {comment.line})")

# Add a comment
opts = mrsf.AddCommentOptions(
    author="Alice",
    text="Consider rephrasing this section",
    line=42,
    selected_text="The quick brown fox",
    type="suggestion",
    severity="medium",
)
new_comment = mrsf.add_comment(doc, opts)

# Write back (preserves YAML formatting)
mrsf.write_sidecar("README.md.review.yaml", doc)
```

### Validation

```python
result = mrsf.validate(doc)
if not result.valid:
    for err in result.errors:
        print(f"Error: {err.message}")

# Or validate a file directly
result = mrsf.validate_file("docs/guide.md.review.yaml")
```

### Re-anchoring

```python
from mrsf import reanchor_document, ReanchorOptions

opts = ReanchorOptions(threshold=0.7, force=True)
results = reanchor_document(doc, document_lines, opts)

for r in results:
    print(f"{r.comment_id}: {r.status} → line {r.new_line} ({r.reason})")
```

### Discovery

```python
# Find sidecar for a document
sidecar_path = mrsf.discover_sidecar("docs/guide.md")

# Find all sidecars in a workspace
sidecars = mrsf.discover_all_sidecars("/path/to/project")

# Load .mrsf.yaml config
config = mrsf.load_config("/path/to/workspace")
```

### Fuzzy Matching

```python
# Combined similarity score
score = mrsf.combined_score("original text", "edited text")

# Search for text across document lines
matches = mrsf.fuzzy_search("search text", ["line 1", "line 2", "line 3"])
```

## Data Types

All types are Python `dataclass` objects with full type annotations:

```python
from mrsf import Comment, MrsfDocument

doc = MrsfDocument(
    mrsf_version="1.0",
    document="guide.md",
    comments=[
        Comment(
            id="abc123",
            author="Alice",
            timestamp="2026-03-04T10:00:00Z",
            text="Fix this heading",
            resolved=False,
            line=5,
            selected_text="# Introduction",
        )
    ],
)
```

## Node.js ↔ Python Parity

The Python SDK is a 1:1 port of the Node.js `@mrsf/cli`. The two packages share:

- **Same CLI commands** — identical flags, options, and arguments
- **Same library functions** — `parse_sidecar`, `write_sidecar`, `validate`, `reanchor_document`, etc.
- **Same test coverage** — 134 tests in both suites
- **Same YAML round-trip behavior** — preserves comments, scalar styles, key ordering
- **Same fuzzy matching algorithm** — exact, normalized, token LCS, Levenshtein

### Naming Conventions

| Node.js | Python |
|---------|--------|
| `camelCase` functions | `snake_case` functions |
| `discoverSidecar()` | `discover_sidecar()` |
| `reanchorFile()` | `reanchor_file()` |
| `addComment()` | `add_comment()` |
| `interface Comment` | `@dataclass Comment` |

## Requirements

- Python ≥ 3.10
- Dependencies: `click`, `jsonschema`, `ruamel.yaml`, `rapidfuzz`, `rich`, `watchdog`

## Development

```bash
cd python
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run tests
pytest -v

# Lint
ruff check src/ tests/

# Type check
mypy src/mrsf/
```

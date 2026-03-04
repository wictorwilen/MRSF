# mrsf — Markdown Review Sidecar Format (Python)

Python CLI and SDK for the [MRSF (Sidemark)](https://github.com/wictorwilen/MRSF) specification. A 1:1 port of the Node.js `@mrsf/cli` package.

## Installation

```bash
pip install mrsf
```

## CLI Usage

```bash
# Validate sidecar files
mrsf validate docs/*.review.yaml
mrsf validate --strict README.md

# Add a comment
mrsf add README.md --author "Alice" --text "Fix this" --line 10

# Re-anchor after edits
mrsf reanchor docs/
mrsf reanchor --staged --force
mrsf reanchor --dry-run --threshold 0.8

# List comments
mrsf list docs/
mrsf list --open --severity high --json

# Resolve/unresolve
mrsf resolve doc.md.review.yaml abc123
mrsf resolve doc.md.review.yaml abc123 --undo

# Check anchor health
mrsf status docs/
mrsf status --json

# Create empty sidecar
mrsf init README.md

# Rename document + sidecar
mrsf rename old.md new.md

# Watch for changes
mrsf watch docs/ --reanchor --force
```

### Global Options

| Option | Description |
|--------|-------------|
| `--cwd <dir>` | Working directory |
| `--config <path>` | Path to `.mrsf.yaml` config |
| `-q, --quiet` | Suppress non-essential output |
| `-v, --verbose` | Detailed diagnostic output |
| `--no-color` | Disable color output |

## SDK Usage

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

# Validate
result = mrsf.validate(doc)
if not result.valid:
    for err in result.errors:
        print(f"Error: {err.message}")

# Re-anchor after edits
results = mrsf.reanchor_document(doc, document_lines)
for r in results:
    print(f"{r.comment_id}: {r.status} ({r.reason})")

# Discover sidecar for a document
sidecar_path = mrsf.discover_sidecar("docs/guide.md")

# Fuzzy text matching
score = mrsf.combined_score("original text", "edited text")
matches = mrsf.fuzzy_search("search text", ["line 1", "line 2", "line 3"])
```

## API Reference

### Parsing

| Function | Description |
|----------|-------------|
| `parse_sidecar(path)` | Parse a `.review.yaml` or `.review.json` file |
| `parse_sidecar_content(content, format)` | Parse sidecar from string content |
| `read_document_lines(path)` | Read document lines for anchoring |

### Writing

| Function | Description |
|----------|-------------|
| `write_sidecar(path, doc)` | Write with round-trip YAML preservation |
| `to_yaml(doc)` | Serialize to YAML string |
| `to_json(doc)` | Serialize to JSON string |
| `compute_hash(text)` | SHA-256 hash for `selected_text_hash` |
| `sync_hash(comment)` | Sync hash with current `selected_text` |

### Comments

| Function | Description |
|----------|-------------|
| `add_comment(doc, opts)` | Add a new comment |
| `resolve_comment(doc, id)` | Mark comment as resolved |
| `unresolve_comment(doc, id)` | Mark comment as unresolved |
| `remove_comment(doc, id, opts)` | Remove with reply promotion (§9.1) |
| `filter_comments(comments, filter)` | Filter by status/author/type/severity |
| `get_threads(comments)` | Group into reply threads |
| `summarize(comments)` | Aggregate statistics |

### Validation

| Function | Description |
|----------|-------------|
| `validate(doc)` | Validate an `MrsfDocument` in memory |
| `validate_file(path)` | Validate a sidecar file on disk |

### Re-anchoring

| Function | Description |
|----------|-------------|
| `reanchor_comment(comment, lines, opts)` | Re-anchor a single comment |
| `reanchor_document(doc, lines, opts)` | Re-anchor all comments in a document |
| `reanchor_file(path, opts)` | High-level file-based re-anchor |

### Discovery

| Function | Description |
|----------|-------------|
| `discover_sidecar(doc_path)` | Find sidecar for a document |
| `discover_all_sidecars(root)` | Find all sidecars in a directory |
| `find_workspace_root(cwd)` | Find workspace root (`.mrsf.yaml` or `.git`) |
| `load_config(root)` | Load `.mrsf.yaml` configuration |

### Fuzzy Matching

| Function | Description |
|----------|-------------|
| `exact_match(needle, haystack)` | Find exact substring matches |
| `normalized_match(needle, haystack)` | Whitespace-normalized matching |
| `fuzzy_search(needle, lines)` | Multi-line fuzzy search with scoring |
| `combined_score(a, b)` | Combined similarity score (0.0–1.0) |

### Git Integration

| Function | Description |
|----------|-------------|
| `is_git_available()` | Check if `git` is on PATH |
| `find_repo_root(cwd)` | Find `.git` root directory |
| `get_current_commit(root)` | Get HEAD commit SHA |
| `get_diff(commit, path, root)` | Get unified diff output |
| `get_line_shift(commit, path, line, root)` | Compute line shift from diff |

## Data Types

```python
@dataclass
class MrsfDocument:
    mrsf_version: str
    document: str
    comments: list[Comment]

@dataclass
class Comment:
    id: str
    author: str
    timestamp: str
    text: str
    resolved: bool = False
    line: int | None = None
    end_line: int | None = None
    selected_text: str | None = None
    selected_text_hash: str | None = None
    type: str | None = None
    severity: str | None = None  # "low" | "medium" | "high"
    reply_to: str | None = None
    commit: str | None = None
    # ... plus start_column, end_column, anchored_text
```

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

## License

MIT — see [LICENSE](../LICENSE).

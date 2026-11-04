# mrsf

Native, synchronous, **library-only** Rust support for Markdown Review Sidecar
Format (MRSF), also known as [Sidemark](https://sidemark.org). No Node.js, Python,
CLI, network service, or asynchronous runtime is needed. Git is optional and is
used only for revision evidence.

- Crate version: **0.1.1**.
- Supported format: **MRSF 1.x**, with `mrsf_version: "1.0"` for new files.
- Minimum supported Rust version: **1.88.0**, edition 2021.
- License: MIT.

The crate version is **not** the sidecar's `mrsf_version`. Unknown major format
versions are rejected. Newer v1 minor versions are accepted with a warning and
unknown fields remain intact.

## Installation

Install the published [mrsf crate](https://crates.io/crates/mrsf) in your
application with Rust 1.88 or later:

```bash
cargo add mrsf
```

Or add the dependency to your `Cargo.toml`:

```toml
[dependencies]
mrsf = "0.1"
```

Browse the [0.1.1 API documentation](https://docs.rs/mrsf/0.1.1/mrsf/).
The [standalone usage samples](https://github.com/wictorwilen/MRSF/tree/main/examples/rust-sdk)
pin the published version and demonstrate sidecar round trips, threaded comments,
UTF-16 selections, and reanchoring without requiring a local SDK build.

Contributors editing this crate can use `mrsf = { path = "../rust" }` instead;
that is a development override, not needed by applications.

### Parse, inspect, and validate

```rust
use mrsf::{parse_sidecar_content, validate, Format};

let source = r#"
mrsf_version: "1.0"
document: guide.md
comments: []
x_workspace:
  name: "日本語"
"#;
let doc = parse_sidecar_content(source, Format::Yaml)?;
let report = validate(&doc);
assert!(report.valid);
assert_eq!(doc.extra["x_workspace"]["name"], "日本語");
# Ok::<(), mrsf::Error>(())
```

`parse_sidecar(path)` reads UTF-8 YAML or JSON according to the filename
extension. `parse_sidecar_content(content, Format::Yaml | Format::Json)` uses an
explicit format. Both are **strict**: raw values are schema-validated before
typed deserialization, so malformed fields produce diagnostics rather than
being silently dropped. Missing required fields are errors. Diagnostics include
JSON-pointer paths; `validate_file(path)` reports raw field errors too.

`validate(&doc)` returns a `ValidationResult` directly. Its `errors` and
`warnings` are separate; `valid` normally means no errors.
`validate_with_options(&doc, ValidateOptions { strict: true })` also makes
warnings fail validation. Timestamp formats, duplicate ids, range ordering,
hash consistency, unresolved replies, and thread cycles are checked.

Explicit recovery is available through `parse_sidecar_lenient(path)` and
`parse_sidecar_content_lenient(content, format)`. Their `ParsedDocument` contains
both `document` and the **original** `diagnostics`. Recovery supplies missing
required scalar defaults, removes invalid optional field types, and skips
non-object comments. It does not repair broken YAML/JSON syntax or accept an
unknown major. Recovered documents must be reviewed and validated before writing.

### Author and update comments

```rust
use mrsf::{add_comment, resolve_comment, AddCommentOptions, MrsfDocument};

let mut doc = MrsfDocument::new("guide.md");
// Clone the small id, not the entire comment. This ends the returned borrow
// before the next operation mutably borrows the document.
let id = add_comment(&mut doc, AddCommentOptions {
    author: "Reviewer".into(),
    text: "Clarify this paragraph.".into(),
    selected_text: Some("😀 日本語".into()),
    ..Default::default()
})?.id.clone();
assert!(resolve_comment(&mut doc, &id));
assert!(doc.comments[0].resolved);
# Ok::<(), mrsf::Error>(())
```

`add_comment` generates a UUID and RFC 3339 UTC timestamp unless supplied. It
computes `selected_text_hash` from the UTF-8 bytes of a supplied selection.
`compute_hash(text)` exposes the same lowercase SHA-256 digest.
Adding a comment validates a prospective document before mutating the original.

Optional wire fields use `Option<T>`: `None` means absent, while `Some(0)` and
`Some("")` remain distinct values. The wire field `type` is `r#type` in Rust
because `type` is a Rust keyword. Unknown fields live in `.extra`, an ordered
`serde_json::Map<String, Value>`; they serialize at the same object level, not
under an `extra` key. Unknown objects/arrays remain nested and retain their data.
Extra fields must not shadow modeled field names. Newly authored extensions via
`AddCommentOptions::extensions` must start with `x_`.

Resolving a parent **does not resolve replies**. Use `resolve_thread` only for
explicit cascading resolution. `remove_comment(&mut doc, id,
RemoveCommentOptions::default())` promotes direct replies, copies parent
targeting only when the reply has no targeting of its own, and reparents them to
the grandparent. `cascade: true` deletes the complete descendant tree.
`filter_comments`, `get_threads`, and `summarize` provide borrowed views and
counts. Thread walks terminate even when malformed input contains cycles.

### Write without destroying human YAML

```rust,no_run
use mrsf::{parse_sidecar, resolve_comment, write_sidecar};

let path = "guide.md.review.yaml";
let mut doc = parse_sidecar(path)?;
resolve_comment(&mut doc, "review-id");
write_sidecar(path, &doc)?;
# Ok::<(), mrsf::Error>(())
```

Use `to_yaml(&doc)` / `to_json(&doc)` for **new serialization**. Use
`write_sidecar(path, &doc)` for existing files:

1. Validate the document and existing input.
2. Edit the existing YAML concrete syntax tree with **oneyaml**.
3. Check all resulting values and retention of every original YAML comment.
4. Write a uniquely named sibling file, flush it, and atomically rename it.

No whole-document YAML dump or regular-expression editing fallback exists.
No-op YAML and JSON writes retain the original bytes. Targeted YAML changes
preserve unchanged comments, quote/block scalar styles, ordering, whitespace,
and LF/CRLF endings. Nested extension edits and comment additions/removals are
covered by executable preservation tests. A public pure helper,
`update_yaml(original, &doc)`, returns the proposed source without writing it.

**Explicit preservation limits:**

- Reordering existing comments is rejected. Adding/removing comments without
  changing the relative order of survivors is supported.
- YAML annotations inside deleted/replaced nodes cannot stay attached to those
  nodes; their comment text is retained in the document footer. Their placement
  and `#` spacing may change. Existing surviving content is not dumped.
- If displaced annotations would require changing existing footer layout or
  spelling (for example blank-line spacing or `#no-space`), the transaction is
  rejected rather than silently normalizing unchanged text.
- Aliases/merge keys are accepted on read when representable in the JSON data
  model. Edits whose alias side effects change unintended values are rejected.
- Unsupported CST edits return an explicit error. The original file is left
  unchanged; the writer never silently reformats it.

The writer preserves existing file permissions. It does not provide a
multi-process locking protocol: applications editing concurrently should add
their own coordination. JSON changes use pretty serialization; YAML-style
format-preserving editing is not promised for changed JSON files.

### UTF-16 columns, not Rust byte indexes

MRSF lines are **1-based**. Columns are **0-based UTF-16 code units** and
half-open (`start_column` inclusive, `end_column` exclusive). The emoji in
`😀 foo` occupies two code units; `foo` is columns `3..6`.

```rust
use mrsf::{utf16_length, utf16_slice};

assert_eq!(utf16_length("😀 foo"), 6);
assert_eq!(utf16_slice("😀 foo", 3, Some(6))?, "foo");
assert!(utf16_slice("😀 foo", 1, None).is_err()); // splits a surrogate pair
# Ok::<(), mrsf::Error>(())
```

`utf16_to_byte` safely converts to a Rust UTF-8 boundary. Offsets past the end
clamp to the line end; boundaries inside a surrogate pair fail explicitly.
`to_reanchor_lines(text)` creates the shared **1-based array**: element zero is
an unused empty string. All line-array APIs, including `populate_selected_text`
and `extract_text`, use that convention.

### Reanchor using pure text or Git evidence

```rust
use mrsf::{
    add_comment, reanchor_document_with_source, to_reanchor_lines,
    AddCommentOptions, MrsfDocument, ReanchorOptions, ReanchorStatus,
};

let source = to_reanchor_lines(
    "# Guide\n\nDurable selection.\nUnique following context.\nAnother context line.\n",
);
let target = to_reanchor_lines(
    "# Guide\n\nInserted paragraph.\n\nDurable selection.\nUnique following context.\nAnother context line.\n",
);
let mut doc = MrsfDocument::new("guide.md");
add_comment(&mut doc, AddCommentOptions {
    author: "Reviewer".into(), text: "Review.".into(),
    line: Some(3), selected_text: Some("Durable selection.".into()),
    ..Default::default()
})?;
let results = reanchor_document_with_source(
    &doc, &source, &target, &ReanchorOptions::default(),
);
assert_eq!(results[0].status, ReanchorStatus::Anchored);
assert_eq!(results[0].new_line, Some(5));
# Ok::<(), mrsf::Error>(())
```

The complete native **Anchor Mesh** pipeline includes verified Git shifts,
source-verified revision projection, Markdown structural/bidirectional context,
confidence calibration and abstention, bounded lexical/Unicode-character fuzzy
retrieval, and heading-scoped global reconciliation. It passes the shared corpus
of **88 comments**, including expected statuses and ranges.

| API | Evidence and side effects |
|---|---|
| `reanchor_comment(&comment, &lines)` | Current text, default options; pure |
| `reanchor_comment_with_options` | Current text, explicit options; pure |
| `reanchor_comment_with_evidence` | Explicit borrowed shared indexes/diff; pure |
| `reanchor_document(&doc, &lines, &options)` | Current text, shared fuzzy index; pure |
| `reanchor_document_with_source` | Previous/current snapshots and full pure mesh |
| `reanchor_document_at_path` | Working file plus cached native Git evidence |
| `apply_reanchor_results` | Mutates the in-memory document, never deletes orphans |
| `reanchor_file(path, &options)` | Reads, resolves workspace document, optionally writes |

`anchored`/`shifted` are confident; `fuzzy` is tentative; `ambiguous` and
`orphaned` require review. Scores summarize evidence, not probabilities.
Original `selected_text` and its hash are preserved by default. Edited matches
populate `anchored_text`; `update_text: true` explicitly replaces the original
selection **and recomputes its hash**. `dry_run: true` prevents file changes;
`no_git: true` disables Git entirely.

Fuzzy candidate lines and structural candidate blocks are capped at 64;
reconciliation requires two nearby same-heading landmarks and runs at most four
rounds. The default fuzzy threshold is 0.6 and the unverified exact-relocation
proximity window is five lines. Source verification prevents an incorrect stored
revision from creating trusted context evidence.

### Line-only anchors and repeated editor updates

A stored `commit` does **not** prove that an already-applied range still uses
that revision's coordinates. For a line-only comment (no nonempty
`selected_text`), the first Git displacement is certain only when the entire
source range is unchanged. The result captures its current text in the existing,
schema-validated `anchored_text` string. Explicitly positional current-text
results also capture their range when applied, including a `force` operation
without an original source revision. Applying these results never adds/replaces
the original `selected_text` by default.

Subsequent calls verify that captured range rather than repeatedly adding the
old revision's displacement. An unchanged range is a no-op. If its text moves,
reattachment is deliberately **tentative** (`fuzzy`, score `0.5`), and remains
tentative on repeated runs. Changed empty captures abstain. Already-captured
line-only ranges are not source-coordinate landmarks for other comments.
Pure source-snapshot calls without a verified displacement abstain when the
line-only source range changed; a surviving line number alone is not proof.

A line-only range requiring more than 4096 Unicode characters of captured text
returns `ambiguous` without moving it. This keeps the sidecar schema-valid and
avoids truncating the evidence used by later calls; narrow or explicitly
retarget such a range before accepting a relocation.

This conservative behavior also applies with `from_commit` and `force`: an
override cannot establish a range's missing source-coordinate provenance, and
HEAD may still exclude uncommitted edits. Compared with selected-text anchors,
later line-only moves therefore lose certain Git relocation rather than risking
coordinate drift. Editors retaining original source coordinates can explicitly
construct a fresh source-coordinate comment; do not simply clear its capture
while leaving target coordinates attached to an old commit. No new extension
metadata is introduced.

Exact inline matches use UTF-16 columns to distinguish same-line occurrences.
An unrelated replacement at an existing line does not count as a successful
anchor. Successful recovery also reconciles stale orphan/fuzzy metadata even
when coordinates do not change; repeated recovery is a no-op. A prior certain
`shifted` marker is retained as movement history on unchanged successful runs.

## Discovery and Git

`discover_sidecar(document, cwd)` resolves exactly one authoritative YAML path.
`find_workspace_root` walks toward `.mrsf.yaml` or `.git`; `load_config` validates
the bundled config schema. A configured `sidecar_root` **never falls back** to a
co-located file, even if the redirected path does not yet exist.

`safe_relative_path` rejects traversal, absolute paths, drive prefixes, and UNC
forms on every platform. `resolve_document_path` also checks existing ancestors
for symlink escapes. These checks are not a replacement for OS-level filesystem
sandboxing against hostile concurrent symlink replacement.
`sidecar_to_document` strips standard suffixes; for redirected sidecars, resolve
the parsed `document` field against the workspace instead.
`discover_all_sidecars` skips directory symlinks and common dependency/cache
directories and returns sorted paths.

`mrsf::git::Git` offers repository, revision, file-at-commit, diff, username, and
staged-file helpers. Calls use argument arrays without a shell and enforce a
**10-second deadline**, concurrently draining stdout/stderr. Missing Git returns
`Ok(None)` (or `false` for availability); invalid revisions, timeouts, permission
problems, and other real operation failures return typed errors. Source revisions
are canonicalized before use, and file comparisons include working-tree edits.

## Errors and API organization

`mrsf::Result<T>` aliases `Result<T, mrsf::Error>`. Use `?` to propagate I/O,
parsing, validation, path, Git, and preservation failures, or match the error
variants when recovery is appropriate. `Error::Validation` owns all diagnostics;
it does not discard the malformed field context.

Common models/helpers are reexported at the crate root. Advanced matching APIs
are organized under `fuzzy`, `revision`, `context`, `calibration`, and
`reconciliation`; native process helpers live under `git`. The source includes
module/API documentation and explanations of the safety invariants and
non-obvious Rust borrowing, string-indexing, and error-propagation decisions.

## Development and interoperability

Run from `rust/`:

```text
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo test --doc
cargo +1.88.0 test --locked --all-features
cargo package --allow-dirty --locked
```

Both canonical schemas are embedded under `schemas/`. Tests compare them with
the repository copies when present. Language-neutral reanchoring fixtures are
bundled under `tests/fixtures/`, so package verification/tests do not need files
outside the crate. Test scratch files stay under `target/test-work/`. The one
ignored unit-test helper is a subprocess fixture; the timeout test explicitly
executes it to prove the ten-second kill/reap behavior.

The `interoperability` **example**, not an installed binary, implements the
cross-language harness protocol:

```text
cargo run --example interoperability -- create yaml guide.md.review.yaml
cargo run --example interoperability -- create json guide.md.review.json
cargo run --example interoperability -- validate guide.md.review.yaml
cargo run --example interoperability -- update guide.md.review.yaml updated.review.yaml
```

`create` authors a deterministic root comment with Unicode/nested `x_shared`
and document-level `x_workspace`. `update` resolves the root, adds nested
`x_rust`, copies source bytes to a distinct destination, and uses the safe writer.
`validate` exits unsuccessfully with diagnostics for malformed input.

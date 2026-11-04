---
description: "Embed MRSF sidecar support in Rust applications with the native, library-only mrsf crate."
---

# Rust SDK

The native `mrsf` crate embeds Markdown Review Sidecar Format support in Rust
applications. It does not wrap the Node.js or Python SDK, require their runtimes,
or install another `mrsf` CLI.

Use the existing [Node.js CLI](/cli/) for terminal workflows.

## Installation

The [mrsf crate is published on crates.io](https://crates.io/crates/mrsf).
Rust 1.88 or later is required. Add it to an existing application:

```bash
cargo add mrsf
```

Or edit your application's `Cargo.toml`:

```toml
[dependencies]
mrsf = "0.1"
```

The crate version and the sidecar's `mrsf_version` are independent: MRSF v1.0
files use `mrsf_version: "1.0"`. See the
[0.1.0 API reference](https://docs.rs/mrsf/0.1.0/mrsf/) for complete signatures.

## Read and validate

```rust
use mrsf::{parse_sidecar, validate};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let doc = parse_sidecar("guide.md.review.yaml")?;
    let report = validate(&doc);
    if !report.valid {
        return Err(format!("Invalid sidecar: {:?}", report.errors).into());
    }

    for comment in &doc.comments {
        println!("{}: {}", comment.author, comment.text);
    }
    Ok(())
}
```

YAML and JSON use the same MRSF data model.

## Author and resolve a thread

```rust
use mrsf::{add_comment, resolve_comment, AddCommentOptions, MrsfDocument};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut doc = MrsfDocument::new("guide.md");
    // Clone the returned id to end the borrow before mutating doc again.
    let parent_id = add_comment(&mut doc, AddCommentOptions {
        author: "Reviewer".into(),
        text: "Clarify this paragraph.".into(),
        ..Default::default()
    })?.id.clone();
    add_comment(&mut doc, AddCommentOptions {
        author: "Another reviewer".into(),
        text: "This reply remains independently open.".into(),
        reply_to: Some(parent_id.clone()),
        ..Default::default()
    })?;
    if !resolve_comment(&mut doc, &parent_id) {
        return Err("The parent comment was not found".into());
    }
    assert!(doc.comments[0].resolved);
    assert!(!doc.comments[1].resolved);
    Ok(())
}
```

## Run published-crate samples

The [standalone Rust samples](https://github.com/wictorwilen/MRSF/tree/main/examples/rust-sdk)
pin `mrsf = "=0.1.0"` from crates.io. They do not use a local path dependency or
require Node.js or Python. From the sample's directory, run:

```bash
cargo run --locked
cargo run --locked --example reanchor
cargo test --locked --all-targets
```

The first program creates an inline selection with UTF-16 columns, adds a
reply, resolves only the parent, and round-trips both YAML and JSON. The
reanchoring sample uses source and target document snapshots to relocate a
comment without overwriting its original selection. Both print output without
modifying your files, and their tests check the results against the published API.

## Compatibility

- Sidecar fields retain their serialized `snake_case` names.
- Lines are 1-based. Columns are 0-based **UTF-16 code-unit offsets**, not Rust
  byte offsets or Unicode scalar counts. End columns are exclusive.
- Unknown fields and tool-specific `x_*` extension data must survive updates.
- Resolving a parent does not resolve its replies. Removing a parent promotes
  or reparents its direct replies rather than silently deleting them.
- `selected_text` records the reviewer's original selection. Reanchoring must
  not overwrite it without an explicit opt-in.
- Configured sidecar locations are authoritative; do not combine configured
  and co-located files into a single review.

The normative contract is the [MRSF specification](/specification). The
[Anchor Mesh guide](./reanchoring) describes the repository's non-normative
reanchoring algorithm and the evidence used to avoid incorrect relocations.

For line-only anchors, Rust captures the verified current range in
`anchored_text` without changing the original selection. Later calls verify
that capture rather than reapplying a stale Git displacement. Later text-only
relocations remain tentative; a capture exceeding the schema's 4096-character
limit requires reviewer retargeting. The crate README describes these
conservative boundaries and the effect of `force` and source-revision overrides.

## Safe writing

Use the file-writing APIs to update existing sidecars. String serialization is
for creating fresh output and is not a substitute for format-preserving editing.
Existing YAML comments, scalar styles, and unchanged content should remain
intact. An unsupported lossless edit must return an error rather than silently
rewrite or strip human-authored annotations.

## Development

Only contributors changing the SDK need a repository checkout. A path dependency
such as `mrsf = { path = "../mrsf/rust" }` can be used to test local SDK changes;
applications should normally use the crates.io dependency above.

Run the following inside `rust`:

```bash
cargo fmt --all -- --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-features
cargo doc --no-deps
cargo package --locked
```

CI checks Windows and Linux with the declared minimum Rust version and stable.
The packaged crate includes its schemas; downstream applications do not need a
checkout of this repository.

The repository also checks cross-language YAML and JSON round trips. After
building the Node SDK and installing the Python SDK, run from the repository
root:

```bash
python examples/test-rust-interop.py
```

This development harness uses a Rust example program, not a distributed CLI.

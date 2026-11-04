---
description: "Embed MRSF sidecar support in Rust applications with the native, library-only mrsf crate."
---

# Rust SDK

The native `mrsf` crate embeds Markdown Review Sidecar Format support in Rust
applications. It does not wrap the Node.js or Python SDK, require their runtimes,
or install another `mrsf` CLI.

Use the existing [Node.js CLI](/cli/) for terminal workflows.

## Installation from source

The crate lives in the repository's `rust` directory. Until a crates.io release
is published, use a path dependency pointing to your checkout:

```toml
[dependencies]
mrsf = { path = "../mrsf/rust" }
```

The path is relative to your application's manifest. The crate version and
the sidecar's `mrsf_version` are independent: MRSF v1.0 files use
`mrsf_version: "1.0"`.

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

YAML and JSON use the same MRSF data model. Consult the crate's README and
generated Rust API documentation for mutation, discovery, and reanchoring
signatures.

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

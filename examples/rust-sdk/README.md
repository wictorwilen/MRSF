# Published MRSF Rust SDK samples

These are applications of the [published `mrsf` 0.1.0 crate](https://crates.io/crates/mrsf/0.1.0),
not examples linked to the repository's local SDK. You can copy this directory
outside the repository and run it independently with Rust 1.88 or later.
The lockfile pins the dependencies used to validate the samples.

From this directory:

```bash
cargo run --locked
cargo run --locked --example reanchor
cargo test --locked --all-targets
```

No Node.js, Python, Git repository, or input files are required. The programs
print their output and do not write Markdown or sidecar files.

## Comment lifecycle and serialization

[`src/main.rs`](src/main.rs) demonstrates:

- parsing a YAML sidecar;
- adding a selection with 1-based lines and zero-based UTF-16 columns;
- cloning a returned id to end a borrow before another document mutation;
- adding a reply and resolving the parent independently;
- preserving an `x_*` extension while round-tripping YAML and JSON;
- surfacing validation failures rather than continuing with an invalid sidecar.

## Source-aware reanchoring

[`examples/reanchor.rs`](examples/reanchor.rs) retains an original Markdown
snapshot and compares it with an edited snapshot. It resolves the moved
selection, applies the result, and preserves the original selected text/hash.
Ambiguous or orphaned results are surfaced as errors in this sample so a real
application can request reviewer action instead of silently accepting them.

The crate is library-only. These small executable applications are usage
samples, not a second `mrsf` CLI.

For general application dependencies, use `mrsf = "0.1"` or `cargo add mrsf`.
This sample pins `=0.1.0` deliberately so CI verifies that particular published
release rather than a local development version.

[Full API reference](https://docs.rs/mrsf/0.1.0/mrsf/)

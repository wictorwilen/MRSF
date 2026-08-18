# Reanchoring evaluation corpus

The corpus records desired reanchoring outcomes independently of the current
implementation. A case contains source and target Markdown, original comment
anchors, and the acceptable target status and ranges.

`cases/diagnostic/core.json` contains 50 focused scenarios covering:

- insertions, deletions, rewrites, moves, splits, and merges;
- inline, multiline, heading, list, table, code, and blockquote anchors;
- whitespace, line-ending, punctuation, and Unicode changes;
- repeated text, missing positions, copied selections, and teleport hazards;
- ambiguous and orphaned outcomes where an implementation must not guess.

Run the corpus from `cli/`:

```bash
npm run eval:reanchor
npm run eval:reanchor -- --json
npm run eval:reanchor:baseline
```

The command exits non-zero when outcomes differ from the expected results.
That is intentional while evaluating the baseline. Corpus validation itself is
covered by `cli/src/__tests__/reanchor-eval.test.ts`.

`baseline.json` is a deterministic snapshot of the current implementation. The
baseline command succeeds while behavior matches that snapshot, including its
known gaps, and fails when any outcome changes. Intentionally refresh it with:

```bash
npm run eval:reanchor -- --write-baseline ../evaluation/reanchor/baseline.json
```

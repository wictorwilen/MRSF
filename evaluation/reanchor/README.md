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
npm run --silent eval:reanchor -- --json
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

Generate reproducible mutation cases with:

```bash
npm run eval:reanchor:generate -- \
  --seed 1000 \
  --cases 100 \
  --blocks 20 \
  --comments 5 \
  --mutations 8 \
  --output ../evaluation/reanchor/generated/seed-1000.json
```

Each generated case records its seed and exact operation sequence. Semantic
block identities are tracked through insertions, deletions, moves, rewrites,
duplication, reordering, whitespace changes, splits, merges, and heading
renames, allowing expected anchor ranges to be derived rather than guessed.

Four file-backed realistic revisions cover API documentation, an operational
runbook, an architecture document, and an end-user guide. Run all committed
cases with `npm run eval:reanchor`.

Generated scaling profiles live in `workloads.json`:

| Profile | Cases | Blocks/case | Comments/case |
| --- | ---: | ---: | ---: |
| small | 100 | 20 | 5 |
| medium | 100 | 200 | 20 |
| large | 20 | 2,000 | 100 |
| stress | 5 | 10,000 | 200 |

Run a profile without writing generated fixtures:

```bash
npm run eval:reanchor:profile -- --profile small
npm run --silent eval:reanchor:profile -- --profile medium --json
```

Profile reports include pass rate, incorrect confident relocations, total and
per-comment time, median, p95, and worst-case comment time. Large and stress
profiles are intended for deliberate performance runs rather than normal CI.

`reports/initial-baseline.json` records the first small, medium, and large runs.
It is informational because timings depend on hardware and runtime conditions;
`baseline.json` remains the deterministic correctness checkpoint.

Subsequent algorithm checkpoints may add informational comparison reports under
`reports/`. They never replace the deterministic per-case baseline.

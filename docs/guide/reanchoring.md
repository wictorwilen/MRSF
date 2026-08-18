---
description: "Non-normative implementation guide to the Anchor Mesh reanchoring algorithm used by this repository."
---

# Reanchoring implementation

> [!IMPORTANT]
> This page is **non-normative**. It documents the current implementation in
> this repository, not a requirement of the MRSF specification. Other MRSF
> implementations may use different algorithms while producing compatible
> sidecar files.

MRSF stores review anchors separately from Markdown. When the Markdown changes,
the implementation must decide whether an anchor stayed in place, moved, was
edited, became ambiguous, or disappeared.

The repository implementation is called **Anchor Mesh**. It combines several
independent signals instead of treating fuzzy text similarity as the sole
source of truth:

- Git revision and diff evidence
- source-to-target line projection
- Markdown block structure and heading scope
- bounded lexical and character-level retrieval
- nearby high-confidence comments as landmarks
- explicit confidence calibration and abstention

The design goal is to relocate comments confidently when evidence agrees and
to return `ambiguous` or `orphaned` rather than make a plausible-looking guess.

## Execution modes

| Runtime/API | Available evidence |
|---|---|
| CLI, VS Code, MCP file operations | Full Git-aware pipeline when repository and commit information are available |
| Python file operations | Equivalent Git-aware pipeline |
| `@mrsf/cli/browser` high-level helpers | Current document text, exact/normalized matching, bounded fuzzy retrieval, and positional guards |
| Advanced browser/editor integrations | May retain a previous document snapshot and explicitly use revision projection, structural context, calibration, and reconciliation APIs |

The matching core uses strings, arrays, maps, tokenization, and deterministic
scoring. Filesystem, process, and Git operations are kept in the Node and
Python orchestration layers so the core remains portable.

## Pipeline

### 1. Prepare shared evidence

For Git-aware reanchoring, the orchestrator:

1. resolves abbreviated and full revision names to canonical commit IDs;
2. reads the source document at the comment revision;
3. computes the Git diff to the current document;
4. creates revision, Markdown block, and fuzzy-search indexes;
5. caches these values for comments sharing the same source revision.

This avoids repeating Git operations and full-document indexing for every
comment.

### 2. Apply verified diff shifts

An unchanged line mapped by Git diff is the cheapest strong signal. The
algorithm shifts the stored range and verifies that `selected_text` still
matches at the projected location.

Line-only comments can also use the diff displacement because there is no
selected text to verify.

### 3. Project from the source revision

The revision index maps lines that are unique and unchanged between source and
target documents. Nearby mapped lines vote for a displacement of the original
anchor range.

Before projection, `selected_text` must match the stored source location. This
prevents an incorrect commit or stale sidecar position from becoming trusted
evidence.

An exact relocation requires at least two independent context signals with the
same displacement. A single neighboring match is deliberately insufficient:
copied text plus one copied neighbor is a common teleportation hazard.

Edited text may still be projected when neighboring votes agree and similarity
remains above the configured threshold.

### 4. Match Markdown structure

Source and target documents are divided into:

- headings
- paragraphs
- lists
- tables
- fenced code blocks
- blockquotes

Candidates are compared using block content, block type, heading path,
preceding and following blocks, and source proximity. Bidirectional context is
important: repeated text often becomes unique when both its previous and next
blocks are considered.

Candidate retrieval uses token postings and examines at most 64 context blocks
before detailed scoring.

### 5. Calibrate independent evidence

Revision and structural results are combined into internal confidence bands:

| Band | Meaning | Typical public result |
|---|---|---|
| `certain` | Source-verified exact evidence | `anchored` or `shifted` |
| `probable` | Independent evidence agrees, or one source has a decisive margin | `fuzzy` |
| `ambiguous` | Strong signals disagree or candidates are too close | `ambiguous` |
| `orphaned` | Deletion evidence outweighs weak relocation evidence | `orphaned` |

Agreement increases confidence conservatively. Conflicting signals do not get
averaged into an apparently safe answer.

### 6. Use bounded text matching

When revision or structural evidence cannot resolve the anchor, the core
fallback sequence is:

1. exact text matching;
2. normalized-whitespace matching;
3. high-confidence fuzzy matching;
4. original line/column fallback;
5. lower-threshold fuzzy matching;
6. orphaning.

Exact matches are protected by a relocation guard. If the chosen exact match is
farther than the proximity window from the original line while the original
text has changed, the implementation keeps the original position as a
tentative `fuzzy` result instead of jumping to unrelated identical text.

Fuzzy retrieval indexes rare lexical tokens and Unicode character trigrams.
Only shortlisted lines and nearby multiline windows receive the more expensive
token-LCS and Levenshtein scoring. Candidate lines are capped at 64.

### 7. Reconcile comments as a group

Comments in the same heading scope can help resolve one another. Certain
`anchored` and `shifted` results become landmarks describing local
source-to-target displacement.

An ambiguous exact candidate may be promoted only when:

- at least two nearby landmarks support it;
- landmark support is at least `0.65`;
- it beats the next candidate by at least `0.08`;
- the landmarks are within 30 source lines and the same heading scope.

Reconciliation runs for at most four rounds. Newly confirmed anchors may become
landmarks for a later round.

## Public results

The implementation returns the existing public statuses:

| Status | Meaning |
|---|---|
| `anchored` | Confident anchor, including an unchanged location |
| `shifted` | Confident position moved by verified diff evidence |
| `fuzzy` | Probable or tentative location that may need review |
| `ambiguous` | Multiple locations or conflicting evidence |
| `orphaned` | No defensible location remains |

Scores are evidence summaries used by repository integrations. They are not
probabilities and should not be interpreted as a cross-implementation MRSF
contract.

## Current tuning values

These values describe the current implementation and may change as the
evaluation corpus evolves:

| Setting | Value |
|---|---:|
| Default fuzzy threshold | `0.6` |
| High fuzzy threshold | `0.8` |
| Exact relocation proximity window | 5 lines |
| Revision context radius | 8 lines |
| Maximum fuzzy candidate lines | 64 |
| Maximum structural candidate blocks | 64 |
| Structural match threshold | `0.35` |
| Structural ambiguity margin | `0.03` |
| Reconciliation landmark window | 30 lines |
| Minimum supporting landmarks | 2 |
| Maximum reconciliation rounds | 4 |

Applications should use the public options rather than depend on internal
constants.

## Complexity and performance

The expensive work is bounded and shared:

- exact and normalized scans are linear in document size;
- indexes are built once per document or source revision;
- fuzzy verification is limited to shortlisted candidate windows;
- structural verification is limited to shortlisted blocks;
- Git source, diff, and context data are cached by canonical commit;
- group reconciliation considers at most eight structural candidates per
  ambiguous comment.

The repository gates correctness and performance separately. Performance gates
cover per-comment latency, p95 latency, worst-case comment latency, and
worst-case reconciliation latency.

## Evaluation

The language-neutral corpus under `evaluation/reanchor/` contains focused,
realistic, generated, and scaling cases. Both TypeScript and Python run against
the committed corpus.

From `cli/`:

```bash
npm run eval:reanchor:baseline
npm run eval:reanchor:profile -- --profile medium
npm run eval:reanchor:profile -- \
  --profile stress \
  --gate ../evaluation/reanchor/gates.json \
  --gate-mode performance
```

The primary safety metric is **incorrect confident relocations**. Tentative
`fuzzy` results are tracked separately from confident `anchored` and `shifted`
decisions, preserving the algorithm's preference for reviewable abstention.

## Source map

| Concern | TypeScript | Python |
|---|---|---|
| Core pipeline | `cli/src/lib/reanchor-core.ts` | `python/src/mrsf/reanchor.py` |
| Git-aware orchestration | `cli/src/lib/reanchor.ts` | `python/src/mrsf/reanchor.py` |
| Revision projection | `cli/src/lib/revision-projection.ts` | `python/src/mrsf/revision_projection.py` |
| Markdown context | `cli/src/lib/anchor-context.ts` | `python/src/mrsf/anchor_context.py` |
| Bounded fuzzy retrieval | `cli/src/lib/fuzzy.ts` | `python/src/mrsf/fuzzy.py` |
| Confidence calibration | `cli/src/lib/confidence-calibration.ts` | `python/src/mrsf/confidence_calibration.py` |
| Group reconciliation | `cli/src/lib/global-reconciliation.ts` | `python/src/mrsf/global_reconciliation.py` |


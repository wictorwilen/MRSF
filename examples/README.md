# MRSF Examples

This folder contains example Markdown files paired with MRSF sidecar files.
Each pair demonstrates a different aspect of the specification with emphasis on
re-anchoring scenarios from §7.4.

## Examples at a Glance

| Document | Sidecar | Scenario |
| --- | --- | --- |
| [`architecture.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/architecture.md) | [`architecture.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/architecture.md.review.yaml) | **Baseline** — simple sidecar with line-only and column-span comments |
| [`api-reference.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/api-reference.md) | [`api-reference.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/api-reference.md.review.yaml) | **Shifted text** (§7.4 Step 1) — lines were inserted above the anchored text; line numbers are stale but `selected_text` still matches exactly at a new position |
| [`deployment-guide.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/deployment-guide.md) | [`deployment-guide.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/deployment-guide.md.review.yaml) | **Fuzzy / contextual match** (§7.4 Step 3) — text was reworded, a typo fixed, and a sentence split; exact match fails but fuzzy similarity is high |
| [`security-policy.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/security-policy.md) | [`security-policy.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/security-policy.md.review.yaml) | **Disambiguation** (§7.4 Step 1b) — identical phrases appear at multiple locations; line/column hints resolve ambiguity, or the comment is flagged ambiguous when hints are absent |
| [`contributing.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md) | [`contributing.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md.review.yaml) | **Orphaned comments + line-only fallback** (§7.4 Steps 2 & 4) — sections were deleted; some comments have no `selected_text` and rely on line numbers alone |
| [`data-model.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/data-model.md) | [`data-model.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/data-model.md.review.yaml) | **Threaded replies, mixed states, extensions** — `reply_to` threading, resolved vs open, `x_` extension fields, document-level comments, and `selected_text_hash` |

## Re-anchoring Strategy Summary

The table below maps each §7.4 step to the example that exercises it:

| Step | Description | Example file |
| --- | --- | --- |
| **Step 1a** | Exact text match — single hit | [`api-reference.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/api-reference.md.review.yaml) |
| **Step 1b** | Exact text match — multiple hits, disambiguate with line/column | [`security-policy.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/security-policy.md.review.yaml) |
| **Step 1b** | Exact text match — multiple hits, no line hint → ambiguous | [`security-policy.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/security-policy.md.review.yaml) (Comment C) |
| **Step 2a** | Line/column fallback — line valid, content plausible | [`contributing.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md.review.yaml) (Comment A) |
| **Step 2b** | Line/column fallback — line valid, content unrelated | [`contributing.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md.review.yaml) (Comment D) |
| **Step 2c** | Line/column fallback — line beyond document length | [`contributing.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md.review.yaml) (Comment C) |
| **Step 3** | Contextual / fuzzy re-anchoring | [`deployment-guide.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/deployment-guide.md.review.yaml) |
| **Step 4** | Orphan — text removed, no match possible | [`contributing.md.review.yaml`](https://github.com/wictorwilen/MRSF/blob/main/examples/contributing.md.review.yaml) (Comments B, C, E) |

## Plugin Demos

Two runnable TypeScript demos show the rendering plugins in action. Both read
`architecture.md` and its sidecar, render annotated HTML, and print it to the console.

```bash
cd examples
npm install        # one-time — installs plugin dependencies
npx tsx demo-markdown-it.ts   # markdown-it plugin demo
npx tsx demo-rehype.ts        # rehype plugin demo
```

## Trying the Examples

If you have the MRSF CLI installed (`npm install -g @mrsf/cli` or via `npx`), you
can validate and inspect these examples:

```bash
# Validate all sidecars
npx @mrsf/cli validate examples/*.review.yaml

# List open comments
npx @mrsf/cli list examples/data-model.md.review.yaml

# Show summary stats
npx @mrsf/cli list --summary examples/security-policy.md.review.yaml

# Dry-run re-anchoring (no writes)
npx @mrsf/cli reanchor --dry-run examples/api-reference.md.review.yaml

# Check anchor health
npx @mrsf/cli status examples/contributing.md.review.yaml
```

## Agent Skill

The [`mrsf-review/`](https://github.com/wictorwilen/MRSF/tree/main/examples/mrsf-review) folder contains a sample [Agent Skill](https://agentskills.io/) that teaches an AI agent to review Markdown documents using the MRSF MCP server. Copy the folder into your project's `.agent/skills/` directory (or wherever your agent discovers skills) to give any skills-compatible agent structured document review capabilities.

---
description: "Frequently asked questions about MRSF / Sidemark — why sidecar files, re-anchoring, Git workflows, AI integration, and more."
---

# Frequently Asked Questions

## Why sidecar files instead of inline comments?

Markdown has no native comment syntax that is universally hidden from rendered output. Some renderers support HTML comments (`<!-- ... -->`), but those are fragile:

- **They pollute the document.** Review metadata (author, timestamp, resolved state, severity) doesn't belong inside the content a reader sees — or inside markup a renderer processes.
- **They break on edit.** Move a paragraph and any inline annotation attached to it must be moved manually. Sidecar files with line anchoring and `selected_text` can be **re-anchored automatically** when the document changes.
- **They can't be structured.** Inline comments are free-form text. Sidecar YAML gives every comment a typed schema — `id`, `author`, `timestamp`, `severity`, `resolved`, `labels`, threads — all machine-readable and validatable against a JSON Schema.
- **They create noisy diffs.** Mixing review chatter with real content changes makes pull-request diffs harder to read. Sidecar files keep review traffic in a separate diff.
- **They conflict with build tooling.** Static-site generators, linters, and formatters may strip, reformat, or choke on embedded HTML comments. A `.review.yaml` file is invisible to every Markdown tool.

In short, sidecar files give you **structured, durable, tooling-friendly annotations** without touching the document at all.

## Why sidecar files instead of PR comments?

Pull-request review comments (GitHub, GitLab, Azure DevOps, etc.) are great for code review — but they fall short for **long-lived document review**:

| Concern | PR Comments | Sidecar Files |
|---|---|---|
| **Lifetime** | Tied to a single PR diff. Once the PR is merged or the file is changed in a new commit, comments become "outdated" and collapse. | Live alongside the document for as long as you keep them. They survive merges, rebases, and branch switches. |
| **Portability** | Locked inside one hosting platform's API. Moving from GitHub to GitLab means losing every comment. | Plain YAML files in the repo. They travel with the code to any host, fork, or mirror. |
| **Offline access** | Require network access and API calls to read or search. | `git clone` and you have every comment locally. |
| **Machine-readability** | Each platform has a different REST/GraphQL API. Bots must implement per-platform integrations. | One schema, one format. The MCP server and CLI work everywhere. |
| **Anchoring durability** | Anchored to a diff hunk, not the living document. Edit the file and the comment floats away. | Anchored to lines + `selected_text`. The CLI can **re-anchor** comments after edits using exact match, fuzzy matching, and git-diff analysis. |
| **Structured metadata** | Free-form text with platform-specific reactions. | Typed fields: `severity`, `category`, `labels`, `resolved`, threaded replies — all schema-validated. |
| **Version control** | Stored in a platform database, not in Git history. You can't `git log` or `git blame` a PR comment. | Committed to the repo. Full Git history, blame, and diff support. |

Sidecar files and PR comments are **complementary** — you can use both. But when you need review feedback that is **portable, durable, and machine-actionable**, sidecar files are the better home.

## What happens when I edit the document — do comments break?

No. MRSF is designed to survive document edits. Every comment can carry a `selected_text` field that captures the exact text the reviewer highlighted. When you edit the document, the CLI and MCP server can **re-anchor** comments automatically using a multi-step procedure:

1. **Exact text match** — search the updated document for the original `selected_text`. If found, update line/column numbers.
2. **Fuzzy match** — if the text was lightly edited, fuzzy matching finds the closest candidate and scores it by similarity.
3. **Git diff analysis** — when a `commit` hash is present, the tool can use `git diff` to trace how lines moved and map old positions to new ones.
4. **Orphan flagging** — if none of the above succeed, the comment is flagged as orphaned and surfaced for human attention rather than silently deleted.

Run re-anchoring with the CLI:

```bash
mrsf reanchor docs/architecture.md
```

The VS Code extension and MCP server can also trigger re-anchoring automatically or on demand.

## Can I use MRSF with non-Markdown files?

The specification is written for Markdown documents, and all tooling (CLI, VS Code extension, MCP server) is built around Markdown workflows. However, the sidecar format itself — YAML with line/column anchors and `selected_text` — is generic enough to annotate any plain-text file.

If you want to experiment with other file types you can create a `.review.yaml` sidecar manually, but be aware that rendering integrations (the markdown-it plugin, VS Code decorations) assume Markdown content. Future spec revisions may formalize support for additional file types.

## Should I commit sidecar files to Git?

**Yes — that's the whole point.** Committing `.review.yaml` files gives you:

- Full version history of every review conversation (`git log`, `git blame`)
- Portable reviews that travel with forks, mirrors, and platform migrations
- Offline access — `git clone` and you have every comment locally
- Clean diffs — review chatter is in separate files from content changes

If your team wants **ephemeral** reviews that don't persist in the repo, you can add a pattern to `.gitignore`:

```gitignore
# Ignore all sidecar review files
*.review.yaml
```

You can also use the `sidecar_root` option in `.mrsf.yaml` to keep sidecars in a dedicated directory, which makes it easy to include or exclude them as a group:

```yaml
# .mrsf.yaml
sidecar_root: .reviews
```

This places all sidecars under `.reviews/` instead of next to the documents.

## How do AI agents interact with MRSF?

MRSF is designed from the ground up for human + AI collaboration. There are three integration points:

1. **MCP Server** — The `@mrsf/mcp` package exposes every operation (discover, read, add comment, re-anchor, validate, resolve) as Model Context Protocol tools. Any MCP-compatible AI agent can use them directly:

   ```json
   {
     "mcpServers": {
       "mrsf": { "command": "npx", "args": ["-y", "@mrsf/mcp"] }
     }
   }
   ```

2. **Agent Skill** — The repo includes a ready-to-use [Agent Skill](https://agentskills.io/) (`examples/mrsf-review/SKILL.md`) that teaches any skills-compatible agent how to conduct a full document review using the MCP server.

3. **Structured Schema** — Every comment field (`severity`, `category`, `labels`, `resolved`, `reply_to`) is typed and schema-validated. Agents don't need to parse free-form text — they read and write structured YAML.

Because the sidecar file is the single source of truth, agents and humans collaborate through the same artifact with no platform lock-in.

## Can multiple reviewers comment on the same document?

Yes. Each comment has an `author` field (e.g., `Jane Doe (janedoe)`) so it's always clear who said what. Multiple reviewers — human or AI — simply add comments to the same sidecar file.

**Threaded replies** are supported via the `reply_to` field, which references the `id` of a parent comment. This keeps conversations organized without duplicating anchor information.

Merge conflicts in YAML sidecars are straightforward to resolve because each comment is an independent list item. In practice, two reviewers adding comments to different parts of a document will produce clean merges. When conflicts do occur, they're simple append-vs-append cases — far easier to resolve than conflicts in the document itself.

## What's the difference between `.review.yaml` and `.review.json`?

The MRSF specification supports both YAML and JSON serialization. They are semantically equivalent — the same fields, the same schema.

| | `.review.yaml` | `.review.json` |
|---|---|---|
| **Human editing** | Easy — clean syntax, supports comments (`#`) | Verbose — quotes, braces, no comments |
| **Tooling** | Recommended default for the CLI and VS Code extension | Works with any JSON tooling or API |
| **Diff readability** | Compact, readable diffs | Noisier diffs due to structural punctuation |

YAML is the **recommended** canonical format. Use JSON when you're integrating with systems that only speak JSON, or when you prefer strict machine-generated output. The CLI and MCP server can read both formats.

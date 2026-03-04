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

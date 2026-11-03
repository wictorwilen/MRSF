---
description: "Use Sidemark for Obsidian, a community plugin by Adam Coddington, to add comments and suggested edits to notes with MRSF sidecar files."
---

# Sidemark for Obsidian

**Google Docs-style comments for your Obsidian notes, without putting review markup in your Markdown.**

[Sidemark for Obsidian](https://github.com/coddingtonbear/obsidian-sidemark) is a community-maintained plugin by [Adam Coddington](https://github.com/coddingtonbear). It stores comments in `.review.yaml` sidecars alongside your notes, bringing the MRSF review workflow into [Obsidian](https://obsidian.md/).

::: info Community integration
This MIT-licensed plugin is maintained in its own repository, independently of the Sidemark / MRSF core tooling. For plugin support, feature requests, and bug reports, use the [plugin's issue tracker](https://github.com/coddingtonbear/obsidian-sidemark/issues).
:::

## What You Can Do

- Select a passage and add a comment, reply in a thread, or resolve and reopen discussions.
- See highlighted passages in the editor and their discussions in a sidebar.
- Suggest replacement text, then accept or decline it. Accepting a suggestion updates the note.
- Keep highlights attached as you edit, and manually re-anchor threads when needed.
- Work with comments written by other MRSF tools; the plugin picks up external note and sidecar changes.

## Install

1. In Obsidian, open **Settings > Community plugins > Browse**.
2. Search for **Sidemark**.
3. Install and enable the plugin.
4. Select text in a note and choose **Add comment** from the right-click menu or command palette.

[Open the Obsidian plugin directory](https://community.obsidian.md/plugins/sidemark)

For manual installation and the full usage guide, see the [plugin README](https://github.com/coddingtonbear/obsidian-sidemark#readme).

::: tip Sync your sidecars
If you use Obsidian Sync, enable syncing of **other file types** so your `.review.yaml` files travel with your notes.
:::

## Shared Comments, Plugin-Specific Workflows

A note named `Plan.md` keeps its review data in `Plan.md.review.yaml`. The Markdown remains readable without the plugin, and the sidecar can also be used with the [VS Code extension](/vscode/), [CLI](/cli/), and [MCP server](/mcp/).

The plugin extends this shared format with `x_`-prefixed fields:

| Extension | Purpose |
|-----------|---------|
| `x_prefix` / `x_suffix` | Context before and after a quote to distinguish repeated passages |
| `x_suggestion` | Replacement text and the accepted or declined result for suggested edits |

These are **plugin-specific extensions**, not standardized MRSF suggestion behavior. Other tools can work with the shared comment fields without offering Obsidian's accept/decline workflow. Do not assume that they interpret these extensions or reproduce the same anchoring behavior.

The plugin also renders comment text as Markdown, while MRSF defines comment text as plain text. Formatting and Obsidian wikilinks may therefore appear differently in other tools.

## Credits and Links

Thank you to Adam Coddington for bringing MRSF sidecars to the Obsidian community. The plugin builds on [Tandem Comments](https://github.com/leonpawelzik/obsidian-tandem-comments) by Leon Pawelzik and its contributors, and uses the `@mrsf/cli` library.

- [Install from the Obsidian directory](https://community.obsidian.md/plugins/sidemark)
- [Source code and documentation](https://github.com/coddingtonbear/obsidian-sidemark)
- [Releases](https://github.com/coddingtonbear/obsidian-sidemark/releases)
- [Report a plugin issue](https://github.com/coddingtonbear/obsidian-sidemark/issues)
- [MRSF specification](/specification)

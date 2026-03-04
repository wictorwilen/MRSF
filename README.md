<p align="center">
  <img src="media/mrsf-logo.png" alt="Sidemark / MRSF logo" width="200" />
</p>

# Markdown Review Sidecar Format (MRSF) — Draft

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![MRSF v1.0 Draft](https://img.shields.io/badge/MRSF-v1.0%20Draft-blue)](MRSF-v1.0.md)
[![@mrsf/cli on npm](https://img.shields.io/npm/v/@mrsf/cli?label=%40mrsf%2Fcli)](https://www.npmjs.com/package/@mrsf/cli)
[![@mrsf/mcp on npm](https://img.shields.io/npm/v/@mrsf/mcp?label=%40mrsf%2Fmcp)](https://www.npmjs.com/package/@mrsf/mcp)
[![npm downloads (cli)](https://img.shields.io/npm/dm/@mrsf/cli?label=cli%20downloads)](https://www.npmjs.com/package/@mrsf/cli)
[![npm downloads (mcp)](https://img.shields.io/npm/dm/@mrsf/mcp?label=mcp%20downloads)](https://www.npmjs.com/package/@mrsf/mcp)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/wictor.mrsf-vscode?label=VS%20Code)](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode)
[![VS Code Installs](https://img.shields.io/visual-studio-marketplace/i/wictor.mrsf-vscode?label=VS%20Code%20installs)](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode)[![@mrsf/markdown-it-mrsf on npm](https://img.shields.io/npm/v/@mrsf/markdown-it-mrsf?label=%40mrsf%2Fmarkdown-it-mrsf)](https://www.npmjs.com/package/@mrsf/markdown-it-mrsf)
[![@mrsf/rehype-mrsf on npm](https://img.shields.io/npm/v/@mrsf/rehype-mrsf?label=%40mrsf%2Frehype-mrsf)](https://www.npmjs.com/package/@mrsf/rehype-mrsf)[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=)](https://modelcontextprotocol.io)

**Markdown Review Sidecar Format (MRSF)**, also known as **Sidemark**, is a portable, version-controlled, and machine-actionable way to store review comments *outside* Markdown files.

🌐 [sidemark.org](https://sidemark.org) · 💻 [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode)

This makes:
- Markdown docs clean and uncluttered
- Review history persist across edits
- Automated review tools and AI agents/skills able to reason about comments reliably

## 🧠 What Problem This Solves

Markdown workflows today struggle with durable, context-aware review comments:

- Inline comments can’t move with the text  
- GitHub/GitLab reviews vanish with edits  
- Automated agents (LLMs, bots) have no structured API for feedback  

MRSF solves this with **sidecar files** that hold review metadata separate from content and a CLI/MCP interface for tooling.

## 🚀 Features

- Standardized sidecar format for Markdown reviews  
- Anchors with line/span + fallback matching (`selected_text`)  
- Re-anchoring after edits using configurable strategies  
- JSON Schema for validation  
- CLI tools for validation, re-anchoring, status checks  
- MCP server for integrations with LLMs and assistant clients

## 📄 Specification

The full specification is available in [MRSF-v1.0.md](MRSF-v1.0.md).

## 🔧 Quick Start

### Install
```bash
npm install -g @mrsf/cli
```

### Typical workflow
``` bash
# create a sidecar for a Markdown file
mrsf init docs/architecture.md

# add a comment anchored at line 12
mrsf add docs/architecture.md -l 12 "Add more detail about this architecture."

# check for issues
mrsf validate

# after the document changes
mrsf reanchor

# see comment health
mrsf status
```

See the full CLI documentation in [`cli/README.md`](cli/README.md), or run `mrsf --help`.

## 📦 Examples

Minimal sidecar (`.review.yaml`) next to the Markdown):

``` yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
- id: abc123
  author: Jane Doe
  timestamp: '2026-03-02T18:22:59Z'
  text: "Can you clarify this section?"
  resolved: false
  line: 9
```

Advanced example with exact span:

```yaml
- id: def456
  author: Jane Doe
  timestamp: '2026-03-02T18:24:51Z'
  text: "Is this phrasing accurate?"
  type: question
  resolved: false
  line: 12
  end_line: 12
  start_column: 42
  end_column: 73
  selected_text: "While many concepts are represented"
```
More examples: see the [`examples`](/examples/) folder.

## 🛠 MCP Server

You can run MRSF as an MCP (Model Context Protocol) server for LLM/assistant integrations.

Install:
```bash
npm install -g @mrsf/mcp
```

Example (Claude Desktop config):
```json
{
  "mcpServers": {
    "mrsf": {
      "command": "npx",
      "args": ["-y", "@mrsf/mcp"]
    }
  }
}
```

Servers expose resources like:
- `mrsf://sidecar/{path}`
- `mrsf://comment/{path}/{id}`
- `mrsf://anchors/{path}`

See the full MCP server documentation in [`mcp/README.md`](mcp/README.md).

## 💻 VS Code Extension

**[Sidemark for VS Code](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode)** brings MRSF review comments directly into your editor — gutter icons, inline previews, hover cards, a sidebar panel, and automatic reanchoring on save.

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode) or search for **"Sidemark"** in the VS Code Extensions view.

## 🧪 Status

**Draft**: this specification and tooling are open for feedback and improvement.

File issues or pull requests with suggestions.

## ❤️ Contributing

We welcome:
- review of the spec
- implementation feedback on the CLI/MCP
- integration examples with editors and bots

See [`CONTRIBUTING.md`](CONTRIBUTING.md)

## 📄 License
[`MIT`](LICENSE)

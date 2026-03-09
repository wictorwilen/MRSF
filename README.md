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
[![VS Code Installs](https://img.shields.io/visual-studio-marketplace/i/wictor.mrsf-vscode?label=VS%20Code%20installs)](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode)
[![mrsf on PyPI](https://img.shields.io/pypi/v/mrsf?label=mrsf%20on%20PyPI)](https://pypi.org/project/mrsf/)
[![@mrsf/markdown-it-mrsf on npm](https://img.shields.io/npm/v/@mrsf/markdown-it-mrsf?label=%40mrsf%2Fmarkdown-it-mrsf)](https://www.npmjs.com/package/@mrsf/markdown-it-mrsf)
[![@mrsf/rehype-mrsf on npm](https://img.shields.io/npm/v/@mrsf/rehype-mrsf?label=%40mrsf%2Frehype-mrsf)](https://www.npmjs.com/package/@mrsf/rehype-mrsf)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=)](https://modelcontextprotocol.io)

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
- Python CLI & SDK (`pip install mrsf`) — 1:1 port of the Node.js CLI
- Rendering plugins for markdown-it and rehype/unified ecosystems

## 📄 Specification

The full specification is available in [MRSF-v1.0.md](MRSF-v1.0.md).

## 🔧 Quick Start

### Install
```bash
# Node.js
npm install -g @mrsf/cli

# Python
pip install mrsf
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

You can also attach tool-specific extension fields when creating comments. The public SDKs and MCP server accept these as key/value maps, and they are stored on disk as flat `x_*` fields:

```bash
mrsf add docs/architecture.md \
  --author "review-bot" \
  --text "Needs a second pass" \
  --line 12 \
  --ext x_source=review-bot \
  --ext x_score=0.91 \
  --ext 'x_labels=["needs-review","docs"]'
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

## 🧪 Monorepo Tests

All TypeScript/Vitest packages can now be run from the repository root:

```bash
npm install
npm test
```

For watch mode or coverage from the root:

```bash
npm run test:watch
npm run test:coverage
```

The root Vitest project aggregates:

- `cli/`
- `mcp/`
- `plugins/shared/`
- `plugins/markdown-it/`
- `plugins/monaco/`
- `plugins/rehype/`
- `vscode/`

## 🐍 Python CLI & SDK

A full Python port of the CLI and library, installable via pip:

```bash
pip install mrsf
```

Same 9 commands, same library API, same 134 tests:

```python
import mrsf

doc = mrsf.parse_sidecar("README.md.review.yaml")
for comment in doc.comments:
    print(f"{comment.author}: {comment.text}")

result = mrsf.validate(doc)
```

Python uses the same explicit extension-map contract when adding comments:

```python
opts = mrsf.AddCommentOptions(
  author="review-bot",
  text="Needs a second pass",
  line=12,
  extensions={
    "x_source": "review-bot",
    "x_score": 0.91,
    "x_labels": ["needs-review", "docs"],
  },
)
```

See [`python/README.md`](python/README.md) for the full SDK reference.

## 🎨 Rendering Plugins

Render MRSF review comments directly in Markdown output as badges, highlights, and tooltips.

### markdown-it Plugin

For VitePress, markdown-it, and any markdown-it-based renderer:

```bash
npm install @mrsf/markdown-it-mrsf
```

```js
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "@mrsf/markdown-it-mrsf";

const md = new MarkdownIt();
md.use(mrsfPlugin, { sidecarPath: "doc.md.review.yaml" });
```

See [`plugins/markdown-it/README.md`](plugins/markdown-it/README.md).

### rehype Plugin

For Astro, Next.js MDX, Docusaurus, and the unified ecosystem:

```bash
npm install @mrsf/rehype-mrsf
```

```js
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { rehypeMrsf } from "@mrsf/rehype-mrsf";
import rehypeStringify from "rehype-stringify";

const file = await unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeMrsf, { sidecarPath: "doc.md.review.yaml" })
  .use(rehypeStringify)
  .process(markdown);
```

See [`plugins/rehype/README.md`](plugins/rehype/README.md).

## 🧪 Status

**Draft**: this specification and tooling are open for feedback and improvement.

File issues or pull requests with suggestions.

## ❤️ Contributing

We welcome:
- review of the spec
- implementation feedback on the CLI/MCP/Python SDK
- integration examples with editors, renderers, and bots

| Package | Path | Install |
|---------|------|---------|
| CLI & library | [`cli/`](cli/) | `npm install @mrsf/cli` |
| MCP server | [`mcp/`](mcp/) | `npm install @mrsf/mcp` |
| VS Code extension | [`vscode/`](vscode/) | [Marketplace](https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode) |
| Python CLI & SDK | [`python/`](python/) | `pip install mrsf` |
| markdown-it plugin | [`plugins/markdown-it/`](plugins/markdown-it/) | `npm install @mrsf/markdown-it-mrsf` |
| rehype plugin | [`plugins/rehype/`](plugins/rehype/) | `npm install @mrsf/rehype-mrsf` |
| Documentation | [`docs/`](docs/) | [sidemark.org](https://sidemark.org) |

See [`CONTRIBUTING.md`](CONTRIBUTING.md)

> **Disclaimer**
> MRSF is a personal open‑source project.
> It is **not affiliated with, endorsed by, or an official standard of Microsoft**.
> Any internal experimentation does not imply product adoption.

## 📄 License
[`MIT`](LICENSE)

---
description: "Render Sidemark/MRSF review comments in HTML using the @mrsf/markdown-it-mrsf plugin — badges, line highlights, inline highlights, and tooltips."
---

# markdown-it Plugin

The `@mrsf/markdown-it-mrsf` package is a standalone [markdown-it](https://github.com/markdown-it/markdown-it) plugin that renders Sidemark review comments directly into HTML output — badges, line highlights, inline text highlights, and tooltips.

## Install

```bash
npm install @mrsf/markdown-it-mrsf
```

## Live Demo

The panel below renders a sample Markdown document with MRSF review comments injected by the plugin. **Hover over badges** to see comment tooltips.

<script setup>
import MrsfDemo from '../.vitepress/components/MrsfDemo.vue'
</script>

<MrsfDemo />

## Usage

```ts
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "@mrsf/markdown-it-mrsf";

const md = new MarkdownIt();
md.use(mrsfPlugin, {
  comments: sidecarData,       // inline MrsfDocument object
  // or: documentPath: "doc.md" // auto-discover .review.yaml
  // or: sidecarPath: "doc.md.review.yaml"
  // or: loader: () => loadFromDb()
});

const html = md.render(markdownSource);
```

Don't forget to include the stylesheet:

```ts
import "@mrsf/markdown-it-mrsf/style.css";
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `comments` | `MrsfDocument` | — | Pre-loaded sidecar data (highest priority) |
| `loader` | `() => MrsfDocument \| null` | — | Custom loader function |
| `documentPath` | `string` | — | Path to Markdown file for auto-discovery |
| `sidecarPath` | `string` | — | Explicit path to sidecar file |
| `showResolved` | `boolean` | `true` | Whether to show resolved comments |
| `interactive` | `boolean` | `false` | Add action buttons for host JS integration |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color scheme hint |
| `cwd` | `string` | `process.cwd()` | Working directory for file resolution |

See the full documentation in the [package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/markdown-it#readme).

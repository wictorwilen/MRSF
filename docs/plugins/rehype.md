---
description: "Render Sidemark/MRSF review comments with the @mrsf/rehype-mrsf plugin for Astro, Next.js MDX, Docusaurus, and the unified ecosystem."
---

# rehype Plugin

The `@mrsf/rehype-mrsf` package is a [rehype](https://github.com/rehypejs/rehype) plugin that renders Sidemark review comments directly into your HTML output. It works with the entire [unified](https://unifiedjs.com/) ecosystem — **Astro**, **Next.js MDX**, **Docusaurus**, and any other tool that uses remark/rehype.

## Install

```bash
npm install @mrsf/rehype-mrsf
```

## Live Demo

The panel below renders a sample document with the rehype plugin. Hover the gutter badges or inline highlights to see tooltips, toggle options, and try the interactive actions.

<script setup>
import MrsfRehypeDemo from '../.vitepress/components/MrsfRehypeDemo.vue'
</script>

<MrsfRehypeDemo />

## Quick Start

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { rehypeMrsf } from "@mrsf/rehype-mrsf";

const html = await unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeMrsf, { documentPath: "docs/guide.md" })
  .use(rehypeStringify, { allowDangerousHtml: true })
  .process(markdownSource);
```

Include the stylesheet:

```ts
import "@mrsf/rehype-mrsf/style.css";
```

::: tip
Pass `{ allowDangerousHtml: true }` to `rehype-stringify` so the raw HTML tooltips render correctly.
:::

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `comments` | `MrsfDocument` | — | Pre-loaded sidecar data (highest priority) |
| `loader` | `() => MrsfDocument \| null` | — | Custom loader function |
| `sidecarPath` | `string` | — | Explicit path to `.review.yaml` / `.review.json` |
| `documentPath` | `string` | — | Auto-discover sidecar next to this markdown file |
| `showResolved` | `boolean` | `true` | Show resolved comments |
| `interactive` | `boolean` | `false` | Show action buttons (resolve, reply, edit) |
| `gutterPosition` | `'left' \| 'right'` | `'right'` | Badge placement |
| `gutterForInline` | `boolean` | `true` | Show badge for inline-highlighted comments |
| `inlineHighlights` | `boolean` | `true` | Highlight `selected_text` with `<mark>` |
| `lineHighlight` | `boolean` | `false` | Add background tint on commented lines |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color scheme hint |
| `cwd` | `string` | `process.cwd()` | Working directory for file discovery |

## Data Provisioning

The plugin supports four ways to load sidecar data, in priority order:

1. `comments`
2. `loader`
3. `sidecarPath`
4. `documentPath`

## Framework Integration

### Astro

```ts
import { rehypeMrsf } from "@mrsf/rehype-mrsf";

export default defineConfig({
  markdown: {
    rehypePlugins: [
      [rehypeMrsf, { documentPath: "src/content/guide.md" }],
    ],
  },
});
```

### Next.js MDX

```ts
import createMDX from "@next/mdx";
import { rehypeMrsf } from "@mrsf/rehype-mrsf";

const withMDX = createMDX({
  options: {
    rehypePlugins: [
      [rehypeMrsf, { documentPath: "docs/guide.md" }],
    ],
  },
});
```
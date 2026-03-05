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
| `gutterPosition` | `'left' \| 'tight' \| 'right'` | `'right'` | Badge placement |
| `gutterForInline` | `boolean` | `true` | Show badge for inline-highlighted comments |
| `inlineHighlights` | `boolean` | `true` | Highlight `selected_text` with `<mark>` |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color scheme hint |
| `cwd` | `string` | `process.cwd()` | Working directory for file discovery |

## Data Provisioning

The plugin supports four ways to load sidecar data, in priority order:

1. **`comments`** — pre-loaded sidecar data (works everywhere, including browsers)
2. **`loader`** — custom function (works everywhere)
3. **`sidecarPath`** — explicit file path (Node.js only)
4. **`documentPath`** — auto-discover `.review.yaml`/`.json` (Node.js only)

## Gutter Modes

```ts
// Left gutter — badge in a margin column
.use(rehypeMrsf, { comments, gutterPosition: "left" })

// Tight — badge inline before text
.use(rehypeMrsf, { comments, gutterPosition: "tight" })

// Right — badge floated right (default)
.use(rehypeMrsf, { comments, gutterPosition: "right" })
```

## Framework Integration

### Astro

```ts
// astro.config.mjs
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
// next.config.mjs
import createMDX from "@next/mdx";
import { rehypeMrsf } from "@mrsf/rehype-mrsf";

const withMDX = createMDX({
  options: {
    rehypePlugins: [
      [rehypeMrsf, { documentPath: "docs/guide.md" }],
    ],
  },
});

export default withMDX(nextConfig);
```

## Interactive Mode

```ts
.use(rehypeMrsf, { comments, interactive: true })
```

Hook into events with the controller (adds inline + gutter action buttons and built-in modals for add/reply/edit/resolve/unresolve/delete):

```ts
import "@mrsf/rehype-mrsf/controller";

document.addEventListener("mrsf:submit", async (e) => {
  // Persist to your API; payload is snake_case and matches the CLI types
  // { action, commentId, text?, line?, end_line?, start_column?, end_column?, selection_text? }
  await saveComment(e.detail);
});
```

Events fired after user confirmation: `mrsf:add`, `mrsf:reply`, `mrsf:edit`, `mrsf:resolve`, `mrsf:unresolve`, `mrsf:delete`, `mrsf:navigate`, plus `mrsf:submit` (always includes the full payload). Set `window.mrsfDisableBuiltinUi = true` before loading the controller to opt out of the built-in dialogs and render your own.

## CSS Customization

Override CSS custom properties to match your theme:

```css
:root {
  --mrsf-badge-bg: #0969da;
  --mrsf-tooltip-bg: #1c1c1c;
  --mrsf-highlight-bg: rgba(255, 213, 79, 0.3);
  --mrsf-gutter-width: 50px;
}
```

## Browser Usage

In browser environments, bundlers automatically resolve to a file-system-free entry point via the `"browser"` export condition:

```ts
import { rehypeMrsf } from "@mrsf/rehype-mrsf"; // auto-resolves
```

Only `comments` and `loader` options work in the browser.

## Comparison with markdown-it Plugin

Both `@mrsf/rehype-mrsf` and `@mrsf/markdown-it-mrsf` produce identical visual output — same CSS classes, same data attributes, same tooltips. Choose based on your toolchain:

| | rehype | markdown-it |
|--|--------|-------------|
| Ecosystem | unified (remark/rehype) | markdown-it |
| Used by | Astro, Next.js MDX, Docusaurus | VitePress, many Node.js tools |
| Architecture | hast tree transformation | Token stream injection |
| Package | `@mrsf/rehype-mrsf` | `@mrsf/markdown-it-mrsf` |

# @mrsf/rehype-mrsf

A [rehype](https://github.com/rehypejs/rehype) plugin for rendering [Sidemark / MRSF](https://github.com/wictorwilen/MRSF) review comments directly into HTML output. Part of the [unified](https://unifiedjs.com/) ecosystem.

Works with **Astro**, **Next.js MDX**, **Docusaurus**, and any other tool that uses the unified pipeline.

## Install

```bash
npm install @mrsf/rehype-mrsf
```

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

> **Note:** Pass `{ allowDangerousHtml: true }` to `rehype-stringify` so the raw HTML tooltips are serialized.

Include the stylesheet in your page:

```ts
import "@mrsf/rehype-mrsf/style.css";
```

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

### Data provisioning priority

1. **`comments`** — inline sidecar data (works everywhere)
2. **`loader`** — custom function (works everywhere)
3. **`sidecarPath`** — explicit file path (Node.js only)
4. **`documentPath`** — auto-discover `.review.yaml`/`.json` (Node.js only)

## Gutter Placement

```ts
// Left gutter — badge in a margin column, content indented
.use(rehypeMrsf, { comments, gutterPosition: "left" })

// Right — badge floated right (default)
.use(rehypeMrsf, { comments, gutterPosition: "right" })
```

For inline emphasis, use `inlineHighlights` and `gutterForInline` instead of a separate gutter mode.

## Browser / Bundler Usage

In browser environments (Vite, webpack, esbuild), the `"browser"` export condition in `package.json` automatically resolves to a file-system-free entry point. No special import needed:

```ts
import { rehypeMrsf } from "@mrsf/rehype-mrsf"; // auto-resolves to browser entry
```

Only `comments` and `loader` options work in the browser. `sidecarPath` and `documentPath` require Node.js.

## Astro

```ts
// astro.config.mjs
import { rehypeMrsf } from "@mrsf/rehype-mrsf";
import sidecarData from "./content/guide.md.review.yaml";

export default defineConfig({
  markdown: {
    rehypePlugins: [
      [rehypeMrsf, { comments: sidecarData }],
    ],
  },
});
```

## Next.js MDX

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

Enable action buttons and hook into events (includes gutter “Add comment” buttons and an inline “Add comment” floater that appears when users select text):

```ts
.use(rehypeMrsf, { comments, interactive: true })
```

```ts
import { refreshAll } from "@mrsf/rehype-mrsf/controller";

document.addEventListener("mrsf:submit", async (e) => {
  // { action, commentId, text?, line?, end_line?, start_column?, end_column?, selection_text? }
  await saveComment(e.detail);
});

await mermaid.run();
refreshAll();
```

Events fired after user confirmation: `mrsf:add`, `mrsf:reply`, `mrsf:edit`, `mrsf:resolve`, `mrsf:unresolve`, `mrsf:delete`, `mrsf:navigate`, plus `mrsf:submit` with the full payload.

Set `window.mrsfDisableBuiltinUi = true` before loading the controller if you want to render your own dialogs and only consume the events.

The controller also auto-refreshes gutter positions on DOM mutations inside the rendered container, which covers common async renderers such as Mermaid. Call `refreshAll()` after third-party rendering when you need a deterministic reposition step.

### Shared Gutter Render Hooks

The controller accepts `gutterRenderers` so hosts can override the shared badge and add-button presentation without diverging from the common MRSF UX contract:

```ts
import { MrsfController } from "@mrsf/rehype-mrsf/controller";

new MrsfController(document.querySelector(".markdown-body")!, {
  interactive: true,
  gutterRenderers: {
    badge: ({ defaultPresentation }) => ({
      label: `🗨 ${defaultPresentation.countText}`,
      icon: "🗨",
      countText: defaultPresentation.countText,
    }),
    addButton: () => ({
      label: "New",
    }),
  },
});
```

The same shared renderer contract also drives the Monaco gutter badges, including the default `9+` count cap and default add-button labels.

## CSS Customization

Override CSS custom properties:

```css
:root {
  --mrsf-badge-bg: #0969da;
  --mrsf-tooltip-bg: #1c1c1c;
  --mrsf-highlight-bg: rgba(255, 213, 79, 0.3);
  --mrsf-gutter-width: 50px;
}
```

See the [full list of variables](https://github.com/wictorwilen/MRSF/blob/main/plugins/shared/src/style.css).

## License

MIT

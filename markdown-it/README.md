# @mrsf/markdown-it-mrsf

A [markdown-it](https://github.com/markdown-it/markdown-it) plugin for rendering [MRSF (Sidemark)](https://github.com/wictorwilen/MRSF) review comments directly into HTML output.

Renders badges, line highlights, inline text highlights, and tooltips — no client-side JavaScript required for static use. An optional interactive mode adds action buttons for host applications (like VS Code) to hook into.

## Install

```bash
npm install @mrsf/markdown-it-mrsf
```

## Usage

### Inline data (recommended for testing and custom pipelines)

```ts
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "@mrsf/markdown-it-mrsf";

const md = new MarkdownIt();
md.use(mrsfPlugin, {
  comments: {
    mrsf_version: "1.0",
    document: "guide.md",
    comments: [
      {
        id: "c1",
        author: "Jane",
        timestamp: "2026-01-01T00:00:00Z",
        text: "Can you clarify this section?",
        resolved: false,
        line: 3,
      },
    ],
  },
});

const html = md.render(markdownSource);
```

### Auto-discover from disk

```ts
md.use(mrsfPlugin, {
  documentPath: "docs/guide.md",
});
```

The plugin looks for `docs/guide.md.review.yaml` (or `.review.json`) next to the document.

### Explicit sidecar path

```ts
md.use(mrsfPlugin, {
  sidecarPath: ".reviews/docs/guide.md.review.yaml",
});
```

## Stylesheet

Include the default CSS for badges, tooltips, and highlights:

```ts
import "@mrsf/markdown-it-mrsf/style.css";
```

Or link directly in HTML:

```html
<link rel="stylesheet" href="node_modules/@mrsf/markdown-it-mrsf/dist/style.css">
```

Customise with CSS custom properties:

```css
:root {
  --mrsf-accent: #3794ff;
  --mrsf-badge-bg: #007acc;
  --mrsf-badge-fg: #fff;
  --mrsf-tooltip-bg: #252526;
  --mrsf-tooltip-fg: #cccccc;
  --mrsf-highlight-bg: rgba(255, 213, 79, 0.25);
}
```

## Interactive Mode

Enable `interactive: true` to add action buttons (Resolve, Reply, Edit) inside tooltips. These render as `<button data-mrsf-action="..." data-mrsf-comment-id="...">` elements — inert without JavaScript.

```ts
md.use(mrsfPlugin, {
  comments: sidecarData,
  interactive: true,
});
```

### Controller

Include the optional controller to dispatch custom events when action buttons are clicked:

```ts
import "@mrsf/markdown-it-mrsf/controller";

document.addEventListener("mrsf:resolve", (e) => {
  console.log("Resolve comment:", e.detail.commentId);
});

document.addEventListener("mrsf:reply", (e) => {
  console.log("Reply to:", e.detail.commentId);
});
```

Events dispatched: `mrsf:resolve`, `mrsf:unresolve`, `mrsf:reply`, `mrsf:edit`, `mrsf:navigate`.

Each event's `detail` contains `{ commentId: string, line: number | null, action: string }`.

### VS Code Integration Path

The plugin is designed so the VS Code extension can adopt it as its rendering engine:

1. Use `mrsfPlugin` in `extendMarkdownIt()` with `interactive: true` and inline data from `SidecarStore`
2. Include `controller.js` via `markdown.previewScripts`
3. Add a thin bridge script mapping `mrsf:*` custom events → `vscode.postMessage()` → extension commands

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `comments` | `MrsfDocument` | — | Pre-loaded sidecar data (highest priority) |
| `documentPath` | `string` | — | Path to Markdown file for auto-discovery |
| `sidecarPath` | `string` | — | Explicit path to sidecar file |
| `showResolved` | `boolean` | `true` | Whether to show resolved comments |
| `interactive` | `boolean` | `false` | Add action buttons for host JS integration |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Color scheme hint |
| `cwd` | `string` | `process.cwd()` | Working directory for file resolution |

## DOM Contract

All rendered elements follow a strict data-attribute contract:

- `data-mrsf-line` — source line number (1-based)
- `data-mrsf-comment-id` — comment identifier
- `data-mrsf-action` — action type (`resolve`, `unresolve`, `reply`, `edit`, `navigate`)

## License

[MIT](../LICENSE)

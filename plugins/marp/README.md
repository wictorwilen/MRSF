# @mrsf/marp-mrsf

Render Sidemark/MRSF review comments in Marpit and Marp HTML output.

This package installs into a Marpit-compatible renderer through `use()` and reuses the existing MRSF runtime model: line metadata on rendered content, a single serialized thread payload per deck, and browser-side interaction through the shared `MrsfController`.

This is the first public test release of the Marp integration. The package is ready for evaluation in Marpit and Marp hosts, but the vendor-only page anchoring path should still be treated as early feedback territory.

## Install

```bash
npm install @mrsf/marp-mrsf
```

If you are starting from Marpit directly, install both packages:

```bash
npm install @marp-team/marpit @mrsf/marp-mrsf
```

For Marp Core hosts:

```bash
npm install @marp-team/marp-core @mrsf/marp-mrsf
```

## Browser and Bundler Support

The package exposes a browser-safe entry automatically through the standard `browser` export condition, so the same import works in Node.js, Vite, webpack, and esbuild.

In browser environments, use `comments` or `loader`. File-system-backed options such as `documentPath` and `sidecarPath` require Node.js.

## Usage

### Inline sidecar data

```ts
import { Marpit } from "@marp-team/marpit";
import { mrsfPlugin } from "@mrsf/marp-mrsf";
import "@mrsf/marp-mrsf/style.css";
import { MrsfController } from "@mrsf/marp-mrsf/controller";

const marpit = new Marpit();
marpit.use(mrsfPlugin, {
  comments: sidecarData,
  interactive: true,
});

const { html } = marpit.render(markdownSource);

const container = document.querySelector(".marpit");
if (container) {
  new MrsfController(container, { interactive: true });
}
```

### Load from disk in Node.js

```ts
const marpit = new Marpit();
marpit.use(mrsfPlugin, {
  documentPath: "slides/deck.md",
  interactive: true,
});
```

The plugin will look for `slides/deck.md.review.yaml` or `slides/deck.md.review.json` next to the Markdown document.

### Custom loader

```ts
marpit.use(mrsfPlugin, {
  loader: () => currentSidecarState,
  interactive: true,
});
```

## Marp Core

```ts
import { Marp } from "@marp-team/marp-core";
import { mrsfPlugin } from "@mrsf/marp-mrsf";
import "@mrsf/marp-mrsf/style.css";

const marp = new Marp({ inlineSVG: true });
marp.use(mrsfPlugin, {
  comments: sidecarData,
  interactive: true,
  lineHighlight: true,
});

const { html, css } = marp.render(markdownSource);
```

## Styles and Runtime

Include the default stylesheet to get shared badges, highlights, gutters, and tooltips:

```ts
import "@mrsf/marp-mrsf/style.css";
```

For interactive hosts, mount the shared controller after the rendered HTML is in the DOM:

```ts
import { MrsfController } from "@mrsf/marp-mrsf/controller";

new MrsfController(container, {
  interactive: true,
  inlineHighlights: true,
});
```

When users interact with comments, the controller dispatches the same `mrsf:*` events used by the other rendering plugins. The host remains responsible for persistence.

## Vendor Page Hints

The Marp integration supports vendor-only `x_page` hints on comments. This is useful when a presentation-level note belongs to a whole rendered page rather than a specific source line.

```yaml
comments:
  - id: page-2-note
    author: Review Bot
    timestamp: "2026-03-25T12:10:00Z"
    text: Tighten the slide title and reduce the bullet count.
    resolved: false
    x_page: 2
```

`x_page` is not part of the MRSF standard. It is preserved as vendor metadata and interpreted by the Marp renderer only.

## Notes

1. The host application owns persistence. Listen for `mrsf:*` events and save sidecar changes yourself.
2. The plugin adds `data-mrsf-page` to rendered page containers for runtime navigation.
3. Vendor hints such as `x_page` can be used to attach a comment to a rendered page when line-level anchoring is not the right fit.
4. The plugin does not propose any MRSF spec changes. Page metadata is a renderer concern, not a canonical sidecar field.
5. Inline SVG mode is supported and tags the SVG page containers with `data-mrsf-page`.

## Demo

An interactive demo lives in [`examples/marp-demo`](../../examples/marp-demo). It renders a small deck, keeps the sidecar in local host state, supports add/reply/edit/resolve/delete flows, and includes both line-based and `x_page`-based comments.
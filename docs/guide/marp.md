---
description: "Render Sidemark/MRSF review comments in Marpit and Marp HTML output using the @mrsf/marp-mrsf plugin."
---

# Marp Plugin

The `@mrsf/marp-mrsf` package installs MRSF rendering into a Marpit-compatible renderer through `use()`. It preserves the same browser interaction model as the other MRSF rendering plugins while adding `data-mrsf-page` metadata to rendered page containers.

This is the first public test release of the Marp integration. It is intended for early adopters who want to validate the package shape, runtime behavior, and the vendor-only page hint flow before a more stable release.

## Install

```bash
npm install @mrsf/marp-mrsf
```

If your host does not already depend on Marpit or Marp Core, install one of them alongside the plugin:

```bash
npm install @marp-team/marpit @mrsf/marp-mrsf
```

```bash
npm install @marp-team/marp-core @mrsf/marp-mrsf
```

## Environment Notes

The same import works in Node.js and browser bundlers.

- Use `comments` or `loader` in browser hosts.
- Use `documentPath` or `sidecarPath` only in Node.js hosts.

## Usage

```ts
import { Marpit } from "@marp-team/marpit";
import { mrsfPlugin } from "@mrsf/marp-mrsf";
import "@mrsf/marp-mrsf/style.css";

const marpit = new Marpit();
marpit.use(mrsfPlugin, {
  comments: sidecarData,
  interactive: true,
});

const { html } = marpit.render(markdownSource);
```

### Load from disk

```ts
const marpit = new Marpit();
marpit.use(mrsfPlugin, {
  documentPath: "slides/deck.md",
  interactive: true,
});
```

### Custom loader

```ts
marpit.use(mrsfPlugin, {
  loader: () => currentSidecarState,
  interactive: true,
});
```

## Marp Core Usage

The same plugin also works with Marp Core because `Marp` extends `Marpit` and exposes the same `use()` integration path:

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

## Runtime

Use the shared controller in the browser after the rendered HTML is mounted:

```ts
import { MrsfController } from "@mrsf/marp-mrsf/controller";

const container = document.querySelector(".marpit");
if (container) {
  new MrsfController(container, { interactive: true });
}
```

## Vendor Page Hints

Marp decks sometimes need comments that apply to an entire rendered page instead of a specific line anchor. For that case, the plugin understands vendor-only `x_page` hints:

```yaml
comments:
  - id: slide-2-summary
    author: Product Review
    timestamp: "2026-03-25T12:10:00Z"
    text: Make this slide shorter and more presenter-friendly.
    resolved: false
    x_page: 2
```

At render time, `x_page` is mapped onto the corresponding Marpit slide container. The value is preserved in the serialized payload so interactive hosts can keep page-level navigation and reply flows consistent.

## Notes

1. The host application owns persistence and should listen for `mrsf:*` events.
2. `data-mrsf-page` is renderer metadata, not a standards change.
3. Canonical MRSF anchors remain document-global line numbers.
4. Vendor page hints such as `x_page` can be used to attach a comment to a rendered Marp page without proposing any MRSF schema change.
5. Inline SVG mode is supported and tags the SVG page containers with `data-mrsf-page`.

## Demo

A runnable browser demo is available in [examples/marp-demo](../../examples/marp-demo).

The demo is intentionally interactive: it keeps the sidecar in host memory, rerenders after comment actions, and includes both line-anchored comments and an `x_page` comment so you can validate the full presentation workflow before publishing your own host.
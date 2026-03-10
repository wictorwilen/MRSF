# @mrsf/marked-mrsf

A [Marked](https://github.com/markedjs/marked) plugin for rendering [MRSF (Sidemark)](https://github.com/wictorwilen/MRSF) review comments into HTML output.

Like the other MRSF rendering plugins, it annotates rendered block elements with `data-mrsf-*` line metadata and appends a serialized comment payload for the shared client-side controller.

## Install

```bash
npm install marked @mrsf/marked-mrsf
```

## Usage

```ts
import { Marked } from "marked";
import { markedMrsf } from "@mrsf/marked-mrsf";

const parser = new Marked();
parser.use(markedMrsf({
  documentPath: "docs/guide.md",
}));

const html = parser.parse(markdownSource);
```

For browser usage, pass `comments` or `loader` instead of `documentPath` / `sidecarPath`.

## Stylesheet and Controller

```ts
import "@mrsf/marked-mrsf/style.css";
import { refreshAll } from "@mrsf/marked-mrsf/controller";
```

The shared controller wires up gutter buttons, selection actions, and built-in dialogs, then dispatches `mrsf:*` events for your host app to persist.

## Options

The plugin accepts the same `MrsfPluginOptions` surface as the markdown-it and rehype packages: `comments`, `loader`, `documentPath`, `sidecarPath`, `showResolved`, `dataContainer`, `dataElementId`, `interactive`, `gutterPosition`, `gutterForInline`, `inlineHighlights`, `lineHighlight`, `theme`, and `cwd`.

## License

[MIT](../LICENSE)
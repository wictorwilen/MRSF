---
description: "Milkdown and Crepe integration for Sidemark/MRSF, with a shared review runtime, host adapter, and browser demo."
---

# Milkdown + Crepe Plugin

The `@mrsf/milkdown-mrsf` package brings Sidemark into [Milkdown](https://milkdown.dev/) editors and the higher-level [Crepe](https://milkdown.dev/docs/guide/crepe) shell.

It is built for browser hosts that want editor-native review comments while keeping sidecar persistence and host workflows under application control.

## Current Scope

- direct Milkdown integration through `createMilkdownMrsfPlugin`
- Crepe integration through `createCrepeMrsfFeature` and `createCrepeMrsfToolbarConfig`
- shared browser host adapter contract for sidecar I/O
- inline highlights, gutter overlays, and thread tooltips
- built-in MRSF dialogs for add, reply, edit, and delete actions
- add, reply, edit, resolve, delete, save, reload, and reanchor flows

## Install

Direct Milkdown:

```bash
npm install @mrsf/milkdown-mrsf @milkdown/core @milkdown/ctx @milkdown/kit @milkdown/plugin-listener @milkdown/prose
```

For Crepe as well:

```bash
npm install @mrsf/milkdown-mrsf @milkdown/core @milkdown/crepe @milkdown/ctx @milkdown/kit @milkdown/plugin-listener @milkdown/prose
```

## Direct Milkdown Quick Start

```ts
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { createMilkdownMrsfPlugin } from "@mrsf/milkdown-mrsf";
import "@mrsf/milkdown-mrsf/style.css";
```

## Crepe Quick Start

```ts
import { Crepe } from "@milkdown/crepe";
import { createCrepeMrsfFeature, createCrepeMrsfToolbarConfig } from "@mrsf/milkdown-mrsf";
import "@mrsf/milkdown-mrsf/style.css";
```

## Demo

```bash
cd examples
npm install
npm run demo:milkdown
```

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/milkdown#readme)
- [Examples overview](/guide/examples)
- [Monaco plugin](/plugins/monaco)
- [Tiptap plugin](/plugins/tiptap)
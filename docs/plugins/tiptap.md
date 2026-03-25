---
description: "Experimental Tiptap integration for Sidemark/MRSF. Help needed to harden and complete the package."
---

# Tiptap Plugin (Experimental)

The `@mrsf/tiptap-mrsf` package brings Sidemark into [Tiptap](https://tiptap.dev/) editors. It is built for interactive browser hosts that want review comments inside a rich-text editor while still keeping sidecar persistence under host control.

> Status: Experimental. Help needed to harden anchor behavior, gutter parity, and overall editor integration quality.

## Install

```bash
npm install @mrsf/tiptap-mrsf @tiptap/core @tiptap/starter-kit
```

## Quick Start

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createTiptapMrsfExtension } from "@mrsf/tiptap-mrsf";
```

Include the stylesheet:

```ts
import "@mrsf/tiptap-mrsf/style.css";
```

## Demo

```bash
cd examples
npm install
npm run demo:tiptap
```

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/tiptap#readme)
- [Examples overview](/guide/examples)
- [Monaco Plugin](/plugins/monaco)
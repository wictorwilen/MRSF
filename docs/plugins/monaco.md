---
description: "Embed Sidemark/MRSF review comments into Monaco-based editors with the @mrsf/monaco-mrsf plugin."
---

# Monaco Plugin

The `@mrsf/monaco-mrsf` package brings Sidemark into [Monaco Editor](https://microsoft.github.io/monaco-editor/) hosts. It is designed for browser and desktop applications that want editor-native MRSF comments without depending on VS Code itself.

Current scope includes:

- gutter and inline comment decorations
- hover summaries for existing threads
- host-driven add, reply, resolve, and reanchor actions
- line tracking while the document is edited in memory
- sidecar loading, saving, and reanchoring through a host adapter

## Install

```bash
npm install @mrsf/monaco-mrsf monaco-editor
```

## Quick Start

```ts
import * as monaco from "monaco-editor";
import { MemoryHostAdapter, MonacoMrsfPlugin } from "@mrsf/monaco-mrsf";

const resourceId = "file:///docs/guide.md";

const editor = monaco.editor.create(container, {
  value: "# Guide\n\nHello world\n",
  language: "markdown",
  glyphMargin: true,
});

const plugin = new MonacoMrsfPlugin(editor, host, {
  monacoApi: monaco,
  watchHostChanges: true,
});

await plugin.loadCurrent();
```

## Demo

```bash
cd examples
npm install
npm run demo:monaco
```

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/monaco#readme)
- [Examples overview](/guide/examples)
- [VS Code extension](/vscode/)
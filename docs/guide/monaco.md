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

const model = editor.getModel();
if (model) {
  monaco.editor.setModelLanguage(model, "markdown");
}

const host = new MemoryHostAdapter({
  resources: {
    [resourceId]: {
      documentText: "# Guide\n\nHello world\n",
      documentPath: "/docs/guide.md",
      sidecarPath: "/docs/guide.md.review.yaml",
      sidecar: {
        mrsf_version: "1.0",
        document: "/docs/guide.md",
        comments: [],
      },
    },
  },
});

const plugin = new MonacoMrsfPlugin(editor, host, {
  monacoApi: monaco,
  watchHostChanges: true,
  actionHandlers: {
    createCommentDraft(context) {
      return {
        text: `Comment on line ${context.line}`,
        author: "Demo User",
      };
    },
    createReplyDraft() {
      return {
        text: "Reply from demo",
        author: "Demo User",
      };
    },
  },
});

await plugin.loadCurrent();
```

For a real application, replace `MemoryHostAdapter` with a host adapter that reads and writes sidecars through your backend, workspace API, or local persistence layer.

## Host Integration Model

The Monaco plugin is intentionally host-driven. Your application provides the I/O and user interaction model, while the plugin handles projection, anchoring, and editor decorations.

In practice that means:

- your host decides how documents and sidecars are loaded and saved
- your host can wire comment creation to custom dialogs, forms, or side panels
- the plugin keeps decorations in sync with live edits and reanchoring results

This makes it a good fit for browser-based documentation tools, custom editorial systems, and internal review portals built on Monaco.

## Demo

The repository includes a runnable Monaco browser demo in the examples package:

```bash
cd examples
npm install
npm run demo:monaco
```

Open the local Vite URL and navigate to `/` to try the interactive editor demo.

## When to Use It

Choose `@mrsf/monaco-mrsf` when you are building your own editor surface and want MRSF support inside Monaco. If you need a ready-made editor experience, use the VS Code extension instead. If you only need rendered HTML output, use one of the rendering plugins.

| Need | Best fit |
|------|----------|
| Full editor integration in a custom Monaco app | `@mrsf/monaco-mrsf` |
| Turnkey desktop editor experience | VS Code extension |
| Static or rendered HTML output in markdown-it | `@mrsf/markdown-it-mrsf` |
| Static or rendered HTML output in unified/rehype | `@mrsf/rehype-mrsf` |

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/monaco#readme)
- [Examples overview](/guide/examples)
- [VS Code extension](/vscode/)
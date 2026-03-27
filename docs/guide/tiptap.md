---
description: "Experimental Tiptap integration for Sidemark/MRSF. Help needed to harden and complete the package."
---

# Tiptap Plugin (Experimental)

The `@mrsf/tiptap-mrsf` package brings Sidemark into [Tiptap](https://tiptap.dev/) editors. It is built for interactive browser hosts that want review comments inside a rich-text editor while still keeping sidecar persistence under host control.

> Status: Experimental. Help needed to harden anchor behavior, gutter parity, and overall editor integration quality.

Current scope includes:

- inline comment highlights inside the editor surface
- configurable left/right gutter markers for line-attached threads
- optional block-level line highlighting for commented content
- live in-memory line tracking while the document is edited
- explicit-save sidecar persistence through a host adapter
- controller APIs and Tiptap commands for add, reply, edit, resolve, delete, reload, save, and reanchor
- a default thread popover helper for clicked highlights

## Install

```bash
npm install @mrsf/tiptap-mrsf @tiptap/core @tiptap/starter-kit
```

## Quick Start

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createTiptapMrsfExtension } from "@mrsf/tiptap-mrsf";

const host = {
  async getDocumentText() {
    return "Hello world";
  },
  async getDocumentPath() {
    return "/docs/guide.html";
  },
  async discoverSidecar() {
    return "/docs/guide.html.review.yaml";
  },
  async readSidecar() {
    return {
      mrsf_version: "1.0",
      document: "/docs/guide.html",
      comments: [],
    };
  },
  async writeSidecar(_path, document) {
    await saveToBackend(document);
  },
};

const editor = new Editor({
  element: document.querySelector("#editor"),
  extensions: [
    StarterKit,
    createTiptapMrsfExtension(host, {
      resourceId: "guide-doc",
      gutterPosition: "left",
      gutterForInline: false,
      lineHighlight: true,
    }),
  ],
  content: "<p>Hello world</p>",
});
```

Include the stylesheet:

```ts
import "@mrsf/tiptap-mrsf/style.css";
```

## Host Integration Model

The Tiptap plugin is browser-first and host-driven:

- your host decides where document text and sidecars are loaded from
- your host decides when sidecars are persisted
- the plugin keeps the review state and inline decorations aligned while editing
- the controller and exported helpers let your host attach UI without rebuilding anchoring logic

This makes it a good fit for editorial tools, collaborative content apps, internal knowledge systems, and browser-based review workflows built on ProseMirror/Tiptap.

## Performance Tuning

Use the `liveTracking` option to control how aggressively the plugin recomputes review state while the user types:

- `"debounced"` batches editor text changes and applies them after a short pause. This is the default.
- `"save-only"` defers live tracking until `editor.commands.mrsfSave()` or controller save is called.
- `"eager"` applies every editor text change immediately.

If you need to minimize typing overhead in larger documents, prefer `liveTracking: "debounced"` or `liveTracking: "save-only"`.

## Visual Configuration

The Tiptap package uses the same core display vocabulary as the other MRSF plugins:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showResolved` | `boolean` | `true` | Include resolved comments in review state and visuals |
| `interactive` | `boolean` | `Boolean(onCommentClick)` | Enables package-owned interactive defaults |
| `gutterPosition` | `'left' \| 'right'` | `'right'` | Where gutter markers render |
| `gutterForInline` | `boolean` | `true` | Whether inline comments also get gutter markers |
| `inlineHighlights` | `boolean` | `true` | Decorate inline `selected_text` ranges |
| `lineHighlight` | `boolean` | `false` | Adds block-level highlight styling for commented content |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Theme hint for package-owned UI such as popovers and gutter markers |

These options are intentionally named to match the rendering plugins where the semantics overlap, so host applications can keep a consistent mental model across static and interactive integrations.

## Demo

The repository includes a runnable Tiptap browser demo in the examples package:

```bash
cd examples
npm install
npm run demo:tiptap
```

Open the local Vite URL and navigate to `/` to try the interactive editor demo.
The demo shows explicit-save sidecar persistence, external host reloads, inline highlights, left gutter markers for line-only comments, block-level line highlighting, and the default thread popover wired through the Tiptap controller.

## Default Popover Bridge

Use the default click handler bridge when you want a working thread UI without building a full side panel first:

```ts
import { createTiptapMrsfThreadPopoverHandler } from "@mrsf/tiptap-mrsf";

let tiptapEditor: Editor | null = null;

const onCommentClick = (event: TiptapMrsfCommentClickEvent) => {
  if (!tiptapEditor) {
    return;
  }

  return createTiptapMrsfThreadPopoverHandler(tiptapEditor)(event);
};
```

The bridge opens a popover near the clicked highlight and wires resolve, unresolve, reply, edit, and delete actions back into the controller.

## Commands

The extension adds Tiptap commands for MRSF operations:

- `editor.commands.mrsfAddComment(text, draft?)`
- `editor.commands.mrsfReply(commentId, text, draft?)`
- `editor.commands.mrsfEdit(commentId, text, draft?)`
- `editor.commands.mrsfResolve(commentId)`
- `editor.commands.mrsfUnresolve(commentId)`
- `editor.commands.mrsfToggleResolved(commentId)`
- `editor.commands.mrsfDeleteComment(commentId)`
- `editor.commands.mrsfReload()`
- `editor.commands.mrsfSave(reason?)`
- `editor.commands.mrsfReanchor(options?)`

## When to Use It

Choose `@mrsf/tiptap-mrsf` when you need an editor-native MRSF experience inside a Tiptap host and are comfortable adopting an experimental package. If you only need rendered HTML output, use the rendering plugins. If you want a full ready-made desktop editor experience, use the VS Code extension.

| Need | Best fit |
|------|----------|
| Rich-text editor integration in a Tiptap host (experimental) | `@mrsf/tiptap-mrsf` |
| Monaco-based editor surface | `@mrsf/monaco-mrsf` |
| Turnkey desktop editor experience | VS Code extension |
| Static or rendered HTML output | Marked, markdown-it, or rehype plugins |

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/tiptap#readme)
- [Examples overview](/guide/examples)
- [Monaco Plugin](/guide/monaco)
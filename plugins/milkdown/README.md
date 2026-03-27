# @mrsf/milkdown-mrsf

Milkdown and Crepe integration for MRSF (Markdown Review Sidecar Format).

The package supports both direct Milkdown editors and Crepe shells on top of the same review controller, sidecar workflow, overlay UI, and browser host adapter model.

## What It Covers

- direct Milkdown integration through `createMilkdownMrsfPlugin`
- Crepe integration through `createCrepeMrsfFeature` and `createCrepeMrsfToolbarConfig`
- browser-first host adapter contract for document and sidecar I/O
- shared review controller for load, refresh, add, reply, edit, resolve, delete, save, reload, and reanchor flows
- live line tracking while the editor text changes in memory
- inline anchored comment highlights
- gutter overlays and thread tooltips
- built-in MRSF dialogs for add, reply, edit, and delete flows
- selection helpers for add-comment flows in both direct Milkdown and Crepe
- package-local tests and coverage thresholds for the shared runtime

## Install

Direct Milkdown:

```bash
npm install @mrsf/milkdown-mrsf @milkdown/core @milkdown/ctx @milkdown/kit @milkdown/plugin-listener @milkdown/prose
```

If you also want the higher-level Crepe shell:

```bash
npm install @mrsf/milkdown-mrsf @milkdown/core @milkdown/crepe @milkdown/ctx @milkdown/kit @milkdown/plugin-listener @milkdown/prose
```

## Direct Milkdown Quick Start

```ts
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { createMilkdownMrsfPlugin } from "@mrsf/milkdown-mrsf";
import "@mrsf/milkdown-mrsf/style.css";

const host = {
	async getDocumentText() {
		return "# Guide\n\nHello world\n";
	},
	async getDocumentPath() {
		return "/docs/guide.md";
	},
	async discoverSidecar() {
		return "/docs/guide.md.review.yaml";
	},
	async readSidecar() {
		return {
			mrsf_version: "1.0",
			document: "/docs/guide.md",
			comments: [],
		};
	},
	async writeSidecar(_path, document) {
		await saveToBackend(document);
	},
};

const editor = Editor.make()
	.config((ctx) => {
		ctx.set(rootCtx, document.querySelector("#editor"));
		ctx.set(defaultValueCtx, "# Guide\n\nHello world\n");
	})
	.use(commonmark)
	.use(createMilkdownMrsfPlugin(host, {
		resourceId: "guide-doc",
		defaultAuthor: "Demo User",
		interactive: true,
	}));

await editor.create();
```

## Crepe Quick Start

```ts
import { Crepe } from "@milkdown/crepe";
import { createCrepeMrsfFeature, createCrepeMrsfToolbarConfig } from "@mrsf/milkdown-mrsf";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";
import "@mrsf/milkdown-mrsf/style.css";

const mrsfOptions = {
  resourceId: "guide-doc",
  defaultAuthor: "Demo User",
  interactive: true,
};

const crepe = new Crepe({
	root: document.querySelector("#editor"),
	defaultValue: "# Guide\n\nHello world\n",
	featureConfigs: {
		toolbar: createCrepeMrsfToolbarConfig(mrsfOptions),
	},
});

crepe.addFeature(createCrepeMrsfFeature(host, mrsfOptions));

await crepe.create();
```

Use the same host adapter for both modes when you want direct Milkdown and Crepe to share a single sidecar persistence model.

In direct Milkdown, the package shows a floating add-comment control for text selections. In Crepe, the same add-comment flow is exposed through Crepe's native selection toolbar and slash menu so it stays aligned with the host editor shell.

## Performance Tuning

`liveTracking` controls how aggressively the plugin recomputes review state while the user types:

- `"debounced"` batches editor text changes and applies them after a short pause. This is the default and is the best fit for rich editing.
- `"save-only"` skips live tracking while typing and applies the pending text diff right before `controller.save()` persists the sidecar.
- `"eager"` applies every text change immediately.

If you need to minimize editor overhead in larger documents, prefer `liveTracking: "debounced"` or `liveTracking: "save-only"`.

## Host Adapter Contract

The package is intentionally host-driven. Your application provides document and sidecar I/O, while the package handles review state, anchoring, projection, and editor overlays.

Required host methods:

- `getDocumentText(resourceId)`
- `discoverSidecar(resourceId)`
- `readSidecar(sidecarPath)`
- `writeSidecar(sidecarPath, document)`

Optional methods:

- `getDocumentPath(resourceId)`
- `watchDocument(resourceId, onChange)`
- `watchSidecar(sidecarPath, onChange)`

## Controller Helpers

Direct Milkdown helpers:

- `getMilkdownMrsfController(editor)`
- `getMilkdownMrsfSelection(editor)`
- `getMilkdownMrsfSelectedText(editor)`
- `getMilkdownMrsfDecorationState(editor)`

Crepe helpers:

- `getCrepeMrsfController(crepe)`
- `getCrepeMrsfSelection(crepe)`
- `getCrepeMrsfSelectedText(crepe)`
- `getCrepeMrsfDecorationState(crepe)`

Use these to build host-side toolbars, side panels, or explicit save/reload/reanchor actions without reimplementing review-state plumbing.

## Visual Behavior

The package uses the same visual vocabulary as the other MRSF plugins:

- inline highlights for anchored `selected_text`
- gutter markers for commented lines
- overlay-based line highlights
- thread tooltips with resolve, unresolve, reply, edit, and delete actions
- built-in MRSF modal dialogs for add, reply, edit, and delete

If you need to disable ProseMirror inline decorations and rely on overlay rendering instead, set `inlineHighlights: false` in the plugin options.

## Demo

The repository includes a runnable browser demo that lets you switch between direct Milkdown and Crepe while both use the same live MRSF review runtime:

```bash
cd examples
npm install
npm run demo:milkdown
```

The demo covers:

- add comment from selection
- reply, edit, resolve, and delete
- write the in-memory sidecar back to the host snapshot
- reload host state
- reanchor the current sidecar
- simulate an external sidecar change

## When To Use It

Choose `@mrsf/milkdown-mrsf` when you are building a Milkdown-based editor and want editor-native MRSF support inside either direct Milkdown or Crepe.

| Need | Best fit |
|------|----------|
| Direct Milkdown editor with MRSF review state | `@mrsf/milkdown-mrsf` |
| Crepe shell with the same MRSF runtime | `@mrsf/milkdown-mrsf` |
| Monaco-based editor surface | `@mrsf/monaco-mrsf` |
| Tiptap rich-text editor integration | `@mrsf/tiptap-mrsf` |
| Turnkey desktop editor experience | VS Code extension |
| Static or rendered HTML output | Marked, markdown-it, or rehype plugins |

## Development

Run tests, coverage, and the package build from the package directory:

```bash
npm test
npm run test:coverage
npm run build
```

## More

- [Website guide](../../docs/guide/milkdown.md)
- [Examples overview](../../examples/README.md)
- [Monaco plugin](../monaco/README.md)
- [Tiptap plugin](../tiptap/README.md)
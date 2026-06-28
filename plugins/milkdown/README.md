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
- `builtinUi: false` opt-out to drive a fully custom UI from the controller
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

## Event & Callback Surface

For fully custom UIs the host stays in sync through two surfaces.

**Subscription callbacks** (plugin/controller options):

| Option | Fires when | Payload |
| --- | --- | --- |
| `onStateChange(event)` | Any review-state change — the single hook a custom thread UI re-renders from. | `{ resourceId, state, dirty, hasPendingShifts, source }`, `source ∈ "load" \| "external" \| "refresh" \| "content" \| "save" \| "reanchor"`. `state` is the full `ReviewState` (document, threads, decoration `snapshot`, `loaded`, `dirty`, `hasPendingShifts`, `lastReanchorResults`). |
| `onCommentSelect(commentId)` | A comment/thread is activated (select/navigate). | `commentId: string` |
| `onSaveRequest(request)` | A save is requested; call `request.defaultSave()` to run the normal sidecar write. | `{ resourceId, state, reason, defaultSave }` |
| `composeAdd(ctx)` | Host supplies a new comment body instead of the built-in add dialog; return `null` to cancel. | `{ selection, selectedText }` → `{ text, severity?, type? } \| null` |
| `composeReply(ctx)` / `composeEdit(ctx)` | Host supplies reply/edit text instead of the dialog; return `null` to cancel. | `{ comment, thread }` → `{ text, severity?, type? } \| null` |
| `confirmDelete(ctx)` | Host confirms a delete instead of the built-in confirm dialog. | `{ comment, thread }` → `boolean` |

**Controller methods** (from `getMilkdownMrsfController` / `getCrepeMrsfController`):

- Read: `getState()`, `getThreadsAtLine(line)`, `getThreadForComment(commentId)`, `getCommentById(commentId)`
- Mutate: `addComment(draft)`, `addCommentFromSelection(...)`, `reply(parentId, draft)`, `edit(commentId, draft)`, `resolve(commentId)`, `unresolve(commentId)`, `toggleResolved(commentId)`, `remove(commentId)`
- Lifecycle: `load(options)`, `reloadFromHost(documentText?)`, `refresh(documentText)`, `applyChanges(changes, documentText)`, `save(options)`, `reanchor(options)`, `dispose()`

Decoration-state changes are observed via `getMilkdownMrsfDecorationState` / `getCrepeMrsfDecorationState`, updating in lockstep with `onStateChange`.

## Custom UIs (`builtinUi: false`)

By default the package renders its own review chrome (gutter/thread overlay, inline & thread tooltips, the selection add button, and the modal add/edit/reply/delete dialogs). Set `builtinUi: false` to suppress **all** of it and drive a fully custom UI from the controller, while anchoring, live line-tracking, the decoration state, the controller, and the callbacks above all stay active:

```ts
editor.use(
  createMilkdownMrsfPlugin(host, {
    resourceId: "doc-1",
    builtinUi: false,
    onStateChange: (event) => renderMyThreads(event.state),
    onCommentSelect: (id) => focusMyThread(id),
  }),
);
```

The `compose*` / `confirmDelete` callbacks replace individual dialogs whether or not `builtinUi` is enabled. `builtinUi: false` is the Milkdown analogue of the rehype plugin's `window.mrsfDisableBuiltinUi` and works identically for Crepe.

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

## Bundling & Peer Dependencies

For hosts bundling this package into an Electron/Vite/webpack app:

- **Module format:** ESM-only. The package is `"type": "module"` and its `exports` map exposes only `import`/`types` conditions — there is no CommonJS (`require`) entry. Two builds ship: the default `.` (Node/neutral) and a `browser` condition plus `./browser` subpath for browser hosts. Styles are a separate side-effecting import at `@mrsf/milkdown-mrsf/style.css`.
- **Tree-shaking / side effects:** declares `"sideEffects": ["**/*.css"]`, so the JavaScript is side-effect-free and dead-code-eliminates cleanly; only imported CSS is retained. Import the stylesheet explicitly when you use the built-in UI.
- **`@milkdown/*` peer range:** `>=7 <8` for `@milkdown/core`, `@milkdown/ctx`, `@milkdown/crepe`, `@milkdown/kit`, `@milkdown/plugin-listener`, and `@milkdown/prose` — this covers the whole 7.x line **including 7.21.x**. `@milkdown/core`, `@milkdown/crepe`, and `@milkdown/kit` are optional in `peerDependenciesMeta`, so you only install the ones your path (direct Milkdown vs. Crepe) needs. Pin one 7.x version across all `@milkdown/*` packages to avoid duplicate-instance/runtime mismatches.

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
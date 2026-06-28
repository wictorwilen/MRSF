---
description: "Milkdown and Crepe integration for Sidemark/MRSF, with a shared review runtime, host adapter, and browser demo."
---

# Milkdown + Crepe Plugin

The `@mrsf/milkdown-mrsf` package brings Sidemark into [Milkdown](https://milkdown.dev/) editors and the higher-level [Crepe](https://milkdown.dev/docs/guide/crepe) shell.

It is built for browser hosts that want editor-native review comments while keeping sidecar persistence and host workflows under application control.

The current package supports both direct Milkdown and Crepe on top of the same review controller, sidecar workflow, overlay UI, and host adapter model.

## Current Scope

- direct Milkdown integration through `createMilkdownMrsfPlugin`
- Crepe integration through `createCrepeMrsfFeature` and `createCrepeMrsfToolbarConfig`
- shared browser host adapter contract for sidecar I/O
- inline highlights, gutter overlays, and thread tooltips
- built-in MRSF dialogs for add, reply, edit, and delete actions
- add, reply, edit, resolve, delete, save, reload, and reanchor flows
- live line tracking while the editor content changes
- selection helpers and controller accessors for host-side UI
- `builtinUi: false` opt-out to drive a fully custom UI from the controller

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

Direct Milkdown and Crepe can use the same host adapter and the same sidecar source of truth.

In direct Milkdown, text selections expose an inline add-comment control. In Crepe, the same action is surfaced through Crepe's native selection toolbar and slash menu, while reply, edit, and delete continue to use the built-in MRSF dialogs.

## Performance Tuning

Use the `liveTracking` option to control how much work the plugin performs during continuous typing:

- `"debounced"` batches editor text changes and applies them after a short pause. This is the default and the recommended mode for richer editing surfaces.
- `"save-only"` defers live tracking until `controller.save()` is called.
- `"eager"` applies every editor text change immediately.

If you need to minimize typing overhead in larger documents, prefer `liveTracking: "debounced"` or `liveTracking: "save-only"`. If you also want to avoid ProseMirror inline decorations, set `inlineHighlights: false`.

## Host Integration Model

The package is intentionally host-driven. Your app owns storage and user workflows; the package owns review state, anchoring, projection, and editor overlays.

Required host methods:

- `getDocumentText(resourceId)`
- `discoverSidecar(resourceId)`
- `readSidecar(sidecarPath)`
- `writeSidecar(sidecarPath, document)`

Optional host methods:

- `getDocumentPath(resourceId)`
- `watchDocument(resourceId, onChange)`
- `watchSidecar(sidecarPath, onChange)`

This makes the package a good fit for browser-based editorial tools, documentation platforms, and internal review systems built on Milkdown.

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

Use these to wire host-side buttons, side panels, explicit save controls, or custom dialogs without rebuilding the anchoring and projection logic yourself.

## Event & Callback Surface

For fully custom UIs the host stays in sync through two surfaces.

**Subscription callbacks** (plugin/controller options):

| Option | Fires when | Payload |
| --- | --- | --- |
| `onStateChange(event)` | Any review-state change — the single hook a custom thread UI re-renders from. | `{ resourceId, state, dirty, hasPendingShifts, source }`, `source ∈ "load" \| "external" \| "refresh" \| "content" \| "save" \| "reanchor"`. `state` is the full `ReviewState`. |
| `onCommentSelect(commentId)` | A comment/thread is activated (select/navigate). | `commentId: string` |
| `onSaveRequest(request)` | A save is requested; call `request.defaultSave()` for the normal sidecar write. | `{ resourceId, state, reason, defaultSave }` |
| `composeAdd(ctx)` | Host supplies a new comment body instead of the add dialog; `null` cancels. | `{ selection, selectedText }` → `{ text, severity?, type? } \| null` |
| `composeReply(ctx)` / `composeEdit(ctx)` | Host supplies reply/edit text instead of the dialog; `null` cancels. | `{ comment, thread }` → `{ text, severity?, type? } \| null` |
| `confirmDelete(ctx)` | Host confirms a delete instead of the confirm dialog. | `{ comment, thread }` → `boolean` |

**Controller methods** (from `getMilkdownMrsfController` / `getCrepeMrsfController`):

- Read: `getState()`, `getThreadsAtLine(line)`, `getThreadForComment(commentId)`, `getCommentById(commentId)`
- Mutate: `addComment(draft)`, `addCommentFromSelection(...)`, `reply(parentId, draft)`, `edit(commentId, draft)`, `resolve(commentId)`, `unresolve(commentId)`, `toggleResolved(commentId)`, `remove(commentId)`
- Lifecycle: `load(options)`, `reloadFromHost(documentText?)`, `refresh(documentText)`, `applyChanges(changes, documentText)`, `save(options)`, `reanchor(options)`, `dispose()`

Decoration-state changes are observed via `getMilkdownMrsfDecorationState` / `getCrepeMrsfDecorationState`, updating in lockstep with `onStateChange`.

## Custom UIs (`builtinUi: false`)

By default the package renders its own review chrome (gutter/thread overlay, inline & thread tooltips, the selection add button, and the add/edit/reply/delete dialogs). Set `builtinUi: false` to suppress all of it and drive a fully custom UI from the controller, while anchoring, live line-tracking, the decoration state, the controller, and the callbacks above stay active:

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

The `compose*` / `confirmDelete` callbacks replace individual dialogs whether or not `builtinUi` is enabled. This is the Milkdown analogue of the rehype plugin's `window.mrsfDisableBuiltinUi` and works identically for Crepe.

## Visual Behavior

The package uses the same display vocabulary as the other MRSF plugins:

- inline highlights for anchored `selected_text`
- gutter markers for commented lines
- line highlight overlays
- thread tooltips with resolve, unresolve, reply, edit, and delete actions
- built-in MRSF modal dialogs for add, reply, edit, and delete

If you need to disable ProseMirror inline decorations and rely on overlay rendering instead, set `inlineHighlights: false` in the plugin options.

## Demo

The repository includes a runnable browser demo in the examples package:

```bash
cd examples
npm install
npm run demo:milkdown
```

Open the local Vite URL and navigate to `/` to try the interactive demo. The page lets you switch between direct Milkdown and Crepe while both are backed by the same MRSF runtime and in-memory sidecar workflow.

## When To Use It

Choose `@mrsf/milkdown-mrsf` when you need editor-native MRSF support inside a Milkdown-based surface and want to support either direct Milkdown or Crepe.

| Need | Best fit |
|------|----------|
| Direct Milkdown editor with MRSF review state | `@mrsf/milkdown-mrsf` |
| Crepe shell with the same MRSF runtime | `@mrsf/milkdown-mrsf` |
| Monaco-based editor surface | `@mrsf/monaco-mrsf` |
| Tiptap rich-text editor integration | `@mrsf/tiptap-mrsf` |
| Turnkey desktop editor experience | VS Code extension |
| Static or rendered HTML output | Marked, markdown-it, or rehype plugins |

## Bundling & Peer Dependencies

For hosts bundling `@mrsf/milkdown-mrsf` into an Electron/Vite/webpack app:

- **Module format:** ESM-only. The package is `"type": "module"` and its `exports` map exposes only `import`/`types` conditions — no CommonJS (`require`) entry. Two builds ship: the default `.` (Node/neutral) and a `browser` condition plus `./browser` subpath. Styles are a separate side-effecting import at `@mrsf/milkdown-mrsf/style.css`.
- **Tree-shaking / side effects:** declares `"sideEffects": ["**/*.css"]`, so the JavaScript is side-effect-free and dead-code-eliminates cleanly; only imported CSS is retained.
- **`@milkdown/*` peer range:** `>=7 <8` for `@milkdown/core`, `@milkdown/ctx`, `@milkdown/crepe`, `@milkdown/kit`, `@milkdown/plugin-listener`, and `@milkdown/prose` — covering the whole 7.x line **including 7.21.x**. `@milkdown/core`, `@milkdown/crepe`, and `@milkdown/kit` are optional in `peerDependenciesMeta`. Pin one 7.x version across all `@milkdown/*` packages to avoid duplicate-instance/runtime mismatches.

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/milkdown#readme)
- [Examples overview](/guide/examples)
- [Monaco plugin](/guide/monaco)
- [Tiptap plugin](/guide/tiptap)
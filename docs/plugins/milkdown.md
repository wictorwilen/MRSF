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

## Custom UIs (`builtinUi: false`)

By default the plugin renders its own review chrome — the gutter/thread overlay, inline and thread tooltips, the selection "add comment" button, and the modal add/edit/reply/delete dialogs. A host that has its own design system can suppress all of that and render its own thread UI instead, while keeping the anchoring engine, live line-tracking, the decoration state, the controller, and all callbacks intact.

Set `builtinUi: false` on the plugin (or Crepe feature) options:

```ts
import {
  createMilkdownMrsfPlugin,
  getMilkdownMrsfController,
  getMilkdownMrsfDecorationState,
} from "@mrsf/milkdown-mrsf";

editor.use(
  createMilkdownMrsfPlugin(host, {
    resourceId: "doc-1",
    builtinUi: false, // suppress the built-in overlay, tooltips, add button, and dialogs
    onStateChange: (event) => renderMyThreads(event.state),
    onCommentSelect: (commentId) => focusMyThread(commentId),
  }),
);

const controller = getMilkdownMrsfController(editor); // drive everything from here
```

When disabled the host owns the entire UI: read state from `onStateChange` / `getMilkdownMrsfController().getState()` (and the decoration snapshot from `getMilkdownMrsfDecorationState`) and call controller methods directly for every action. This is the Milkdown analogue of the rehype plugin's `window.mrsfDisableBuiltinUi`. The same option works for Crepe via `createCrepeMrsfFeature` / `createCrepeMrsfToolbarConfig` and `getCrepeMrsfController` / `getCrepeMrsfDecorationState`.

## Controller Event & Callback Surface

For custom UIs the host stays in sync through the controller. There are two complementary surfaces.

### Subscription callbacks (plugin/controller options)

| Option | Fires when | Payload |
| --- | --- | --- |
| `onStateChange(event)` | Any review-state change (load, external host re-read, content edit, refresh, save, reanchor). The single hook a custom thread UI should re-render from. | `MilkdownMrsfStateChangeEvent` → `{ resourceId, state, dirty, hasPendingShifts, source }` where `source` is `"load" \| "external" \| "refresh" \| "content" \| "save" \| "reanchor"`. `state` is the full `ReviewState` (document, threads, decoration `snapshot`, `loaded`, `dirty`, `hasPendingShifts`, `lastReanchorResults`). |
| `onCommentSelect(commentId)` | A comment/thread is activated (selection/navigate). | `commentId: string` |
| `onSaveRequest(request)` | A save is requested; lets the host intercept persistence. Call `request.defaultSave()` to run the normal sidecar write. | `MilkdownMrsfPluginSaveRequest` → `{ resourceId, state, reason, defaultSave }` |
| `composeAdd(ctx)` | The host supplies the body for a new comment instead of the built-in add dialog. Return `null` to cancel. | `MilkdownMrsfSelectionActionContext` → `{ selection, selectedText }`; returns `MilkdownMrsfComposeResult \| null` → `{ text, severity?, type? }` |
| `composeReply(ctx)` / `composeEdit(ctx)` | The host supplies reply/edit text instead of the built-in dialog. Return `null` to cancel. | `MilkdownMrsfTooltipActionContext` → `{ comment, thread }`; returns `MilkdownMrsfComposeResult \| null` |
| `confirmDelete(ctx)` | The host confirms a delete instead of the built-in confirm dialog. | `MilkdownMrsfTooltipActionContext`; returns `boolean` |

The `compose*` / `confirmDelete` callbacks are honored whether or not `builtinUi` is enabled — they replace just the corresponding dialog. `onStateChange`, `onCommentSelect`, and `onSaveRequest` remain active when `builtinUi: false`.

### Controller methods (imperative actions)

From `getMilkdownMrsfController(editor)` / `getCrepeMrsfController(ctx)`:

- **Read:** `getState()`, `getThreadsAtLine(line)`, `getThreadForComment(commentId)`, `getCommentById(commentId)`
- **Mutate:** `addComment(draft)`, `addCommentFromSelection(...)`, `reply(parentId, draft)`, `edit(commentId, draft)`, `resolve(commentId)`, `unresolve(commentId)`, `toggleResolved(commentId)`, `remove(commentId)`
- **Lifecycle:** `load(options)`, `reloadFromHost(documentText?)`, `refresh(documentText)`, `applyChanges(changes, documentText)`, `save(options)`, `reanchor(options)`, `dispose()`

Decoration-state changes are observed via `getMilkdownMrsfDecorationState(editor)` / `getCrepeMrsfDecorationState(ctx)` (a ProseMirror plugin state holding the live `DecorationSet`), which updates in lockstep with `onStateChange`.

## Bundling & Peer Dependencies

For hosts bundling `@mrsf/milkdown-mrsf` into an Electron/Vite/webpack app:

- **Module format:** ESM-only. The package is `"type": "module"` and the `exports` map exposes only `import`/`types` conditions — there is no CommonJS (`require`) entry. There are two builds: the default `.` (Node/neutral) and a `browser` condition / `./browser` subpath for browser hosts. Styles are a separate side-effecting import at `@mrsf/milkdown-mrsf/style.css`.
- **Tree-shaking / side effects:** The package declares `"sideEffects": ["**/*.css"]`, so the JavaScript is treated as side-effect-free and dead-code-eliminates cleanly; only the CSS is retained when imported. Always import the stylesheet explicitly if you use the built-in UI.
- **`@milkdown/*` peer range:** `>=7 <8` for `@milkdown/core`, `@milkdown/ctx`, `@milkdown/crepe`, `@milkdown/kit`, `@milkdown/plugin-listener`, and `@milkdown/prose`. This covers the 7.x line **including 7.21.x**. `@milkdown/core`, `@milkdown/crepe`, and `@milkdown/kit` are marked optional in `peerDependenciesMeta` so you only need the ones your integration path uses (direct Milkdown vs. Crepe). Pin a single 7.x version across all `@milkdown/*` packages to avoid duplicate-instance/runtime mismatches.

## More

- [Package README](https://github.com/wictorwilen/MRSF/tree/main/plugins/milkdown#readme)
- [Examples overview](/guide/examples)
- [Monaco plugin](/plugins/monaco)
- [Tiptap plugin](/plugins/tiptap)
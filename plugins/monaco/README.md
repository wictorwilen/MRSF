# @mrsf/monaco-mrsf

Monaco editor integration for Sidemark/MRSF review comments.

This package is being built in phases.

Current scope:

- public type contracts for host integrations
- editor-agnostic anchor and selection mapping helpers
- live line tracking for in-memory anchor updates during editing
- neutral thread and decoration projection over MRSF sidecars
- Monaco decoration mapping and editor adapter for applying gutter and inline annotations
- review store and plugin controller for loading, mutating, saving, and reanchoring sidecars through a host adapter
- hover summaries and editor action registration for add, reply, resolve, and reanchor workflows

Planned next:

- richer host helpers and example integration
- richer multi-thread action UX and explicit save hooks for host applications

The package is intended to work in both browser and desktop hosts by taking host-provided document and sidecar I/O adapters.

## Example

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

For real browser apps, replace `MemoryHostAdapter` with a host adapter that reads and writes sidecars through your backend or workspace service.
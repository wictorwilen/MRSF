---
description: "Browse Sidemark / MRSF plugins for rendering pipelines and editor integrations, including markdown-it, rehype, Marked, Marp, Monaco, Milkdown, and Tiptap."
---

# Plugins

Sidemark ships as a core review model plus a set of plugins for different host environments. This section collects the publishable integrations in one place so rendering pipelines and interactive editors are easier to compare.

## Rendering Plugins

Use these when you want MRSF comments rendered into HTML output.

| Plugin | Package | Best fit |
|--------|---------|----------|
| [markdown-it](/plugins/markdown-it) | `@mrsf/markdown-it-mrsf` | VitePress, markdown-it apps, static HTML rendering |
| [rehype](/plugins/rehype) | `@mrsf/rehype-mrsf` | unified, MDX, Astro, Docusaurus, rehype pipelines |
| [Marked](/plugins/marked) | `@mrsf/marked) | Marked-based renderers and browser markdown previews |
| [Marp](/plugins/marp) | `@mrsf/marp-mrsf` | Marpit and Marp presentation rendering |

All rendering plugins share the same controller vocabulary, CSS model, gutter behavior, inline highlight semantics, and `mrsf:*` event model as closely as the host renderer allows.

## Editor Plugins

Use these when you want comments inside a live editing surface.

| Plugin | Package | Best fit |
|--------|---------|----------|
| [Monaco](/plugins/monaco) | `@mrsf/monaco-mrsf` | Custom Monaco-based apps and editor portals |
| [Milkdown + Crepe](/plugins/milkdown) | `@mrsf/milkdown-mrsf` | Browser editors using Milkdown directly or Crepe on top |
| [Tiptap](/plugins/tiptap) | `@mrsf/tiptap-mrsf` | Experimental rich-text editor integration on Tiptap |

## Choosing a Plugin

Choose based on where comments need to appear:

- Use a rendering plugin when your host already renders Markdown to HTML and you want badges, highlights, and tooltips in the output.
- Use an editor plugin when your host owns a live editing surface and needs comment state, overlays, and host-controlled persistence.
- Use the [VS Code extension](/vscode/) when you want a ready-made desktop workflow instead of embedding Sidemark in your own host.

## Common Model

All plugins still work from the same MRSF sidecar model:

- sidecar comments remain outside the Markdown source
- canonical anchors are line, range, column, and `selected_text`
- host applications own persistence and save flows
- interactive integrations emit `mrsf:*` events or controller actions instead of hard-coding storage

## Next Steps

- [Quick Start](/guide/quick-start)
- [Examples](/guide/examples)
- [CLI](/cli/)
- [MCP Server](/mcp/)
---
layout: home
description: "Sidemark (MRSF) — portable, version-controlled, machine-actionable review comments stored outside your Markdown files. CLI, MCP server, VS Code extension, and rendering plugins."

hero:
  name: Sidemark
  text: Markdown Review Sidecar Format (MRSF)
  tagline: Portable, version-controlled, machine-actionable review comments — outside your Markdown files.
  image:
    src: /android-chrome-512x512.png
    alt: Sidemark logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: Read the Spec
      link: /specification
    - theme: alt
      text: View on GitHub
      link: https://github.com/wictorwilen/MRSF

features:
  - icon: 💡
    title: '"Pull Requests review changes. Sidemark reviews documents over time."'
    details: "PR Reviews Aren’t Built for Living Documents"
  - icon: 📝
    title: Keeps Markdown Clean
    details: Review comments live in sidecar files, not inline annotations. Your documents stay readable and diff-friendly.
  - icon: 🔗
    title: Durable Anchoring
    details: Comments anchor to lines, columns, and selected text. When the document changes, re-anchoring finds their new positions automatically.
  - icon: 🤖
    title: AI & Agent Ready
    details: Structured YAML format with MCP server support. AI assistants can read, create, and manage reviews through standard protocols.
    link: https://www.npmjs.com/package/@mrsf/mcp
    linkText: "@mrsf/mcp on npm"
  - icon: ✅
    title: Validation & Schema
    details: JSON Schema and CLI validation ensure sidecars are well-formed. Integrates into CI/CD pipelines.
  - icon: 🔄
    title: Git-Aware
    details: Tracks commits, detects staleness, and uses git diffs for intelligent re-anchoring after edits.
  - icon: 📦
    title: Simple Tooling
    details: "npm install -g @mrsf/cli — validate, add, resolve, reanchor, and more from the terminal."
    link: https://www.npmjs.com/package/@mrsf/cli
    linkText: "@mrsf/cli on npm"
  - icon: 🐍
    title: Python CLI & SDK
    details: "pip install mrsf — validate, add, resolve, reanchor, and more from the terminal."
    link: https://pypi.org/project/mrsf/
    linkText: "mrsf on PyPI"
  - icon: 💻
    title: VS Code Extension
    details: "Sidemark for VS Code — gutter icons, inline previews, hover cards, sidebar panel, and automatic reanchoring built right into your editor."
    link: https://marketplace.visualstudio.com/items?itemName=wictor.mrsf-vscode
    linkText: "VS Code Marketplace"
  - icon: 🧩
    title: Monaco Plugin
    details: "Embed Sidemark directly into Monaco-based editors with @mrsf/monaco-mrsf — gutter annotations, inline highlights, hover summaries, and host-driven comment workflows."
    link: https://www.npmjs.com/package/@mrsf/monaco-mrsf
    linkText: "@mrsf/monaco-mrsf on npm"
  - icon: 🎨
    title: markdown-it Plugin
    details: "Render review comments as badges, line highlights, and tooltips with @mrsf/markdown-it-mrsf — works with VitePress and any markdown-it project."
    link: https://www.npmjs.com/package/@mrsf/markdown-it-mrsf
    linkText: "@mrsf/markdown-it-mrsf on npm"
  - icon: 🏷️
    title: Marked Plugin
    details: "Use @mrsf/marked-mrsf to render review comments in Marked pipelines and browser-based Markdown renderers with the same shared controller and CSS."
    link: https://www.npmjs.com/package/@mrsf/marked-mrsf
    linkText: "@mrsf/marked-mrsf on npm"
  - icon: 🔌
    title: rehype Plugin
    details: "Use @mrsf/rehype-mrsf to render comments in the unified ecosystem — Astro, Next.js MDX, Docusaurus, and more."
    link: https://www.npmjs.com/package/@mrsf/rehype-mrsf
    linkText: "@mrsf/rehype-mrsf on npm"
---

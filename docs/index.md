---
layout: home

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
  - icon: 📝
    title: Keeps Markdown Clean
    details: Review comments live in sidecar files, not inline annotations. Your documents stay readable and diff-friendly.
  - icon: 🔗
    title: Durable Anchoring
    details: Comments anchor to lines, columns, and selected text. When the document changes, re-anchoring finds their new positions automatically.
  - icon: 🤖
    title: AI & Agent Ready
    details: Structured YAML format with MCP server support. AI assistants can read, create, and manage reviews through standard protocols.
  - icon: ✅
    title: Validation & Schema
    details: JSON Schema and CLI validation ensure sidecars are well-formed. Integrates into CI/CD pipelines.
  - icon: 🔄
    title: Git-Aware
    details: Tracks commits, detects staleness, and uses git diffs for intelligent re-anchoring after edits.
  - icon: 📦
    title: Simple Tooling
    details: "npm install -g @mrsf/cli — validate, add, resolve, reanchor, and more from the terminal."
  - icon: 💻
    title: VS Code Extension
    details: "Sidemark for VS Code — gutter icons, inline previews, hover cards, sidebar panel, and automatic reanchoring built right into your editor."
---

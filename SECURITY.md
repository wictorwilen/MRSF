# Security Policy

## Supported Versions

| Package | Supported release line |
|---------|------------------------|
| `@mrsf/cli` | `0.5.x` |
| `@mrsf/mcp` | `0.6.x` |
| Rendering & editor plugins (`@mrsf/rehype-mrsf`, `@mrsf/markdown-it-mrsf`, `@mrsf/marked-mrsf`, `@mrsf/marp-mrsf`, `@mrsf/monaco-mrsf`, `@mrsf/milkdown-mrsf`, `@mrsf/tiptap-mrsf`) | Latest published release |
| Older release lines | Unsupported |

## Security Posture

MRSF packages perform **no network I/O**. They access only the targeted Markdown document and its co-located or configured sidecar file. When `sidecar_root` is configured, absolute paths and paths containing `..` traversal are rejected.

Git operations are read-only, run via `execFile` without a shell, use a timeout, and degrade gracefully by returning `null` when git is unavailable.

### XSS / Untrusted Content

Per the MRSF specification, comment `text` is plain text, not HTML or Markdown. The rendering plugins escape `text`, `author`, `selected_text`, and `id` with `escapeHtml` before emitting HTML, so untrusted comment content cannot inject markup through MRSF.

`@mrsf/rehype-mrsf` operates inside a unified/rehype pipeline. If a host enables `allowDangerousHtml` for other content, that is the host application's responsibility; MRSF's own comment fields remain escaped. Hosts should keep their Markdown pipeline's sanitization enabled.

## Reporting a Vulnerability

If you discover a security vulnerability in MRSF / Sidemark, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **[wictor@wictorwilen.se](mailto:wictor@wictorwilen.se)** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. The potential impact
4. Any suggested fix (optional)

You should receive an acknowledgment within **48 hours**. We will work with you to understand the issue and coordinate a fix and disclosure timeline.

## Scope

This policy applies to:

- `@mrsf/cli` — CLI and library
- `@mrsf/mcp` — MCP server
- `@mrsf/markdown-it-mrsf` — markdown-it plugin
- `@mrsf/rehype-mrsf` — rehype plugin
- `mrsf-vscode` — VS Code extension
- The MRSF specification itself

## Disclosure

We follow coordinated disclosure. Once a fix is available, we will:

1. Release patched versions of affected packages
2. Publish a GitHub Security Advisory
3. Credit the reporter (unless they prefer to remain anonymous)

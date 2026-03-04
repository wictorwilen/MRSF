# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✅ Current |
| < 0.3   | ❌ No      |

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

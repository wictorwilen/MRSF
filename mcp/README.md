# @mrsf/mcp

Model Context Protocol (MCP) server for the **Markdown Review Sidecar Format** (MRSF).

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![MRSF v1.0 Draft](https://img.shields.io/badge/MRSF-v1.0%20Draft-blue)](MRSF-v1.0.md)
[![@mrsf/mcp on npm](https://img.shields.io/npm/v/@mrsf/mcp?label=%40mrsf%2Fmcp)](https://www.npmjs.com/package/@mrsf/mcp)
[![npm downloads (mcp)](https://img.shields.io/npm/dm/@mrsf/mcp?label=mcp%20downloads)](https://www.npmjs.com/package/@mrsf/mcp)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=)](https://modelcontextprotocol.io)

Exposes MRSF operations as MCP tools and resources so that AI assistants (Claude Desktop, Cursor, VS Code Copilot, etc.) can discover, validate, and manage review sidecars through the standard [MCP protocol](https://modelcontextprotocol.io/).

## Installation

```bash
npm install -g @mrsf/mcp
```

Or use directly:

```bash
npx @mrsf/mcp
```

## Quick Start — Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "mrsf": {
      "command": "npx",
      "args": ["-y", "@mrsf/mcp"]
    }
  }
}
```

Restart Claude Desktop — the MRSF tools will appear automatically.

## Quick Start — VS Code / Cursor

Add to your project's `.vscode/mcp.json`:

```json
{
  "servers": {
    "mrsf": {
      "command": "npx",
      "args": ["-y", "@mrsf/mcp"]
    }
  }
}
```

## Transport Options

| Flag | Default | Description |
| --- | --- | --- |
| `--transport stdio` | ✔ | Standard I/O (Claude Desktop, Cursor, VS Code) |
| `--transport sse` | | Server-Sent Events over HTTP |
| `--port <n>` | `3001` | Port for SSE transport |

```bash
# Default — stdio
mrsf-mcp

# SSE on custom port
mrsf-mcp --transport sse --port 8080
```

## Tools

The server exposes the following MCP tools:

| Tool | Description |
| --- | --- |
| `mrsf_discover` | Find the sidecar file for a Markdown document |
| `mrsf_validate` | Validate sidecar files against the MRSF schema |
| `mrsf_reanchor` | Re-anchor comments after a document has been edited |
| `mrsf_add` | Add a new review comment to a sidecar |
| `mrsf_resolve` | Resolve or unresolve a comment by ID |
| `mrsf_list` | List and filter comments (by status, author, type, severity) |
| `mrsf_status` | Check anchor health (fresh / stale / orphaned) |
| `mrsf_rename` | Update a sidecar after its document has been renamed |

### Tool Details

#### `mrsf_discover`

Find the MRSF sidecar for a Markdown document.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document |
| `cwd` | string | | Working directory |

#### `mrsf_validate`

Validate one or more sidecar files.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown paths (discovers all if omitted) |
| `strict` | boolean | | Treat warnings as errors |
| `cwd` | string | | Working directory |

#### `mrsf_reanchor`

Re-anchor comments after document edits.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown paths |
| `dryRun` | boolean | | Report without writing changes |
| `threshold` | number | | Fuzzy match threshold 0.0–1.0 (default 0.6) |
| `updateText` | boolean | | Also update `selected_text` with current text |
| `cwd` | string | | Working directory |

#### `mrsf_add`

Add a review comment.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document |
| `text` | string | ✔ | Comment text |
| `author` | string | ✔ | Author identifier |
| `line` | number | | Starting line (1-based) |
| `end_line` | number | | Ending line (inclusive) |
| `start_column` | number | | Starting column (0-based) |
| `end_column` | number | | Ending column |
| `type` | string | | Comment type |
| `severity` | `"low"` \| `"medium"` \| `"high"` | | Severity |
| `reply_to` | string | | Parent comment ID |
| `cwd` | string | | Working directory |

#### `mrsf_resolve`

Resolve or unresolve a comment.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `sidecar` | string | ✔ | Sidecar path or its Markdown document |
| `id` | string | ✔ | Comment ID |
| `unresolve` | boolean | | Set true to unresolve |
| `cwd` | string | | Working directory |

#### `mrsf_list`

List and filter comments.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown paths |
| `open` | boolean | | Only unresolved comments |
| `resolved` | boolean | | Only resolved comments |
| `author` | string | | Filter by author |
| `type` | string | | Filter by type |
| `severity` | `"low"` \| `"medium"` \| `"high"` | | Filter by severity |
| `summary` | boolean | | Return summary statistics |
| `cwd` | string | | Working directory |

#### `mrsf_status`

Check anchor health of all comments.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown paths |
| `cwd` | string | | Working directory |

#### `mrsf_rename`

Update sidecar after a document rename/move.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `oldDocument` | string | ✔ | Old path to the Markdown document |
| `newDocument` | string | ✔ | New path to the Markdown document |
| `cwd` | string | | Working directory |

## Resources

The server also exposes MCP resources for direct data access:

| URI Pattern | Description |
| --- | --- |
| `mrsf://sidecar/{path}` | Full parsed sidecar document as JSON |
| `mrsf://comment/{path}/{id}` | A single review comment |
| `mrsf://anchors/{path}` | Anchor health status for all comments |

## Agent Skill Example

The repository includes a ready-to-use [Agent Skill](https://agentskills.io/) that teaches AI agents to review Markdown documents using the MCP server. See the [skill on GitHub](https://github.com/wictorwilen/MRSF/blob/main/examples/mrsf-review/SKILL.md).

Copy it into your project:

```bash
cp -r examples/mrsf-review .agent/skills/
```

The skill instructs the agent to discover sidecars, add anchored comments with type and severity, validate results, and summarize findings — all through the MCP tools above.

## Requirements

- Node.js ≥ 18
- `@mrsf/cli` (installed automatically as a dependency)

## License

MIT

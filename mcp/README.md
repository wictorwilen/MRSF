# @mrsf/mcp

Model Context Protocol (MCP) server for **Sidemark** — the **Markdown Review Sidecar Format** (MRSF).

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![MRSF v1.0 Draft](https://img.shields.io/badge/MRSF-v1.0%20Draft-blue)](MRSF-v1.0.md)
[![@mrsf/mcp on npm](https://img.shields.io/npm/v/@mrsf/mcp?label=%40mrsf%2Fmcp)](https://www.npmjs.com/package/@mrsf/mcp)
[![npm downloads (mcp)](https://img.shields.io/npm/dm/@mrsf/mcp?label=mcp%20downloads)](https://www.npmjs.com/package/@mrsf/mcp)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blueviolet?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=)](https://modelcontextprotocol.io)

Exposes Sidemark (MRSF) operations as MCP tools and resources so that AI assistants (Claude Desktop, Cursor, VS Code Copilot, etc.) can discover, validate, and manage review sidecars through the standard [MCP protocol](https://modelcontextprotocol.io/).

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
| `mrsf_discover` | Find the sidecar for a Markdown document |
| `mrsf_validate` | Validate sidecars against the MRSF schema |
| `mrsf_reanchor` | Re-anchor comments after a document has been edited |
| `mrsf_add` | Add a new review comment to a sidecar |
| `mrsf_add_batch` | Add multiple review comments in one atomic call |
| `mrsf_update` | Update fields of an existing comment by ID |
| `mrsf_resolve` | Resolve or unresolve comments by ID(s) or filters |
| `mrsf_list` | List and filter comments (status, author, type, severity) with full or compact output |
| `mrsf_status` | Check anchor health (fresh / stale / orphaned) |
| `mrsf_rename` | Update a sidecar after its document has been renamed |
| `mrsf_delete` | Delete a comment by ID (with optional cascade) |
| `mrsf_repair` | Repair or reset a corrupted sidecar |
| `mrsf_help` | List all tools and their parameter schemas |

### Tool Details

#### `mrsf_discover`

Find the Sidemark (MRSF) sidecar for a Markdown document.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document |
| `cwd` | string | | Working directory (defaults to process.cwd()) |

#### `mrsf_validate`

Validate one or more Sidemark (MRSF) sidecars.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown file paths. If omitted, discovers all sidecars in the workspace. |
| `strict` | boolean | | Treat warnings as errors |
| `cwd` | string | | Working directory |

#### `mrsf_reanchor`

Re-anchor comments after document edits.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown file paths. If omitted, discovers all sidecars. |
| `dryRun` | boolean | | Report without modifying files |
| `threshold` | number | | Fuzzy match threshold 0.0–1.0 (default 0.6) |
| `updateText` | boolean | | Also replace `selected_text` with current document text |
| `force` | boolean | | Firmly anchor high-confidence results: update commit to HEAD and clear audit fields |
| `cwd` | string | | Working directory |

#### `mrsf_add`

Add a review comment to a Sidemark (MRSF) sidecar.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document |
| `text` | string | ✔ | Comment text |
| `author` | string | ✔ | Author identifier (e.g. 'Name (handle)') |
| `line` | number | | Starting line number (1-based) |
| `end_line` | number | | Ending line number (inclusive) |
| `start_column` | number | | Starting column (0-based) |
| `end_column` | number | | Ending column |
| `type` | string | | Comment type: suggestion, issue, question, accuracy, style, clarity |
| `severity` | `"low"` \| `"medium"` \| `"high"` | | Severity level |
| `reply_to` | string | | Parent comment ID for threading |
| `cwd` | string | | Working directory |

#### `mrsf_add_batch`

Add multiple review comments to a Sidemark (MRSF) sidecar in one atomic write.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document |
| `comments` | object[] | ✔ | Array of comments: each needs `text` and `author`, optional `line`, `end_line`, `start_column`, `end_column`, `type`, `severity`, `reply_to` |
| `cwd` | string | | Working directory |

#### `mrsf_update`

Update fields of an existing comment by ID (only provided fields are changed).

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document or its sidecar |
| `id` | string | ✔ | Comment ID to update |
| `text` | string | | New comment text |
| `type` | string | | New type: suggestion, issue, question, accuracy, style, clarity |
| `severity` | `"low"` \| `"medium"` \| `"high"` | | New severity level |
| `line` | number | | New starting line number (1-based) |
| `end_line` | number | | New ending line number (inclusive) |
| `start_column` | number | | New starting column (0-based) |
| `end_column` | number | | New ending column |
| `cwd` | string | | Working directory |

#### `mrsf_resolve`

Resolve or unresolve comments. Provide a single `id`, an array of `ids`, or filters.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document or its sidecar |
| `id` | string | | Single comment ID to resolve/unresolve |
| `ids` | string[] | | Array of comment IDs to resolve/unresolve |
| `author` | string | | Resolve all comments by this author |
| `type` | string | | Resolve all comments of this type |
| `severity` | `"low"` \| `"medium"` \| `"high"` | | Resolve all comments of this severity |
| `unresolve` | boolean | | Set to true to unresolve instead |
| `cwd` | string | | Working directory |

#### `mrsf_list`

List and filter comments across Sidemark (MRSF) sidecars.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown file paths. If omitted, discovers all sidecars. |
| `open` | boolean | | Only show unresolved comments |
| `resolved` | boolean | | Only show resolved comments |
| `author` | string | | Filter by author |
| `type` | string | | Filter by type |
| `severity` | `"low"` \| `"medium"` \| `"high"` | | Filter by severity |
| `format` | `"full"` \| `"compact"` | | Output format: `full` (JSON) or `compact` (text table) |
| `summary` | boolean | | Return summary statistics instead of full comments |
| `cwd` | string | | Working directory |

#### `mrsf_status`

Check anchor health of all comments in Sidemark (MRSF) sidecars.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `files` | string[] | | Sidecar or Markdown file paths. If omitted, discovers all sidecars. |
| `cwd` | string | | Working directory |

#### `mrsf_rename`

Update sidecar after a document rename/move.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `oldDocument` | string | ✔ | Old path to the Markdown document |
| `newDocument` | string | ✔ | New path to the Markdown document |
| `cwd` | string | | Working directory |

#### `mrsf_delete`

Delete a comment by ID from a sidecar. By default, direct replies are promoted (they inherit the parent's anchor and their `reply_to` is re-pointed to the grandparent). Use `cascade` to delete direct replies along with the parent instead.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document or its sidecar |
| `id` | string | ✔ | Comment ID to delete |
| `cascade` | boolean | | When true, also remove direct replies instead of promoting them (default: false) |
| `cwd` | string | | Working directory |

#### `mrsf_repair`

Repair or reset a corrupted sidecar. Use `salvage` strategy to attempt recovering parseable comments from a corrupted sidecar (rewrites it cleanly). Use `reset` strategy to delete the sidecar and start fresh with an empty comment list.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `document` | string | ✔ | Path to the Markdown document or its sidecar |
| `strategy` | `"salvage"` \| `"reset"` | | Repair strategy: `salvage` (default) attempts to recover comments; `reset` starts fresh |
| `cwd` | string | | Working directory |

#### `mrsf_help`

List all available Sidemark (MRSF) MCP tools with their parameter schemas. Optionally filter to a specific tool for detailed parameter info.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `tool` | string | | Tool name to get detailed help for (e.g. `mrsf_add`). Omit to list all tools. |

## Resources

The server also exposes MCP resources for direct data access:

| URI Pattern | Description |
| --- | --- |
| `mrsf://sidecar/{path}` | Full parsed Sidemark (MRSF) sidecar as JSON |
| `mrsf://comment/{path}/{id}` | A single review comment from a sidecar |
| `mrsf://anchors/{path}` | Anchor health status for all comments in a sidecar |

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

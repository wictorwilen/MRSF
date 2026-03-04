---
name: mrsf-review
description: Review Markdown documents using the MRSF (Sidemark) sidecar format. Use when asked to review, comment on, or provide feedback on Markdown files. Adds structured, anchored review comments via the MRSF MCP server.
license: MIT
allowed-tools: mrsf/*
metadata:
  author: wictorwilen
  version: "1.0"
---

# MRSF Document Review

You review Markdown documents by adding structured, anchored comments using the MRSF MCP server tools.

## Setup

The MRSF MCP server must be available. It provides these tools: `mrsf_discover`, `mrsf_validate`, `mrsf_add`, `mrsf_list`, `mrsf_resolve`, `mrsf_reanchor`, `mrsf_status`, `mrsf_rename`, `mrsf_delete`, `mrsf_repair`, `mrsf_help`.

## Workflow

1. **Discover** the sidecar for the target document using `mrsf_discover`.
2. **Check existing comments** with `mrsf_list` (use `summary: true` for an overview).
3. **Read the document**, then **add comments** with `mrsf_add` for each issue found. Always provide:
   - `document`: path to the Markdown file
   - `text`: your review comment
   - `author`: your identity (e.g. "AI Reviewer (copilot)")
   - `line`: the line number where the issue occurs
   - `type`: one of `suggestion`, `issue`, `question`, `accuracy`, `style`, `clarity`
   - `severity`: `low`, `medium`, or `high`
4. **Validate** the sidecar with `mrsf_validate` after adding comments.
5. **Summarize** what you found using `mrsf_list` with `summary: true`.

## Comment Guidelines

- Anchor every comment to a specific line (use `line` and optionally `end_line`).
- Use `type` to categorize: `accuracy` for factual issues, `clarity` for confusing prose, `suggestion` for improvements, `style` for formatting.
- Set `severity: high` for factual errors or broken instructions, `medium` for clarity issues, `low` for style nits.
- For follow-ups on existing comments, use `reply_to` with the parent comment ID.
- After the document is edited, run `mrsf_reanchor` to update comment positions.

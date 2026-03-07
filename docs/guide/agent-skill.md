---
description: "Use the Sidemark (MRSF) agent skill to teach AI assistants (Claude, Copilot, Cursor) how to review Markdown documents via the MCP server."
---

# Agent Skill: Document Review

MRSF includes a ready-to-use [Agent Skill](https://agentskills.io/) that teaches AI agents to review Markdown documents using the MCP server.

## What is an Agent Skill?

Agent Skills are a portable, open format for giving AI agents new capabilities. A skill is a folder with a `SKILL.md` file containing structured instructions that any skills-compatible agent (Claude Code, Copilot, Junie, OpenHands, etc.) can discover and use.

## The `mrsf-review` Skill

The skill lives at [`examples/mrsf-review/SKILL.md`](https://github.com/wictorwilen/MRSF/blob/main/examples/mrsf-review/SKILL.md) and instructs an agent to:

1. **Discover** the sidecar for the target document
2. **Check existing comments** for context
3. **Read and review** the document, adding anchored comments with type and severity
4. **Validate** the sidecar after adding comments
5. **Summarize** findings

Each comment is anchored to a specific line with a category (`accuracy`, `clarity`, `suggestion`, `style`, `issue`, `question`) and severity (`low`, `medium`, `high`).

If an agent needs to attach tool-specific metadata, the MCP tools also support an explicit `extensions` object whose keys must start with `x_`. Those entries are stored on disk as flat `x_*` fields on the comment.

## Installation

Copy the skill folder into your project:

```bash
cp -r examples/mrsf-review .agent/skills/
```

Or clone directly:

```bash
mkdir -p .agent/skills
curl -sL https://raw.githubusercontent.com/wictorwilen/MRSF/main/examples/mrsf-review/SKILL.md \
  -o .agent/skills/mrsf-review/SKILL.md --create-dirs
```

## Prerequisites

The MRSF MCP server must be configured for your agent. See [MCP Server](/mcp/) for setup instructions.

## Full Skill File

Below is the complete `SKILL.md` — copy it as-is into your project:

<!--@include: ../../examples/mrsf-review/SKILL.md-->

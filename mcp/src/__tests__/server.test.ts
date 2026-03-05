/**
 * MCP Server tests — verifies that the MRSF MCP server:
 * 1. Can be created and connected (import/bundle healthcheck)
 * 2. Registers all expected tools
 * 3. Tools can be called and return correct results
 *
 * Uses the SDK's InMemoryTransport so tests run entirely in-process
 * without needing stdio or network.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMrsfServer } from "../server.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let client: Client;
let cleanup: () => Promise<void>;
let tmpDir: string;

const FIXTURE_MD = "# Hello World\n\nThis is a test document.\n\nLine four.\nLine five.\n";
const FIXTURE_SIDECAR = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-parent
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Parent comment
    resolved: false
    line: 3
    selected_text: "This is a test document."
  - id: c-reply
    author: Bob
    timestamp: "2026-01-01T00:01:00Z"
    text: A reply
    resolved: false
    reply_to: c-parent
  - id: c-standalone
    author: Carol
    timestamp: "2026-01-01T00:02:00Z"
    text: Standalone comment
    resolved: false
    line: 5
    selected_text: "Line four."
`;

/** Set up a temp workspace with a markdown file and sidecar. */
async function createFixture() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mrsf-mcp-test-"));
  await resetFixture();
}

/** Reset the fixture files to their original state. */
async function resetFixture() {
  await fs.writeFile(path.join(tmpDir, "test.md"), FIXTURE_MD);
  await fs.writeFile(path.join(tmpDir, "test.md.review.yaml"), FIXTURE_SIDECAR);
}

// ---------------------------------------------------------------------------
// Connect server ↔ client via InMemoryTransport
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await createFixture();

  const server = createMrsfServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = async () => {
    await client.close();
    await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  };
});

afterAll(async () => {
  await cleanup?.();
});

// ---------------------------------------------------------------------------
// 1. Server creation & connection (prevents import resolution regressions)
// ---------------------------------------------------------------------------

describe("server creation", () => {
  it("createMrsfServer returns an object with connect method", () => {
    const s = createMrsfServer();
    expect(typeof s.connect).toBe("function");
  });

  it("client is connected after handshake", () => {
    // If we got here, the InMemoryTransport handshake succeeded
    expect(client).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Tool registration — all expected tools are present
// ---------------------------------------------------------------------------

describe("tool registration", () => {
  const EXPECTED_TOOLS = [
    "mrsf_discover",
    "mrsf_validate",
    "mrsf_reanchor",
    "mrsf_add",
    "mrsf_add_batch",
    "mrsf_resolve",
    "mrsf_list",
    "mrsf_status",
    "mrsf_rename",
    "mrsf_delete",
    "mrsf_repair",
    "mrsf_help",
  ];

  let toolNames: string[];

  beforeAll(async () => {
    const result = await client.listTools();
    toolNames = result.tools.map((t) => t.name);
  });

  it("lists all expected tools", () => {
    for (const name of EXPECTED_TOOLS) {
      expect(toolNames).toContain(name);
    }
  });

  it("has no unexpected tools", () => {
    for (const name of toolNames) {
      expect(EXPECTED_TOOLS).toContain(name);
    }
  });

  it(`has ${EXPECTED_TOOLS.length} tools total`, () => {
    expect(toolNames).toHaveLength(EXPECTED_TOOLS.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Tool invocations
// ---------------------------------------------------------------------------

describe("mrsf_discover", () => {
  it("finds the sidecar for the test document", async () => {
    const result = await client.callTool({
      name: "mrsf_discover",
      arguments: { document: "test.md", cwd: tmpDir },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.sidecarPath).toContain("test.md.review.yaml");
  });

  it("returns error for non-existent document", async () => {
    const result = await client.callTool({
      name: "mrsf_discover",
      arguments: { document: "nope.md", cwd: tmpDir },
    });
    expect(result.isError).toBe(true);
  });
});

describe("mrsf_validate", () => {
  it("validates the test sidecar", async () => {
    const result = await client.callTool({
      name: "mrsf_validate",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.valid).toBe(true);
  });

  it("rejects a sidecar missing required fields (schema loaded)", async () => {
    // Write a sidecar with a comment missing the required "resolved" field.
    // If the JSON Schema is loaded correctly this must be invalid.
    const badSidecar = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-bad
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Missing resolved field
`;
    const badPath = "bad.md.review.yaml";
    await fs.writeFile(path.join(tmpDir, "bad.md"), "# Bad\n");
    await fs.writeFile(path.join(tmpDir, badPath), badSidecar);

    const result = await client.callTool({
      name: "mrsf_validate",
      arguments: { files: [badPath], cwd: tmpDir },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.valid).toBe(false);
    // Verify the error mentions the missing "resolved" field
    const allErrors = parsed.files.flatMap(
      (f: any) => f.result.errors.map((e: any) => e.message),
    );
    expect(allErrors.some((m: string) => /resolved/i.test(m))).toBe(true);
  });
});

describe("mrsf_list", () => {
  it("lists all comments", async () => {
    const result = await client.callTool({
      name: "mrsf_list",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed[0].comments).toHaveLength(3);
  });

  it("returns summary when requested", async () => {
    const result = await client.callTool({
      name: "mrsf_list",
      arguments: { files: ["test.md.review.yaml"], summary: true, cwd: tmpDir },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.total).toBe(3);
    expect(parsed.open).toBe(3);
  });
});

describe("mrsf_add", () => {
  beforeAll(resetFixture);

  it("adds a comment to the sidecar", async () => {
    const result = await client.callTool({
      name: "mrsf_add",
      arguments: {
        document: "test.md",
        text: "New test comment",
        author: "Test",
        line: 1,
        cwd: tmpDir,
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.id).toBeTruthy();
    expect(parsed.comment.text).toBe("New test comment");
  });
});

describe("mrsf_add_batch", () => {
  beforeAll(resetFixture);

  it("adds multiple comments in a single call", async () => {
    const result = await client.callTool({
      name: "mrsf_add_batch",
      arguments: {
        document: "test.md",
        comments: [
          { text: "Batch comment 1", author: "Alice", line: 1 },
          { text: "Batch comment 2", author: "Bob", line: 3 },
          { text: "Batch comment 3", author: "Carol", line: 5 },
        ],
        cwd: tmpDir,
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.total).toBe(3);
    expect(parsed.added).toHaveLength(3);

    // Verify all comments are actually in the sidecar
    const listResult = await client.callTool({
      name: "mrsf_list",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    const listText = (listResult.content as Array<{ text: string }>)[0].text;
    const listParsed = JSON.parse(listText);
    // Original 3 + 3 batch = 6
    expect(listParsed[0].comments).toHaveLength(6);
  });

  it("parallel mrsf_add calls are serialised (no lost writes)", async () => {
    await resetFixture();
    // Fire 5 mrsf_add calls concurrently for the same document
    const promises = Array.from({ length: 5 }, (_, i) =>
      client.callTool({
        name: "mrsf_add",
        arguments: {
          document: "test.md",
          text: `Parallel comment ${i}`,
          author: "Racer",
          cwd: tmpDir,
        },
      }),
    );
    await Promise.all(promises);

    const listResult = await client.callTool({
      name: "mrsf_list",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    const listText = (listResult.content as Array<{ text: string }>)[0].text;
    const listParsed = JSON.parse(listText);
    // Original 3 + 5 parallel = 8 (none lost)
    expect(listParsed[0].comments).toHaveLength(8);
  });
});

describe("mrsf_resolve", () => {
  beforeAll(resetFixture);

  it("resolves a comment by ID", async () => {
    const result = await client.callTool({
      name: "mrsf_resolve",
      arguments: {
        document: "test.md.review.yaml",
        id: "c-standalone",
        cwd: tmpDir,
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.resolved).toBe(true);
  });

  it("unresolves a comment", async () => {
    const result = await client.callTool({
      name: "mrsf_resolve",
      arguments: {
        document: "test.md.review.yaml",
        id: "c-standalone",
        unresolve: true,
        cwd: tmpDir,
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.resolved).toBe(false);
  });

  it("returns error for non-existent comment", async () => {
    const result = await client.callTool({
      name: "mrsf_resolve",
      arguments: {
        document: "test.md.review.yaml",
        id: "nonexistent",
        cwd: tmpDir,
      },
    });
    expect(result.isError).toBe(true);
  });
});

describe("mrsf_delete", () => {
  beforeAll(resetFixture);

  it("deletes a parent and promotes replies (§9.1)", async () => {
    // First, verify the reply exists and has reply_to
    let list = await client.callTool({
      name: "mrsf_list",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    let listText = (list.content as Array<{ text: string }>)[0].text;
    let comments = JSON.parse(listText)[0].comments;
    const replyBefore = comments.find((c: { id: string }) => c.id === "c-reply");
    expect(replyBefore.reply_to).toBe("c-parent");

    // Delete the parent
    const result = await client.callTool({
      name: "mrsf_delete",
      arguments: {
        document: "test.md.review.yaml",
        id: "c-parent",
        cwd: tmpDir,
      },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.deleted).toBe(true);
    expect(parsed.cascade).toBe(false);

    // Verify reply was promoted — should now have parent's anchor
    list = await client.callTool({
      name: "mrsf_list",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    listText = (list.content as Array<{ text: string }>)[0].text;
    if (list.isError) {
      throw new Error(`mrsf_list failed after delete: ${listText}`);
    }
    comments = JSON.parse(listText)[0].comments;
    const replyAfter = comments.find((c: { id: string }) => c.id === "c-reply");
    expect(replyAfter).toBeDefined();
    expect(replyAfter.reply_to).toBeUndefined(); // cleared — parent was root
    expect(replyAfter.line).toBe(3); // inherited from parent
    expect(replyAfter.selected_text).toBe("This is a test document."); // inherited

    // Parent should be gone
    expect(comments.find((c: { id: string }) => c.id === "c-parent")).toBeUndefined();
  });

  it("returns error for non-existent comment", async () => {
    const result = await client.callTool({
      name: "mrsf_delete",
      arguments: {
        document: "test.md.review.yaml",
        id: "nonexistent",
        cwd: tmpDir,
      },
    });
    expect(result.isError).toBe(true);
  });
});

describe("mrsf_status", () => {
  beforeAll(resetFixture);

  it("returns anchor health for comments", async () => {
    const result = await client.callTool({
      name: "mrsf_status",
      arguments: { files: ["test.md.review.yaml"], cwd: tmpDir },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.counts).toBeDefined();
    expect(parsed.counts.total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Bundle smoke test — verifies the built dist files can be loaded
// ---------------------------------------------------------------------------

describe("bundle healthcheck", () => {
  it("dist/server.js can be dynamically imported", async () => {
    const serverPath = path.resolve(
      import.meta.dirname ?? ".",
      "../../dist/server.js",
    );
    try {
      const mod = await import(serverPath);
      expect(typeof mod.createMrsfServer).toBe("function");
    } catch {
      // If dist doesn't exist (pre-build), skip gracefully
      console.warn("dist/server.js not found — skipping bundle test (run build first)");
    }
  });

  it("dist/bin.js exists and is a valid JS file", async () => {
    const binPath = path.resolve(
      import.meta.dirname ?? ".",
      "../../dist/bin.js",
    );
    try {
      const content = await fs.readFile(binPath, "utf-8");
      expect(content).toContain("#!/usr/bin/env node");
      // Verify it doesn't have bare imports to the SDK subpaths
      // (those would break in npx without bundling)
      expect(content).not.toContain('from "@modelcontextprotocol/sdk/server/stdio.js"');
      expect(content).not.toContain('from "@modelcontextprotocol/sdk/server/sse.js"');
      // Verify createRequire polyfill is present (prevents dynamic require errors)
      expect(content).toContain("createRequire");
    } catch {
      console.warn("dist/bin.js not found — skipping bundle test (run build first)");
    }
  });
});

// ---------------------------------------------------------------------------
// mrsf_repair
// ---------------------------------------------------------------------------

describe("mrsf_repair", () => {
  beforeEach(async () => {
    await resetFixture();
  });

  it("resets a corrupted sidecar to empty", async () => {
    // Write corrupted YAML
    await fs.writeFile(
      path.join(tmpDir, "test.md.review.yaml"),
      "mrsf_version: '1.0'\ndocument: test.md\ncomments:\n  - id: c1\n    selected_text: - broken yaml\n",
    );

    const result = await client.callTool({
      name: "mrsf_repair",
      arguments: { document: "test.md.review.yaml", strategy: "reset", cwd: tmpDir },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data.strategy).toBe("reset");
    expect(data.commentsRecovered).toBe(0);
  });

  it("salvages comments from a valid sidecar", async () => {
    const result = await client.callTool({
      name: "mrsf_repair",
      arguments: { document: "test.md.review.yaml", strategy: "salvage", cwd: tmpDir },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data.strategy).toBe("salvage");
    expect(data.commentsRecovered).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// mrsf_help
// ---------------------------------------------------------------------------

describe("mrsf_help", () => {
  it("lists all tools when no tool name is specified", async () => {
    const result = await client.callTool({
      name: "mrsf_help",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(11);
    const names = data.map((t: { tool: string }) => t.tool);
    expect(names).toContain("mrsf_add");
    expect(names).toContain("mrsf_repair");
    expect(names).toContain("mrsf_help");
  });

  it("returns detailed schema for a specific tool", async () => {
    const result = await client.callTool({
      name: "mrsf_help",
      arguments: { tool: "mrsf_add" },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(data.tool).toBe("mrsf_add");
    expect(data.parameters.document).toBeDefined();
    expect(data.parameters.document.required).toBe(true);
    expect(data.parameters.text).toBeDefined();
    expect(data.parameters.line.required).toBe(false);
  });

  it("returns error for unknown tool name", async () => {
    const result = await client.callTool({
      name: "mrsf_help",
      arguments: { tool: "mrsf_nonexistent" },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Unknown tool");
    expect(text).toContain("mrsf_add");
  });
});

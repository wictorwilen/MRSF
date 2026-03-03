#!/usr/bin/env node

/**
 * @mrsf/mcp — CLI entry-point.
 *
 * Starts the MRSF MCP server with either stdio (default) or SSE transport.
 *
 * Usage:
 *   mrsf-mcp                      # stdio transport (Claude Desktop / Cursor)
 *   mrsf-mcp --transport sse      # SSE transport on --port 3001
 *   mrsf-mcp --transport sse --port 8080
 */

import { createMrsfServer } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "node:http";

// ── Arg parsing ──────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const transport = getArg("transport") ?? "stdio";
const port = parseInt(getArg("port") ?? "3001", 10);

// ── Launch ───────────────────────────────────────────────────────────
const server = createMrsfServer();

if (transport === "stdio") {
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
} else if (transport === "sse") {
  // SSE transport over HTTP
  let sseTransport: SSEServerTransport | null = null;

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/sse") {
      sseTransport = new SSEServerTransport("/messages", res);
      await server.connect(sseTransport);
    } else if (url.pathname === "/messages" && req.method === "POST") {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.writeHead(503);
        res.end("Server not connected");
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  httpServer.listen(port, () => {
    console.error(`MRSF MCP server (SSE) listening on http://localhost:${port}/sse`);
  });
} else {
  console.error(`Unknown transport: ${transport}. Use 'stdio' or 'sse'.`);
  process.exit(1);
}

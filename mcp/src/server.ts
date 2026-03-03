/**
 * MRSF MCP Server — Model Context Protocol server for
 * the Markdown Review Sidecar Format.
 *
 * Exposes MRSF operations as MCP tools and resources so that
 * AI agents can discover, read, validate, and manage review
 * sidecars through the standard protocol.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";

import {
  // Discovery
  discoverSidecar,
  sidecarToDocument,
  discoverAllSidecars,
  findWorkspaceRoot,
  resolveSidecarPaths,

  // Parsing & writing
  parseSidecar,
  readDocumentLines,
  writeSidecar,
  computeHash,
  toYaml,

  // Validation
  validate,

  // Re-anchoring
  reanchorDocument,
  applyReanchorResults,
  reanchorFile,

  // Comments
  addComment,
  populateSelectedText,
  resolveComment,
  unresolveComment,
  filterComments,
  summarize,

  // Git
  findRepoRoot,
  getCurrentCommit,
  isStale,
  isGitAvailable,

  // Fuzzy
  exactMatch,
} from "@mrsf/cli";

import type {
  MrsfDocument,
  Comment,
  StatusResult,
  AnchorHealth,
  ValidationResult,
  ReanchorResult,
  AddCommentOptions,
} from "@mrsf/cli";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMrsfServer(): McpServer {
  const server = new McpServer({
    name: "mrsf",
    version: "0.1.0",
  }, {
    capabilities: {
      tools: {},
      resources: {},
      logging: {},
    },
  });

  registerTools(server);
  registerResources(server);

  return server;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function registerTools(server: McpServer): void {
  // ── mrsf_discover ───────────────────────────────────────────────────
  server.registerTool(
    "mrsf_discover",
    {
      title: "Discover Sidecar",
      description:
        "Find the MRSF sidecar file for a given Markdown document. " +
        "Returns the absolute path to the sidecar, or an error if none exists.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document"),
        cwd: z.string().optional().describe("Working directory (defaults to process.cwd())"),
      },
    },
    async ({ document, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const docPath = path.resolve(workDir, document);
        const root = await findWorkspaceRoot(workDir);
        const sidecarPath = await discoverSidecar(docPath, { cwd: root ?? workDir });

        // Check if sidecar actually exists
        await fs.access(sidecarPath);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ sidecarPath, documentPath: docPath }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `No sidecar found: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_validate ──────────────────────────────────────────────────
  server.registerTool(
    "mrsf_validate",
    {
      title: "Validate Sidecars",
      description:
        "Validate one or more MRSF sidecar files against the schema and " +
        "specification rules. Returns validation diagnostics.",
      inputSchema: {
        files: z.array(z.string()).optional().describe(
          "Sidecar or Markdown file paths. If omitted, discovers all sidecars in the workspace.",
        ),
        strict: z.boolean().optional().describe("Treat warnings as errors"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ files, strict, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const sidecarPaths = await resolveSidecarPaths(files ?? [], workDir);

        const results: Array<{ file: string; result: ValidationResult }> = [];

        for (const sp of sidecarPaths) {
          const doc = await parseSidecar(sp);
          const result = await validate(doc, { strict });
          results.push({ file: sp, result });
        }

        const allValid = results.every((r) => r.result.valid);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ valid: allValid, files: results }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Validation failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_reanchor ─────────────────────────────────────────────────
  server.registerTool(
    "mrsf_reanchor",
    {
      title: "Re-anchor Comments",
      description:
        "Re-anchor comments in MRSF sidecar files after the document has been " +
        "edited. Updates line numbers and populates anchored_text when the text " +
        "at the new position differs from selected_text.",
      inputSchema: {
        files: z.array(z.string()).optional().describe(
          "Sidecar or Markdown file paths. If omitted, discovers all sidecars.",
        ),
        dryRun: z.boolean().optional().describe("Report without modifying files"),
        threshold: z.number().min(0).max(1).optional().describe("Fuzzy match threshold 0.0–1.0 (default 0.6)"),
        updateText: z.boolean().optional().describe("Also replace selected_text with current document text (opt-in per §6.2)"),
        force: z.boolean().optional().describe("Firmly anchor high-confidence results: update commit to HEAD and clear audit fields"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ files, dryRun, threshold, updateText, force, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const sidecarPaths = await resolveSidecarPaths(files ?? [], workDir);

        const allResults: Array<{ file: string; results: ReanchorResult[]; changed: number }> = [];

        for (const sp of sidecarPaths) {
          const { results, changed } = await reanchorFile(sp, {
            dryRun,
            threshold,
            updateText,
            force,
            cwd: workDir,
          });
          allResults.push({ file: sp, results, changed });
        }

        const totalChanged = allResults.reduce((sum, r) => sum + r.changed, 0);
        const totalOrphaned = allResults.reduce(
          (sum, r) => sum + r.results.filter((x) => x.status === "orphaned").length, 0,
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalChanged,
              totalOrphaned,
              dryRun: dryRun ?? false,
              files: allResults,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Re-anchor failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_add ──────────────────────────────────────────────────────
  server.registerTool(
    "mrsf_add",
    {
      title: "Add Comment",
      description:
        "Add a review comment to an MRSF sidecar file. Creates the sidecar " +
        "if it does not exist. Automatically populates selected_text from the " +
        "document and the current git commit.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document"),
        text: z.string().describe("Comment text"),
        author: z.string().describe("Author identifier (e.g. 'Name (handle)')"),
        line: z.number().int().min(1).optional().describe("Starting line number (1-based)"),
        end_line: z.number().int().min(1).optional().describe("Ending line number (inclusive)"),
        start_column: z.number().int().min(0).optional().describe("Starting column (0-based)"),
        end_column: z.number().int().min(0).optional().describe("Ending column"),
        type: z.string().optional().describe("Comment type: suggestion, issue, question, accuracy, style, clarity"),
        severity: z.enum(["low", "medium", "high"]).optional().describe("Severity level"),
        reply_to: z.string().optional().describe("Parent comment ID for threading"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, text, author, line, end_line, start_column, end_column, type, severity, reply_to, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const docPath = path.resolve(workDir, document);
        const root = await findWorkspaceRoot(workDir);
        const sidecarPath = await discoverSidecar(docPath, { cwd: root ?? workDir });

        // Parse existing or create new sidecar
        let doc: MrsfDocument;
        try {
          doc = await parseSidecar(sidecarPath);
        } catch {
          const relDoc = path.relative(root ?? workDir, docPath);
          doc = {
            mrsf_version: "1.0",
            document: relDoc,
            comments: [],
          };
        }

        const repoRoot = await findRepoRoot(workDir);

        const comment = await addComment(doc, {
          text,
          author,
          line,
          end_line,
          start_column,
          end_column,
          type,
          severity,
          reply_to,
        }, repoRoot ?? undefined);

        // Populate selected_text from document content
        if (comment.line != null) {
          try {
            const lines = (await fs.readFile(docPath, "utf-8")).split("\n");
            populateSelectedText(comment, lines);
          } catch {
            // Document not readable — skip text population
          }
        }

        await writeSidecar(sidecarPath, doc);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: comment.id,
              sidecarPath,
              comment,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to add comment: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_resolve ──────────────────────────────────────────────────
  server.registerTool(
    "mrsf_resolve",
    {
      title: "Resolve/Unresolve Comment",
      description:
        "Resolve or unresolve a comment by ID in an MRSF sidecar file.",
      inputSchema: {
        sidecar: z.string().describe("Path to the sidecar file or its Markdown document"),
        id: z.string().describe("Comment ID to resolve/unresolve"),
        unresolve: z.boolean().optional().describe("Set to true to unresolve instead"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ sidecar, id, unresolve, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const [sp] = await resolveSidecarPaths([sidecar], workDir);
        const doc = await parseSidecar(sp);

        const ok = unresolve
          ? unresolveComment(doc, id)
          : resolveComment(doc, id);

        if (!ok) {
          return {
            content: [{ type: "text", text: `Comment '${id}' not found.` }],
            isError: true,
          };
        }

        await writeSidecar(sp, doc);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id,
              resolved: !unresolve,
              sidecarPath: sp,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Resolve failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_list ─────────────────────────────────────────────────────
  server.registerTool(
    "mrsf_list",
    {
      title: "List Comments",
      description:
        "List and filter review comments across one or more MRSF sidecar files. " +
        "Supports filtering by status, author, type, and severity.",
      inputSchema: {
        files: z.array(z.string()).optional().describe(
          "Sidecar or Markdown file paths. If omitted, discovers all sidecars.",
        ),
        open: z.boolean().optional().describe("Only show unresolved comments"),
        resolved: z.boolean().optional().describe("Only show resolved comments"),
        author: z.string().optional().describe("Filter by author"),
        type: z.string().optional().describe("Filter by type"),
        severity: z.enum(["low", "medium", "high"]).optional().describe("Filter by severity"),
        summary: z.boolean().optional().describe("Return summary statistics instead of full comments"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ files, open, resolved, author, type: commentType, severity, summary: wantSummary, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const sidecarPaths = await resolveSidecarPaths(files ?? [], workDir);

        const allComments: Array<{ file: string; comments: Comment[] }> = [];

        for (const sp of sidecarPaths) {
          const doc = await parseSidecar(sp);
          let comments = doc.comments;

          const hasFilter = open != null || resolved != null || author || commentType || severity;
          if (hasFilter) {
            comments = filterComments(comments, {
              open,
              resolved,
              author,
              type: commentType,
              severity,
            });
          }

          allComments.push({ file: sp, comments });
        }

        if (wantSummary) {
          const flat = allComments.flatMap((f) => f.comments);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(summarize(flat), null, 2),
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(allComments, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `List failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_status ───────────────────────────────────────────────────
  server.registerTool(
    "mrsf_status",
    {
      title: "Anchor Status",
      description:
        "Check the anchor health of all comments in one or more sidecar files. " +
        "Reports whether each comment is fresh, stale, or orphaned.",
      inputSchema: {
        files: z.array(z.string()).optional().describe(
          "Sidecar or Markdown file paths. If omitted, discovers all sidecars.",
        ),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ files, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const sidecarPaths = await resolveSidecarPaths(files ?? [], workDir);
        const repoRoot = await findRepoRoot(workDir);

        const allResults: StatusResult[] = [];

        for (const sp of sidecarPaths) {
          const doc = await parseSidecar(sp);
          const docPath = sidecarToDocument(sp);
          let lines: string[];
          try {
            lines = await readDocumentLines(docPath);
          } catch {
            for (const c of doc.comments) {
              allResults.push({
                commentId: c.id,
                health: "unknown",
                reason: "Document file not found.",
              });
            }
            continue;
          }

          for (const c of doc.comments) {
            const result = await assessHealth(c, lines, repoRoot);
            allResults.push(result);
          }
        }

        const counts = {
          total: allResults.length,
          fresh: allResults.filter((r) => r.health === "fresh").length,
          stale: allResults.filter((r) => r.health === "stale").length,
          orphaned: allResults.filter((r) => r.health === "orphaned").length,
          unknown: allResults.filter((r) => r.health === "unknown").length,
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ counts, results: allResults }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Status failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_rename ───────────────────────────────────────────────────
  server.registerTool(
    "mrsf_rename",
    {
      title: "Rename Document",
      description:
        "Update a sidecar after its Markdown document has been renamed or moved. " +
        "Moves the sidecar file and updates the document reference inside it.",
      inputSchema: {
        oldDocument: z.string().describe("Old path to the Markdown document"),
        newDocument: z.string().describe("New path to the Markdown document"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ oldDocument, newDocument, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const oldDocPath = path.resolve(workDir, oldDocument);
        const newDocPath = path.resolve(workDir, newDocument);
        const root = await findWorkspaceRoot(workDir);
        const effectiveRoot = root ?? workDir;

        const oldSidecarPath = await discoverSidecar(oldDocPath, { cwd: effectiveRoot });
        const doc = await parseSidecar(oldSidecarPath);

        doc.document = path.basename(newDocPath);

        const newSidecarPath = await discoverSidecar(newDocPath, { cwd: effectiveRoot });
        await fs.mkdir(path.dirname(newSidecarPath), { recursive: true });
        await writeSidecar(newSidecarPath, doc);

        if (oldSidecarPath !== newSidecarPath) {
          try { await fs.unlink(oldSidecarPath); } catch { /* already gone */ }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              oldSidecar: oldSidecarPath,
              newSidecar: newSidecarPath,
              document: doc.document,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Rename failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function registerResources(server: McpServer): void {
  // ── mrsf://sidecar/{path} ─────────────────────────────────────────
  server.registerResource(
    "sidecar",
    new ResourceTemplate("mrsf://sidecar/{+path}", { list: undefined }),
    {
      title: "MRSF Sidecar",
      description: "Full parsed MRSF sidecar document as JSON",
      mimeType: "application/json",
    },
    async (uri, { path: filePath }) => {
      const p = typeof filePath === "string" ? filePath : filePath[0];
      const resolved = path.resolve(process.cwd(), p);
      const doc = await parseSidecar(resolved);
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(doc, null, 2),
        }],
      };
    },
  );

  // ── mrsf://comment/{path}/{id} ────────────────────────────────────
  server.registerResource(
    "comment",
    new ResourceTemplate("mrsf://comment/{+path}/{id}", { list: undefined }),
    {
      title: "MRSF Comment",
      description: "A single review comment from a sidecar file",
      mimeType: "application/json",
    },
    async (uri, { path: filePath, id }) => {
      const p = typeof filePath === "string" ? filePath : filePath[0];
      const commentId = typeof id === "string" ? id : id[0];
      const resolved = path.resolve(process.cwd(), p);
      const doc = await parseSidecar(resolved);
      const comment = doc.comments.find((c) => c.id === commentId);
      if (!comment) {
        throw new Error(`Comment '${commentId}' not found in ${p}`);
      }
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(comment, null, 2),
        }],
      };
    },
  );

  // ── mrsf://anchors/{path} ─────────────────────────────────────────
  server.registerResource(
    "anchors",
    new ResourceTemplate("mrsf://anchors/{+path}", { list: undefined }),
    {
      title: "MRSF Anchor Health",
      description: "All comments for a document with their anchor health status",
      mimeType: "application/json",
    },
    async (uri, { path: filePath }) => {
      const p = typeof filePath === "string" ? filePath : filePath[0];
      const resolved = path.resolve(process.cwd(), p);

      // Resolve: if given a .md path, find its sidecar
      let sidecarPath: string;
      if (resolved.endsWith(".review.yaml")) {
        sidecarPath = resolved;
      } else {
        const root = await findWorkspaceRoot(process.cwd());
        sidecarPath = await discoverSidecar(resolved, { cwd: root ?? process.cwd() });
      }

      const doc = await parseSidecar(sidecarPath);
      const docPath = sidecarToDocument(sidecarPath);
      const repoRoot = await findRepoRoot(process.cwd());

      let lines: string[];
      try {
        lines = await readDocumentLines(docPath);
      } catch {
        const results = doc.comments.map((c) => ({
          commentId: c.id,
          health: "unknown" as AnchorHealth,
          reason: "Document file not found.",
        }));
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify(results, null, 2),
          }],
        };
      }

      const results: StatusResult[] = [];
      for (const c of doc.comments) {
        results.push(await assessHealth(c, lines, repoRoot));
      }

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(results, null, 2),
        }],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function assessHealth(
  comment: Comment,
  lines: string[],
  repoRoot: string | null,
): Promise<StatusResult> {
  if (comment.x_reanchor_status === "orphaned") {
    return {
      commentId: comment.id,
      health: "orphaned",
      reason: "Marked orphaned by previous re-anchor.",
    };
  }

  if (comment.selected_text) {
    const matches = exactMatch(lines, comment.selected_text);
    if (matches.length === 0) {
      if (comment.commit && repoRoot) {
        const stale = await isStale(comment.commit, repoRoot);
        if (stale) {
          return {
            commentId: comment.id,
            health: "stale",
            reason: "Commit differs from HEAD and text not found. Run reanchor.",
          };
        }
      }
      return {
        commentId: comment.id,
        health: "orphaned",
        reason: "Selected text not found in current document.",
      };
    }

    if (comment.commit && repoRoot) {
      const stale = await isStale(comment.commit, repoRoot);
      if (stale) {
        return {
          commentId: comment.id,
          health: "stale",
          reason: "Text still matches but commit is behind HEAD.",
        };
      }
    }

    return {
      commentId: comment.id,
      health: "fresh",
      reason: "Text matches in current document.",
    };
  }

  if (!comment.commit) {
    return {
      commentId: comment.id,
      health: "unknown",
      reason: "No selected_text or commit to assess.",
    };
  }

  if (repoRoot) {
    const stale = await isStale(comment.commit, repoRoot);
    return {
      commentId: comment.id,
      health: stale ? "stale" : "fresh",
      reason: stale
        ? "Commit is behind HEAD (no text to verify)."
        : "Commit matches HEAD.",
    };
  }

  return {
    commentId: comment.id,
    health: "unknown",
    reason: "Git not available for commit check.",
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { McpServer };

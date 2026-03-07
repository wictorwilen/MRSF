/**
 * Sidemark (MRSF) MCP Server — Model Context Protocol server for
 * the Markdown Review Sidecar Format.
 *
 * Exposes Sidemark (MRSF) operations as MCP tools and resources so
 * that AI agents can discover, read, validate, and manage review
 * sidecars through the standard protocol.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";

/** Injected by esbuild at build time from package.json "version". */
declare const PKG_VERSION: string;

import {
  // Discovery
  discoverSidecar,
  sidecarToDocument,
  discoverAllSidecars,
  findWorkspaceRoot,
  resolveSidecarPaths,

  // Parsing & writing
  parseSidecar,
  parseSidecarLenient,
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
  normalizeCommentExtensions,
  populateSelectedText,
  resolveComment,
  unresolveComment,
  removeComment,
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
  RemoveCommentOptions,
} from "@mrsf/cli";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMrsfServer(): McpServer {
  const server = new McpServer({
    name: "sidemark-mrsf",
    version: typeof PKG_VERSION !== "undefined" ? PKG_VERSION : "0.0.0",
    description: "MCP server exposing tools for managing Markdown Review Sidecar Format (MRSF)/Sidemark files",
    websiteUrl: "https://sidemark.org",
    title: "Sidemark (MRSF) MCP Server",
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
// Per-file mutex — serialises concurrent writes to the same sidecar
// ---------------------------------------------------------------------------

const _fileLocks = new Map<string, Promise<void>>();

const commentExtensionsInputSchema = z.record(
  z.string().regex(/^x_/u, "Extension keys must start with x_."),
  z.unknown(),
).describe("Tool-specific extension fields keyed by x_*");

const addCommentInputSchema = {
  text: z.string().describe("Comment text"),
  author: z.string().describe("Author identifier (e.g. 'Name (handle)')"),
  line: z.number().int().min(1).optional().describe("Starting line number (1-based)"),
  end_line: z.number().int().min(1).optional().describe("Ending line number (inclusive)"),
  start_column: z.number().int().min(0).optional().describe("Starting column (0-based)"),
  end_column: z.number().int().min(0).optional().describe("Ending column"),
  type: z.string().optional().describe("Comment type: suggestion, issue, question, accuracy, style, clarity"),
  severity: z.enum(["low", "medium", "high"]).optional().describe("Severity level"),
  reply_to: z.string().optional().describe("Parent comment ID for threading"),
  extensions: commentExtensionsInputSchema.optional(),
} as const;

/**
 * Run `fn` while holding an exclusive lock for `filePath`.
 * Concurrent callers targeting the same path are queued in order.
 */
async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  // Wait for any pending operation on this file
  const prev = _fileLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  _fileLocks.set(key, gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Clean up if no new waiter replaced us
    if (_fileLocks.get(key) === gate) _fileLocks.delete(key);
  }
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
        "Find the Sidemark (MRSF) sidecar for a given Markdown document. " +
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
        "Validate one or more Sidemark (MRSF) sidecars against the schema and " +
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
        "Re-anchor comments in Sidemark (MRSF) sidecars after the document has been " +
        "edited. Updates line numbers and populates anchored_text when the text " +
        "at the new position differs from selected_text.",
      inputSchema: {
        files: z.array(z.string()).optional().describe(
          "Sidecar or Markdown file paths. If omitted, discovers all sidecars.",
        ),
        dryRun: z.boolean().optional().describe("Report without modifying files"),
        threshold: z.number().min(0).max(1).optional().describe("Fuzzy match threshold 0.0–1.0 (default 0.6)"),
        updateText: z.boolean().optional().describe("Also replace selected_text with current document text"),
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
          const { results, changed } = await withFileLock(sp, () => reanchorFile(sp, {
            dryRun,
            threshold,
            updateText,
            force,
            cwd: workDir,
          }));
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
        "Add a review comment to a Sidemark (MRSF) sidecar. Creates the sidecar " +
        "if it does not exist. Automatically populates selected_text from the " +
        "document and the current git commit.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document"),
        ...addCommentInputSchema,
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, text, author, line, end_line, start_column, end_column, type, severity, reply_to, extensions, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const docPath = path.resolve(workDir, document);
        const root = await findWorkspaceRoot(workDir);
        const sidecarPath = await discoverSidecar(docPath, { cwd: root ?? workDir });

        return await withFileLock(sidecarPath, async () => {
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
          extensions: normalizeCommentExtensions(extensions),
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
              line: comment.line ?? null,
              end_line: comment.end_line ?? null,
              status: "added",
              sidecarPath,
            }, null, 2),
          }],
        };
        }); // withFileLock
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to add comment: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_add_batch ────────────────────────────────────────────────
  server.registerTool(
    "mrsf_add_batch",
    {
      title: "Add Multiple Comments",
      description:
        "Add multiple review comments to a Sidemark (MRSF) sidecar in a single " +
        "atomic operation. Prefer this over calling mrsf_add multiple times to " +
        "avoid race conditions when adding comments in parallel.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document"),
        comments: z.array(z.object(addCommentInputSchema)).describe("Array of comments to add"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, comments, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const docPath = path.resolve(workDir, document);
        const root = await findWorkspaceRoot(workDir);
        const sidecarPath = await discoverSidecar(docPath, { cwd: root ?? workDir });

        return await withFileLock(sidecarPath, async () => {
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

        // Read document lines once for populating selected_text
        let docLines: string[] | null = null;
        try {
          docLines = (await fs.readFile(docPath, "utf-8")).split("\n");
        } catch {
          // Document not readable — skip text population
        }

        const added: Comment[] = [];
        for (const c of comments) {
          const comment = await addComment(doc, {
            text: c.text,
            author: c.author,
            line: c.line,
            end_line: c.end_line,
            start_column: c.start_column,
            end_column: c.end_column,
            type: c.type,
            severity: c.severity,
            reply_to: c.reply_to,
            extensions: normalizeCommentExtensions(c.extensions),
          }, repoRoot ?? undefined);

          if (comment.line != null && docLines) {
            populateSelectedText(comment, docLines);
          }
          added.push(comment);
        }

        await writeSidecar(sidecarPath, doc);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sidecarPath,
              added: added.map((c) => ({ id: c.id, line: c.line, end_line: c.end_line })),
              total: added.length,
            }, null, 2),
          }],
        };
        }); // withFileLock
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to add comments: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_update ───────────────────────────────────────────────────
  server.registerTool(
    "mrsf_update",
    {
      title: "Update Comment",
      description:
        "Update fields of an existing comment by ID. Only the supplied fields " +
        "are changed; omitted fields are left as-is.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document or its sidecar"),
        id: z.string().describe("Comment ID to update"),
        text: z.string().optional().describe("New comment text"),
        type: z.string().optional().describe("New type: suggestion, issue, question, accuracy, style, clarity"),
        severity: z.enum(["low", "medium", "high"]).optional().describe("New severity level"),
        line: z.number().int().min(1).optional().describe("New starting line number (1-based)"),
        end_line: z.number().int().min(1).optional().describe("New ending line number (inclusive)"),
        start_column: z.number().int().min(0).optional().describe("New starting column (0-based)"),
        end_column: z.number().int().min(0).optional().describe("New ending column"),
        extensions: commentExtensionsInputSchema.optional(),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, id, text, type: commentType, severity, line, end_line, start_column, end_column, extensions, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const [sp] = await resolveSidecarPaths([document], workDir);

        return await withFileLock(sp, async () => {
        const doc = await parseSidecar(sp);
        const comment = doc.comments.find((c) => c.id === id);

        if (!comment) {
          return {
            content: [{ type: "text", text: `Comment '${id}' not found.` }],
            isError: true,
          };
        }

        const updated: string[] = [];
        if (text !== undefined) { comment.text = text; updated.push("text"); }
        if (commentType !== undefined) { comment.type = commentType; updated.push("type"); }
        if (severity !== undefined) { comment.severity = severity; updated.push("severity"); }
        if (line !== undefined) { comment.line = line; updated.push("line"); }
        if (end_line !== undefined) { comment.end_line = end_line; updated.push("end_line"); }
        if (start_column !== undefined) { comment.start_column = start_column; updated.push("start_column"); }
        if (end_column !== undefined) { comment.end_column = end_column; updated.push("end_column"); }
        if (extensions !== undefined) {
          const normalizedExtensions = normalizeCommentExtensions(extensions);
          Object.assign(comment, normalizedExtensions);
          updated.push(...Object.keys(normalizedExtensions));
        }

        // Re-populate selected_text if anchor changed
        if (comment.line != null && (updated.includes("line") || updated.includes("end_line"))) {
          try {
            const docPath = path.resolve(workDir, sidecarToDocument(sp));
            const lines = (await fs.readFile(docPath, "utf-8")).split("\n");
            populateSelectedText(comment, lines);
          } catch {
            // skip
          }
        }

        await writeSidecar(sp, doc);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id,
              updated,
              sidecarPath: sp,
            }, null, 2),
          }],
        };
        }); // withFileLock
      } catch (err) {
        return {
          content: [{ type: "text", text: `Update failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_resolve ──────────────────────────────────────────────────
  server.registerTool(
    "mrsf_resolve",
    {
      title: "Resolve/Unresolve Comments",
      description:
        "Resolve or unresolve one or more comments in a Sidemark (MRSF) sidecar. " +
        "Supply a single id, an array of ids, or use filter fields (author, type, severity) " +
        "to bulk-resolve matching comments.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document or its sidecar"),
        id: z.string().optional().describe("Single comment ID to resolve/unresolve"),
        ids: z.array(z.string()).optional().describe("Array of comment IDs to resolve/unresolve"),
        author: z.string().optional().describe("Resolve all comments by this author"),
        type: z.string().optional().describe("Resolve all comments of this type"),
        severity: z.enum(["low", "medium", "high"]).optional().describe("Resolve all comments of this severity"),
        unresolve: z.boolean().optional().describe("Set to true to unresolve instead"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, id, ids, author, type: commentType, severity, unresolve, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const [sp] = await resolveSidecarPaths([document], workDir);

        return await withFileLock(sp, async () => {
        const doc = await parseSidecar(sp);

        // Build the set of target IDs
        let targetIds: string[];
        if (id) {
          targetIds = [id];
        } else if (ids && ids.length > 0) {
          targetIds = ids;
        } else if (author || commentType || severity) {
          // Filter-based bulk resolve
          const matching = filterComments(doc.comments, { author, type: commentType, severity });
          targetIds = matching.map((c) => c.id);
        } else {
          return {
            content: [{ type: "text", text: "Provide id, ids, or a filter (author/type/severity)." }],
            isError: true,
          };
        }

        const resolved: string[] = [];
        const notFound: string[] = [];
        for (const tid of targetIds) {
          const ok = unresolve
            ? unresolveComment(doc, tid)
            : resolveComment(doc, tid);
          if (ok) resolved.push(tid);
          else notFound.push(tid);
        }

        if (resolved.length > 0) {
          await writeSidecar(sp, doc);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              resolved: !unresolve,
              changed: resolved,
              notFound: notFound.length > 0 ? notFound : undefined,
              sidecarPath: sp,
            }, null, 2),
          }],
        };
        }); // withFileLock
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
        "List and filter review comments across one or more Sidemark (MRSF) sidecars. " +
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
        format: z.enum(["full", "compact"]).optional().describe(
          "Output format: 'full' (default) returns complete JSON; 'compact' returns a scannable text table",
        ),
        summary: z.boolean().optional().describe("Return summary statistics instead of full comments"),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ files, open, resolved, author, type: commentType, severity, format, summary: wantSummary, cwd }) => {
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

        if (format === "compact") {
          const lines: string[] = [];
          for (const { file, comments } of allComments) {
            lines.push(`── ${path.basename(file)} (${comments.length}) ──`);
            for (const c of comments) {
              const ln = c.line != null ? `L${c.line}` : "  –";
              const sev = (c.severity ?? "–").padEnd(6);
              const tp = (c.type ?? "–").padEnd(10);
              const status = c.resolved ? "✓" : "○";
              const txt = c.text.length > 80 ? c.text.slice(0, 77) + "…" : c.text;
              lines.push(`  ${status} ${ln.padEnd(5)} ${sev} ${tp} ${txt}`);
            }
          }
          return {
            content: [{ type: "text", text: lines.join("\n") }],
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
        "Check the anchor health of all comments in one or more Sidemark (MRSF) sidecars. " +
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
        "Update a Sidemark (MRSF) sidecar after its Markdown document has been renamed or moved. " +
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

        return await withFileLock(oldSidecarPath, async () => {
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
        }); // withFileLock
      } catch (err) {
        return {
          content: [{ type: "text", text: `Rename failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_delete ───────────────────────────────────────────────────
  server.registerTool(
    "mrsf_delete",
    {
      title: "Delete Comment",
      description:
        "Delete a comment by ID from a Sidemark (MRSF) sidecar. By default, " +
        "direct replies are promoted: they inherit the parent's anchor and their " +
        "reply_to is re-pointed to the grandparent. Use cascade to delete " +
        "direct replies along with the parent instead.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document or its sidecar"),
        id: z.string().describe("Comment ID to delete"),
        cascade: z.boolean().optional().describe(
          "When true, also remove direct replies instead of promoting them (default: false)",
        ),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, id, cascade, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const [sp] = await resolveSidecarPaths([document], workDir);

        return await withFileLock(sp, async () => {
        const doc = await parseSidecar(sp);

        const ok = removeComment(doc, id, cascade ? { cascade: true } : undefined);

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
              deleted: true,
              cascade: cascade ?? false,
              sidecarPath: sp,
            }, null, 2),
          }],
        };
        }); // withFileLock
      } catch (err) {
        return {
          content: [{ type: "text", text: `Delete failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_repair ───────────────────────────────────────────────────
  server.registerTool(
    "mrsf_repair",
    {
      title: "Repair Sidecar",
      description:
        "Repair or reset a corrupted Sidemark (MRSF) sidecar. Use 'salvage' strategy " +
        "to attempt to recover parseable comments from a corrupted sidecar (rewrites " +
        "it cleanly). Use 'reset' strategy to delete the sidecar and start " +
        "fresh with an empty comment list.",
      inputSchema: {
        document: z.string().describe("Path to the Markdown document or its sidecar"),
        strategy: z.enum(["salvage", "reset"]).optional().describe(
          "Repair strategy: 'salvage' (default) attempts to recover comments; 'reset' starts fresh",
        ),
        cwd: z.string().optional().describe("Working directory"),
      },
    },
    async ({ document, strategy, cwd }) => {
      try {
        const workDir = cwd ?? process.cwd();
        const [sp] = await resolveSidecarPaths([document], workDir);

        return await withFileLock(sp, async () => {
        const effectiveStrategy = strategy ?? "salvage";

        if (effectiveStrategy === "reset") {
          // Infer document name from sidecar filename
          const docName = path.basename(sp).replace(/\.review\.(yaml|json)$/, "");
          const freshDoc: MrsfDocument = {
            mrsf_version: "1.0",
            document: docName,
            comments: [],
          };
          await writeSidecar(sp, freshDoc);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                strategy: "reset",
                sidecarPath: sp,
                result: "Sidecar reset to empty.",
                commentsRecovered: 0,
              }, null, 2),
            }],
          };
        }

        // Salvage strategy
        const result = await parseSidecarLenient(sp);

        if (result.doc) {
          // Rewrite cleanly (toYaml path always produces valid YAML)
          await writeSidecar(sp, result.doc);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                strategy: "salvage",
                sidecarPath: sp,
                result: result.error ?? "File was already valid.",
                commentsRecovered: result.doc.comments.length,
                commentsSkipped: result.partialComments
                  ? (result.partialComments.length < result.doc.comments.length ? 0 : undefined)
                  : undefined,
              }, null, 2),
            }],
          };
        }

        // Complete failure — reset as fallback
        const docName = path.basename(sp).replace(/\.review\.(yaml|json)$/, "");
        const freshDoc: MrsfDocument = {
          mrsf_version: "1.0",
          document: docName,
          comments: [],
        };
        await writeSidecar(sp, freshDoc);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              strategy: "salvage",
              sidecarPath: sp,
              result: `Could not salvage any comments: ${result.error}. File reset to empty.`,
              commentsRecovered: 0,
            }, null, 2),
          }],
        };
        }); // withFileLock
      } catch (err) {
        return {
          content: [{ type: "text", text: `Repair failed: ${errorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── mrsf_help ─────────────────────────────────────────────────────
  server.registerTool(
    "mrsf_help",
    {
      title: "Help / Tool Schema",
      description:
        "List all available Sidemark (MRSF) MCP tools with their parameter schemas. " +
        "Optionally filter to a specific tool for detailed parameter info. " +
        "Useful for discovering the API and understanding required/optional parameters.",
      inputSchema: {
        tool: z.string().optional().describe(
          "Tool name to get detailed help for (e.g. 'mrsf_add'). "
          + "Omit to list all tools.",
        ),
      },
    },
    async ({ tool: toolName }) => {
      const toolSchemas: Record<string, {
        description: string;
        parameters: Record<string, { type: string; required: boolean; description: string }>;
      }> = {
        mrsf_discover: {
          description: "Find the Sidemark (MRSF) sidecar for a given Markdown document.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document" },
            cwd: { type: "string", required: false, description: "Working directory (defaults to process.cwd())" },
          },
        },
        mrsf_validate: {
          description: "Validate one or more Sidemark (MRSF) sidecars against the schema.",
          parameters: {
            files: { type: "string[]", required: false, description: "Sidecar or Markdown file paths. If omitted, discovers all sidecars." },
            strict: { type: "boolean", required: false, description: "Treat warnings as errors" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_reanchor: {
          description: "Re-anchor Sidemark (MRSF) comments after the document has been edited.",
          parameters: {
            files: { type: "string[]", required: false, description: "Sidecar or Markdown file paths. If omitted, discovers all." },
            dryRun: { type: "boolean", required: false, description: "Report without modifying files" },
            threshold: { type: "number (0.0–1.0)", required: false, description: "Fuzzy match threshold (default 0.6)" },
            updateText: { type: "boolean", required: false, description: "Replace selected_text with current document text" },
            force: { type: "boolean", required: false, description: "Firmly anchor high-confidence results" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_add: {
          description: "Add a review comment to a Sidemark (MRSF) sidecar.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document" },
            text: { type: "string", required: true, description: "Comment text" },
            author: { type: "string", required: true, description: "Author identifier (e.g. 'Name (handle)')" },
            line: { type: "integer (≥ 1)", required: false, description: "Starting line number (1-based)" },
            end_line: { type: "integer (≥ 1)", required: false, description: "Ending line number (inclusive)" },
            start_column: { type: "integer (≥ 0)", required: false, description: "Starting column (0-based)" },
            end_column: { type: "integer (≥ 0)", required: false, description: "Ending column" },
            type: { type: "string", required: false, description: "Comment type: suggestion, issue, question, accuracy, style, clarity" },
            severity: { type: "enum: low | medium | high", required: false, description: "Severity level" },
            reply_to: { type: "string", required: false, description: "Parent comment ID for threading" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_add_batch: {
          description: "Add multiple review comments to a Sidemark (MRSF) sidecar in a single atomic operation.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document" },
            comments: { type: "object[]", required: true, description: "Array of comment objects, each with: text (required), author (required), line, end_line, start_column, end_column, type, severity, reply_to" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_update: {
          description: "Update fields of an existing comment by ID. Only supplied fields are changed.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document or its sidecar" },
            id: { type: "string", required: true, description: "Comment ID to update" },
            text: { type: "string", required: false, description: "New comment text" },
            type: { type: "string", required: false, description: "New type: suggestion, issue, question, accuracy, style, clarity" },
            severity: { type: "enum: low | medium | high", required: false, description: "New severity level" },
            line: { type: "integer (≥ 1)", required: false, description: "New starting line number (1-based)" },
            end_line: { type: "integer (≥ 1)", required: false, description: "New ending line number (inclusive)" },
            start_column: { type: "integer (≥ 0)", required: false, description: "New starting column (0-based)" },
            end_column: { type: "integer (≥ 0)", required: false, description: "New ending column" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_resolve: {
          description: "Resolve or unresolve one or more comments. Supply a single id, an array of ids, or use filters to bulk-resolve.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document or its sidecar" },
            id: { type: "string", required: false, description: "Single comment ID to resolve/unresolve" },
            ids: { type: "string[]", required: false, description: "Array of comment IDs to resolve/unresolve" },
            author: { type: "string", required: false, description: "Resolve all comments by this author" },
            type: { type: "string", required: false, description: "Resolve all comments of this type" },
            severity: { type: "enum: low | medium | high", required: false, description: "Resolve all comments of this severity" },
            unresolve: { type: "boolean", required: false, description: "Set to true to unresolve instead" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_list: {
          description: "List and filter review comments across Sidemark (MRSF) sidecars.",
          parameters: {
            files: { type: "string[]", required: false, description: "Sidecar or Markdown file paths. If omitted, discovers all." },
            open: { type: "boolean", required: false, description: "Only show unresolved comments" },
            resolved: { type: "boolean", required: false, description: "Only show resolved comments" },
            author: { type: "string", required: false, description: "Filter by author" },
            type: { type: "string", required: false, description: "Filter by type" },
            severity: { type: "enum: low | medium | high", required: false, description: "Filter by severity" },
            format: { type: "enum: full | compact", required: false, description: "Output format: 'full' (default) returns JSON; 'compact' returns a scannable text table" },
            summary: { type: "boolean", required: false, description: "Return summary statistics instead of full comments" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_status: {
          description: "Check the anchor health of all comments in Sidemark (MRSF) sidecars.",
          parameters: {
            files: { type: "string[]", required: false, description: "Sidecar or Markdown file paths. If omitted, discovers all." },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_rename: {
          description: "Update a Sidemark (MRSF) sidecar after its Markdown document has been renamed.",
          parameters: {
            oldDocument: { type: "string", required: true, description: "Old path to the Markdown document" },
            newDocument: { type: "string", required: true, description: "New path to the Markdown document" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_delete: {
          description: "Delete a comment by ID from a Sidemark (MRSF) sidecar.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document or its sidecar" },
            id: { type: "string", required: true, description: "Comment ID to delete" },
            cascade: { type: "boolean", required: false, description: "Also remove direct replies instead of promoting them" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_repair: {
          description: "Repair or reset a corrupted Sidemark (MRSF) sidecar.",
          parameters: {
            document: { type: "string", required: true, description: "Path to the Markdown document or its sidecar" },
            strategy: { type: "enum: salvage | reset", required: false, description: "Repair strategy: 'salvage' (default) or 'reset'" },
            cwd: { type: "string", required: false, description: "Working directory" },
          },
        },
        mrsf_help: {
          description: "List all available Sidemark (MRSF) tools with their parameter schemas.",
          parameters: {
            tool: { type: "string", required: false, description: "Tool name to get detailed help for" },
          },
        },
      };

      if (toolName) {
        const schema = toolSchemas[toolName];
        if (!schema) {
          const available = Object.keys(toolSchemas).join(", ");
          return {
            content: [{
              type: "text",
              text: `Unknown tool '${toolName}'. Available tools: ${available}`,
            }],
            isError: true,
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ tool: toolName, ...schema }, null, 2),
          }],
        };
      }

      // List all tools
      const summary = Object.entries(toolSchemas).map(([name, info]) => ({
        tool: name,
        description: info.description,
        requiredParams: Object.entries(info.parameters)
          .filter(([, p]) => p.required)
          .map(([k]) => k),
        optionalParams: Object.entries(info.parameters)
          .filter(([, p]) => !p.required)
          .map(([k]) => k),
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify(summary, null, 2),
        }],
      };
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
      title: "Sidemark (MRSF) Sidecar",
      description: "Full parsed Sidemark (MRSF) sidecar document as JSON",
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
      title: "Sidemark (MRSF) Comment",
      description: "A single review comment from a Sidemark sidecar file",
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
      title: "Sidemark (MRSF) Anchor Health",
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

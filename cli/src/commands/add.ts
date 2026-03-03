/**
 * mrsf add — Add a comment to a sidecar file.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { discoverSidecar, findWorkspaceRoot, sidecarToDocument } from "../lib/discovery.js";
import { parseSidecar, readDocumentLines } from "../lib/parser.js";
import { writeSidecar } from "../lib/writer.js";
import { addComment, populateSelectedText } from "../lib/comments.js";
import { findRepoRoot } from "../lib/git.js";
import type { MrsfDocument } from "../lib/types.js";

export function registerAdd(program: Command): void {
  program
    .command("add <document>")
    .description("Add a review comment to a document's sidecar")
    .requiredOption("-a, --author <name>", "Comment author")
    .requiredOption("-t, --text <text>", "Comment text")
    .option("-l, --line <n>", "Line number (1-based)")
    .option("--end-line <n>", "End line (inclusive)")
    .option("--start-column <n>", "Start column (0-based)")
    .option("--end-column <n>", "End column (0-based)")
    .option("--type <type>", "Comment type (e.g. suggestion, issue)")
    .option("--severity <level>", "Severity: low | medium | high")
    .option("--reply-to <id>", "Reply to an existing comment")
    .option("--selected-text <text>", "Selected text to attach")
    .action(
      async (
        document: string,
        opts: {
          author: string;
          text: string;
          line?: string;
          endLine?: string;
          startColumn?: string;
          endColumn?: string;
          type?: string;
          severity?: string;
          replyTo?: string;
          selectedText?: string;
        },
      ) => {
        const parentOpts = program.opts();
        const cwd = parentOpts.cwd ?? process.cwd();
        const quiet = parentOpts.quiet ?? false;

        const docPath = path.resolve(cwd, document);
        const root = await findWorkspaceRoot(cwd);
        const sidecarPath = await discoverSidecar(docPath, { cwd: root ?? cwd });

        // Load or create sidecar
        let doc: MrsfDocument;
        try {
          doc = await parseSidecar(sidecarPath);
        } catch {
          // Create new sidecar
          doc = {
            mrsf_version: "1.0",
            document: path.basename(docPath),
            comments: [],
          };
        }

        const repoRoot = await findRepoRoot(cwd);

        const comment = await addComment(
          doc,
          {
            author: opts.author,
            text: opts.text,
            line: opts.line ? parseInt(opts.line, 10) : undefined,
            end_line: opts.endLine ? parseInt(opts.endLine, 10) : undefined,
            start_column: opts.startColumn
              ? parseInt(opts.startColumn, 10)
              : undefined,
            end_column: opts.endColumn
              ? parseInt(opts.endColumn, 10)
              : undefined,
            type: opts.type,
            severity: opts.severity as "low" | "medium" | "high" | undefined,
            reply_to: opts.replyTo,
          },
          repoRoot ?? undefined,
        );

        // Auto-populate selected_text from the document if not provided
        if (opts.selectedText) {
          comment.selected_text = opts.selectedText;
        } else if (comment.line != null) {
          try {
            const lines = await readDocumentLines(docPath);
            populateSelectedText(comment, lines);
          } catch {
            // Document file may not exist yet, skip
          }
        }

        await writeSidecar(sidecarPath, doc);

        if (!quiet) {
          console.log(
            chalk.green(`Added comment ${comment.id}`) +
              (comment.line ? ` at line ${comment.line}` : "") +
              ` → ${sidecarPath}`,
          );
        }
      },
    );
}

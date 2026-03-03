/**
 * mrsf list — List comments in sidecar files.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { sidecarToDocument } from "../lib/discovery.js";
import { parseSidecar } from "../lib/parser.js";
import { resolveSidecarPaths } from "../lib/resolve-files.js";
import { filterComments, summarize } from "../lib/comments.js";
import type { Comment, CommentFilter } from "../lib/types.js";

export function registerList(program: Command): void {
  program
    .command("list [files...]")
    .description("List comments across sidecar files")
    .option("--open", "Show only open (unresolved) comments")
    .option("--resolved", "Show only resolved comments")
    .option("--orphaned", "Show only orphaned comments")
    .option("--author <name>", "Filter by author")
    .option("--type <type>", "Filter by type")
    .option("--severity <level>", "Filter by severity")
    .option("--summary", "Show a summary instead of individual comments")
    .option("--json", "Output as JSON")
    .action(
      async (
        files: string[],
        opts: {
          open?: boolean;
          resolved?: boolean;
          orphaned?: boolean;
          author?: string;
          type?: string;
          severity?: string;
          summary?: boolean;
          json?: boolean;
        },
      ) => {
        const parentOpts = program.opts();
        const cwd = parentOpts.cwd ?? process.cwd();

        const sidecarPaths = await resolveSidecarPaths(files, cwd);

        if (sidecarPaths.length === 0) {
          console.log("No sidecar files found.");
          return;
        }

        const filter: CommentFilter = {
          open: opts.open,
          resolved: opts.resolved,
          orphaned: opts.orphaned,
          author: opts.author,
          type: opts.type,
          severity: opts.severity as CommentFilter["severity"],
        };

        const allComments: Array<{ sidecar: string; document: string; comment: Comment }> = [];

        for (const sp of sidecarPaths) {
          try {
            const doc = await parseSidecar(sp);
            const filtered = filterComments(doc.comments, filter);
            const docPath = sidecarToDocument(sp);
            for (const c of filtered) {
              allComments.push({
                sidecar: sp,
                document: docPath,
                comment: c,
              });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`✗ ${sp}: ${msg}`));
          }
        }

        if (opts.json) {
          if (opts.summary) {
            console.log(
              JSON.stringify(
                summarize(allComments.map((a) => a.comment)),
                null,
                2,
              ),
            );
          } else {
            console.log(JSON.stringify(allComments, null, 2));
          }
          return;
        }

        if (opts.summary) {
          const s = summarize(allComments.map((a) => a.comment));
          console.log(`Total: ${s.total}  Open: ${s.open}  Resolved: ${s.resolved}  Orphaned: ${s.orphaned}  Threads: ${s.threads}`);
          if (Object.keys(s.byType).length > 0) {
            console.log(`By type: ${Object.entries(s.byType).map(([k, v]) => `${k}(${v})`).join(", ")}`);
          }
          if (Object.keys(s.bySeverity).length > 0) {
            console.log(`By severity: ${Object.entries(s.bySeverity).map(([k, v]) => `${k}(${v})`).join(", ")}`);
          }
          return;
        }

        if (allComments.length === 0) {
          console.log("No matching comments.");
          return;
        }

        for (const { document, comment: c } of allComments) {
          const status = c.resolved
            ? chalk.dim("[resolved]")
            : chalk.green("[open]");
          const loc = c.line ? `:${c.line}` : "";
          const sev = c.severity ? chalk.yellow(` [${c.severity}]`) : "";
          const typ = c.type ? chalk.cyan(` (${c.type})`) : "";

          console.log(
            `${status} ${chalk.bold(c.id)} ${document}${loc}${sev}${typ}`,
          );
          console.log(`  ${c.author}: ${c.text}`);
          if (c.reply_to) console.log(chalk.dim(`  ↳ reply to ${c.reply_to}`));
        }

        console.log(`\n${allComments.length} comment(s).`);
      },
    );
}

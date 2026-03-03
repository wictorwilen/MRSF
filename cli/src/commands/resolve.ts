/**
 * mrsf resolve — Resolve (or unresolve) a comment.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { parseSidecar } from "../lib/parser.js";
import { writeSidecar } from "../lib/writer.js";
import { resolveComment, unresolveComment } from "../lib/comments.js";

export function registerResolve(program: Command): void {
  program
    .command("resolve <sidecar> <id>")
    .description("Resolve a comment by ID")
    .option("--cascade", "Also resolve direct replies")
    .option("-u, --undo", "Unresolve instead")
    .action(
      async (
        sidecar: string,
        id: string,
        opts: { cascade?: boolean; undo?: boolean },
      ) => {
        const parentOpts = program.opts();
        const cwd = parentOpts.cwd ?? process.cwd();
        const quiet = parentOpts.quiet ?? false;
        const sp = path.resolve(cwd, sidecar);

        const doc = await parseSidecar(sp);

        const ok = opts.undo
          ? unresolveComment(doc, id)
          : resolveComment(doc, id, opts.cascade);

        if (!ok) {
          console.error(chalk.red(`Comment ${id} not found in ${sidecar}.`));
          process.exit(1);
        }

        await writeSidecar(sp, doc);

        if (!quiet) {
          const action = opts.undo ? "Unresolved" : "Resolved";
          console.log(chalk.green(`${action} ${id} in ${sidecar}.`));
        }
      },
    );
}

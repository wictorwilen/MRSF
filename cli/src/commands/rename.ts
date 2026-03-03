/**
 * mrsf rename — Update sidecar when a document is renamed.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs/promises";
import { discoverSidecar, findWorkspaceRoot } from "../lib/discovery.js";
import { parseSidecar } from "../lib/parser.js";
import { writeSidecar } from "../lib/writer.js";

export function registerRename(program: Command): void {
  program
    .command("rename <old-document> <new-document>")
    .description(
      "Update a sidecar after its document has been renamed or moved",
    )
    .action(async (oldDoc: string, newDoc: string) => {
      const parentOpts = program.opts();
      const cwd = parentOpts.cwd ?? process.cwd();
      const quiet = parentOpts.quiet ?? false;
      const verbose = parentOpts.verbose ?? false;

      const oldDocPath = path.resolve(cwd, oldDoc);
      const newDocPath = path.resolve(cwd, newDoc);
      const root = await findWorkspaceRoot(cwd);

      // Find old sidecar
      const oldSidecarPath = await discoverSidecar(oldDocPath, { cwd: root ?? cwd });
      let doc;
      try {
        doc = await parseSidecar(oldSidecarPath);
      } catch {
        console.error(
          chalk.red(`Sidecar not found for ${oldDoc} at ${oldSidecarPath}`),
        );
        process.exit(1);
      }

      // Update document reference
      doc.document = path.basename(newDocPath);

      // Compute new sidecar path
      const newSidecarPath = await discoverSidecar(newDocPath, { cwd: root ?? cwd });

      // Ensure target directory exists
      await fs.mkdir(path.dirname(newSidecarPath), { recursive: true });

      // Write new sidecar
      await writeSidecar(newSidecarPath, doc);

      // Remove old sidecar if different location
      if (oldSidecarPath !== newSidecarPath) {
        try {
          await fs.unlink(oldSidecarPath);
        } catch {
          // Already gone or inaccessible
        }
      }

      if (!quiet) {
        console.log(
          chalk.green(`Renamed: ${oldSidecarPath} → ${newSidecarPath}`),
        );
      }
      if (verbose) {
        console.log(chalk.dim(`  document: ${doc.document}`));
        console.log(chalk.dim(`  comments: ${doc.comments.length}`));
      }
    });
}

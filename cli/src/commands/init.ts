/**
 * mrsf init — Initialize a new sidecar file for a document.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs/promises";
import { discoverSidecar, findWorkspaceRoot } from "../lib/discovery.js";
import { writeSidecar } from "../lib/writer.js";
import type { MrsfDocument } from "../lib/types.js";

export function registerInit(program: Command): void {
  program
    .command("init <document>")
    .description("Create a new sidecar file for a Markdown document")
    .option("-f, --force", "Overwrite existing sidecar")
    .action(async (document: string, opts: { force?: boolean }) => {
      const parentOpts = program.opts();
      const cwd = parentOpts.cwd ?? process.cwd();
      const quiet = parentOpts.quiet ?? false;

      const docPath = path.resolve(cwd, document);

      // Verify the document exists
      try {
        await fs.access(docPath);
      } catch {
        console.error(chalk.red(`Document not found: ${docPath}`));
        process.exit(1);
      }

      const root = await findWorkspaceRoot(cwd);
      const sidecarPath = await discoverSidecar(docPath, { cwd: root ?? cwd });

      // Check if sidecar already exists
      try {
        await fs.access(sidecarPath);
        if (!opts.force) {
          console.error(
            chalk.yellow(`Sidecar already exists: ${sidecarPath}`),
          );
          console.error("Use --force to overwrite.");
          process.exit(1);
        }
      } catch {
        // Good — doesn't exist yet
      }

      const doc: MrsfDocument = {
        mrsf_version: "1.0",
        document: path.basename(docPath),
        comments: [],
      };

      await writeSidecar(sidecarPath, doc);

      if (!quiet) {
        console.log(chalk.green(`Created ${sidecarPath}`));
      }
    });
}

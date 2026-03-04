/**
 * mrsf validate — Validate one or all sidecar files.
 */

import type { Command } from "commander";
import chalk from "chalk";
import { validateFile } from "../lib/validator.js";
import { resolveSidecarPaths } from "../lib/resolve-files.js";
import type { ValidationResult } from "../lib/types.js";

export function registerValidate(program: Command): void {
  program
    .command("validate [files...]")
    .description("Validate MRSF sidecar files against the schema and spec rules")
    .option("-s, --strict", "Treat warnings as errors")
    .action(async (files: string[], opts: { strict?: boolean }) => {
      const parentOpts = program.opts();
      const cwd = parentOpts.cwd ?? process.cwd();
      const quiet = parentOpts.quiet ?? false;
      const verbose = parentOpts.verbose ?? false;

      const sidecarPaths = await resolveSidecarPaths(files, cwd);

      if (sidecarPaths.length === 0) {
        if (!quiet) console.log("No sidecar files found.");
        return;
      }

      let hasErrors = false;

      for (const sp of sidecarPaths) {
        let result: ValidationResult;
        try {
          result = await validateFile(sp);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`✗ ${sp}: ${msg}`));
          hasErrors = true;
          continue;
        }

        const effectiveValid = opts.strict
          ? result.valid && result.warnings.length === 0
          : result.valid;

        if (!effectiveValid) hasErrors = true;

        if (!quiet || !effectiveValid) {
          const icon = effectiveValid ? chalk.green("✓") : chalk.red("✗");
          console.log(`${icon} ${sp}`);
        }

        for (const e of result.errors) {
          console.log(chalk.red(`  ERROR: ${e.message}${e.path ? ` (${e.path})` : ""}`));
        }
        for (const w of result.warnings) {
          const fn = opts.strict ? chalk.red : chalk.yellow;
          console.log(fn(`  ${opts.strict ? "ERROR" : "WARN"}: ${w.message}${w.path ? ` (${w.path})` : ""}`));
        }
        if (verbose) {
          console.log(chalk.dim(`  ${result.errors.length} error(s), ${result.warnings.length} warning(s)`));
        }
      }

      if (hasErrors) process.exit(1);
    });
}

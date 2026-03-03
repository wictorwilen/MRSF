/**
 * mrsf reanchor — Re-anchor comments after document changes.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { discoverAllSidecars, findWorkspaceRoot } from "../lib/discovery.js";
import { parseSidecar } from "../lib/parser.js";
import { readDocumentLines } from "../lib/parser.js";
import { sidecarToDocument } from "../lib/discovery.js";
import { resolveSidecarPaths } from "../lib/resolve-files.js";
import { writeSidecar } from "../lib/writer.js";
import { findRepoRoot, getStagedFiles } from "../lib/git.js";
import {
  reanchorDocument,
  applyReanchorResults,
} from "../lib/reanchor.js";
import type { ReanchorResult } from "../lib/types.js";

export function registerReanchor(program: Command): void {
  program
    .command("reanchor [files...]")
    .description("Re-anchor comments to current document content")
    .option("-n, --dry-run", "Report without modifying files")
    .option("-t, --threshold <n>", "Fuzzy threshold 0.0–1.0", "0.6")
    .option("--staged", "Only process sidecars for staged files")
    .option("--no-git", "Disable git integration")
    .option("--from <commit>", "Override from-commit for all comments")
    .option("--update-text", "Also update selected_text to match current document text")
    .action(
      async (
        files: string[],
        opts: {
          dryRun?: boolean;
          threshold: string;
          staged?: boolean;
          git: boolean;
          from?: string;
          updateText?: boolean;
        },
      ) => {
        const parentOpts = program.opts();
        const cwd = parentOpts.cwd ?? process.cwd();
        const quiet = parentOpts.quiet ?? false;
        const threshold = parseFloat(opts.threshold);
        const noGit = !opts.git;

        let sidecarPaths: string[];

        if (opts.staged && !noGit) {
          // Only process sidecars whose documents are staged
          const repoRoot = await findRepoRoot(cwd);
          if (!repoRoot) {
            console.error(chalk.red("Not in a git repository."));
            process.exit(1);
          }
          const staged = await getStagedFiles(repoRoot, "*.md");
          sidecarPaths = [];
          for (const md of staged) {
            const absPath = path.resolve(repoRoot, md + ".review.yaml");
            try {
              await parseSidecar(absPath);
              sidecarPaths.push(absPath);
            } catch {
              // No sidecar for this staged file, skip
            }
          }
        } else {
          sidecarPaths = await resolveSidecarPaths(files, cwd);
        }

        if (sidecarPaths.length === 0) {
          if (!quiet) console.log("No sidecar files found.");
          return;
        }

        let totalChanged = 0;
        let totalOrphaned = 0;

        for (const sp of sidecarPaths) {
          try {
            const doc = await parseSidecar(sp);
            const docPath = sidecarToDocument(sp);
            const lines = await readDocumentLines(docPath);
            const repoRoot = !noGit ? await findRepoRoot(cwd) : null;

            const results = await reanchorDocument(doc, lines, {
              threshold,
              noGit,
              fromCommit: opts.from,
              documentPath: docPath,
              repoRoot: repoRoot ?? undefined,
            });

            const orphaned = results.filter((r) => r.status === "orphaned").length;
            totalOrphaned += orphaned;

            if (!opts.dryRun) {
              const changed = applyReanchorResults(doc, results, {
                updateText: opts.updateText,
              });
              totalChanged += changed;
              if (changed > 0) {
                await writeSidecar(sp, doc);
              }
            }

            if (!quiet) {
              printResults(sp, results, opts.dryRun);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`✗ ${sp}: ${msg}`));
          }
        }

        if (!quiet) {
          console.log();
          const label = opts.dryRun ? "would change" : "changed";
          console.log(
            `${totalChanged} comment(s) ${label}, ${totalOrphaned} orphaned.`,
          );
        }

        if (totalOrphaned > 0) process.exit(1);
      },
    );
}

function printResults(
  sidecarPath: string,
  results: ReanchorResult[],
  dryRun?: boolean,
): void {
  const prefix = dryRun ? "[dry-run] " : "";
  console.log(`${prefix}${sidecarPath}:`);

  for (const r of results) {
    const icon = statusIcon(r.status);
    const line = r.newLine != null ? `:${r.newLine}` : "";
    console.log(`  ${icon} ${r.commentId}${line} — ${r.reason}`);
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "anchored":
      return chalk.green("●");
    case "shifted":
      return chalk.blue("↕");
    case "fuzzy":
      return chalk.yellow("≈");
    case "ambiguous":
      return chalk.magenta("?");
    case "orphaned":
      return chalk.red("✗");
    default:
      return "·";
  }
}

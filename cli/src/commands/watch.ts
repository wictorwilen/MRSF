/**
 * mrsf watch — Monitor files and validate / reanchor on change.
 *
 * By default, validation is run on every change.  Pass `--reanchor` to
 * also auto-fix drifted anchors when a Markdown file is saved.
 *
 * Trigger rules (avoids feedback loops):
 *   - `.md` change       → reanchor (if enabled), then validate sidecar
 *   - `.review.yaml/json` change → validate only
 */

import type { Command } from "commander";
import path from "node:path";
import chalk from "chalk";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";

import {
  findWorkspaceRoot,
  discoverSidecar,
  sidecarToDocument,
  discoverAllSidecars,
} from "../lib/discovery.js";
import { resolveSidecarPaths } from "../lib/resolve-files.js";
import { validateFile } from "../lib/validator.js";
import { reanchorFile } from "../lib/reanchor.js";
import type { ReanchorResult, ValidationResult } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIDECAR_EXTS = [".review.yaml", ".review.json"];
function isSidecar(file: string): boolean {
  return SIDECAR_EXTS.some((ext) => file.endsWith(ext));
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
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

function printReanchorResults(
  label: string,
  results: ReanchorResult[],
  changed: number,
  written: boolean,
  dryRun: boolean,
  verbose: boolean,
): void {
  const prefix = dryRun ? chalk.dim("[dry-run] ") : "";
  console.log(`  ${prefix}${chalk.cyan("reanchor")} ${label}`);
  for (const r of results) {
    const icon = statusIcon(r.status);
    const line = r.newLine != null ? `:${r.newLine}` : "";
    console.log(`    ${icon} ${r.commentId}${line} — ${r.reason}`);
    if (verbose && r.score != null) {
      console.log(`        score: ${r.score.toFixed(3)}`);
    }
  }
  if (!dryRun && written) {
    console.log(`  ${chalk.green("✓")} ${changed} comment(s) updated`);
  } else if (dryRun) {
    console.log(`  ${chalk.dim(`${changed} comment(s) would change`)}`);
  }
}

function printValidateResults(
  label: string,
  result: ValidationResult,
  strict: boolean,
): void {
  const effectiveValid = strict
    ? result.valid && result.warnings.length === 0
    : result.valid;
  const icon = effectiveValid ? chalk.green("✓") : chalk.red("✗");
  console.log(`  ${chalk.cyan("validate")} ${icon} ${label}`);

  for (const e of result.errors) {
    console.log(
      chalk.red(`    error: ${e.message}${e.path ? ` (${e.path})` : ""}`),
    );
  }
  for (const w of result.warnings) {
    const fn = strict ? chalk.red : chalk.yellow;
    const tag = strict ? "error" : "warn";
    console.log(
      fn(`    ${tag}: ${w.message}${w.path ? ` (${w.path})` : ""}`),
    );
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface WatchOptions {
  reanchor?: boolean;
  dryRun?: boolean;
  threshold: string;
  git: boolean;
  from?: string;
  updateText?: boolean;
  force?: boolean;
  strict?: boolean;
  debounce: string;
}

export function registerWatch(program: Command): void {
  program
    .command("watch [files...]")
    .description(
      "Watch files for changes and validate (+ optionally reanchor)",
    )
    .option("--reanchor", "Auto-reanchor when Markdown files change")
    .option("-n, --dry-run", "Preview reanchor changes without writing")
    .option(
      "-t, --threshold <n>",
      "Fuzzy match threshold 0.0–1.0",
      "0.6",
    )
    .option("-s, --strict", "Treat validation warnings as errors")
    .option("--no-git", "Disable git integration")
    .option("--from <commit>", "Override from-commit for reanchor")
    .option("--update-text", "Update selected_text on reanchor")
    .option(
      "-f, --force",
      "Force reanchor — update commit, clear audit fields",
    )
    .option("--debounce <ms>", "Debounce interval in ms", "300")
    .action(async (files: string[], opts: WatchOptions) => {
      const parentOpts = program.opts();
      const cwd = parentOpts.cwd ?? process.cwd();
      const quiet = parentOpts.quiet ?? false;
      const verbose = parentOpts.verbose ?? false;
      const debounceMs = parseInt(opts.debounce, 10) || 300;
      const threshold = parseFloat(opts.threshold);
      const noGit = !opts.git;

      // ── Resolve watch targets ────────────────────────────
      let watchPaths: string[];

      if (files.length === 0) {
        // Watch the whole workspace
        const root = findWorkspaceRoot(cwd) ?? cwd;
        watchPaths = [root];
      } else {
        // Resolve explicit paths — collect both sidecars and documents
        const sidecarPaths = await resolveSidecarPaths(files, cwd);
        const docPaths = sidecarPaths.map((sp) => sidecarToDocument(sp));
        watchPaths = [...new Set([...sidecarPaths, ...docPaths])];
      }

      // ── Start watcher ────────────────────────────────────
      const watcher = chokidarWatch(watchPaths, {
        ignoreInitial: true,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          ...(files.length === 0
            ? []
            : [
                // When watching specific files, chokidar might get
                // extra events from parent dirs — no extra ignores needed.
              ]),
        ],
        // Only watch files matching our extensions when watching a dir
        ...(files.length === 0
          ? {}
          : {}),
      });

      // Track debounce per file
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      // Track files we just wrote (to skip re-trigger)
      const selfWrites = new Set<string>();
      // Stats
      let totalEvents = 0;
      let totalErrors = 0;
      let totalReanchors = 0;

      // ── Event handler ────────────────────────────────────
      async function handleChange(filePath: string): Promise<void> {
        const abs = path.resolve(filePath);
        const rel = path.relative(cwd, abs);

        // Skip files we just wrote ourselves
        if (selfWrites.has(abs)) {
          selfWrites.delete(abs);
          return;
        }

        // Only process markdown and sidecar files
        const isSidecarFile = isSidecar(abs);
        const isMarkdown = abs.endsWith(".md");
        if (!isSidecarFile && !isMarkdown) return;

        totalEvents++;
        if (!quiet) {
          console.log(
            `\n${chalk.dim(`[${timestamp()}]`)} ${chalk.bold(rel)}`,
          );
        }

        if (isSidecarFile) {
          // ── Sidecar changed → validate ──────────────────
          await runValidate(abs, rel);
        } else if (isMarkdown) {
          // ── Markdown changed → reanchor (opt-in) + validate sidecar ──
          let sidecarPath: string | undefined;
          try {
            sidecarPath = await discoverSidecar(abs, { cwd });
          } catch {
            // No sidecar for this markdown file — skip silently
            if (verbose) {
              console.log(chalk.dim(`  no sidecar found — skipping`));
            }
            return;
          }

          if (opts.reanchor) {
            await runReanchor(sidecarPath, rel);
          }

          // Validate the sidecar in all modes
          await runValidate(
            sidecarPath,
            path.relative(cwd, sidecarPath),
          );
        }
      }

      async function runValidate(
        sidecarPath: string,
        label: string,
      ): Promise<void> {
        try {
          const result = await validateFile(sidecarPath);
          const effectiveValid = opts.strict
            ? result.valid && result.warnings.length === 0
            : result.valid;
          if (!effectiveValid) totalErrors++;

          if (!quiet || !effectiveValid) {
            printValidateResults(label, result, !!opts.strict);
          }
        } catch (err: unknown) {
          totalErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`  validate ✗ ${label}: ${msg}`));
        }
      }

      async function runReanchor(
        sidecarPath: string,
        label: string,
      ): Promise<void> {
        try {
          const { results, changed, written } = await reanchorFile(
            sidecarPath,
            {
              cwd,
              dryRun: opts.dryRun,
              threshold,
              noGit,
              fromCommit: opts.from,
              updateText: opts.updateText,
              force: opts.force,
            },
          );

          totalReanchors++;

          if (written) {
            // Mark the sidecar as self-written to avoid re-triggering
            selfWrites.add(path.resolve(sidecarPath));
          }

          const orphaned = results.filter(
            (r) => r.status === "orphaned",
          ).length;
          if (orphaned > 0) totalErrors++;

          if (!quiet) {
            printReanchorResults(
              label,
              results,
              changed,
              written,
              !!opts.dryRun,
              verbose,
            );
          }
        } catch (err: unknown) {
          totalErrors++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`  reanchor ✗ ${label}: ${msg}`));
        }
      }

      // ── Wire events with debounce ────────────────────────
      function onFileChange(filePath: string): void {
        const abs = path.resolve(filePath);
        const existing = timers.get(abs);
        if (existing) clearTimeout(existing);

        timers.set(
          abs,
          setTimeout(() => {
            timers.delete(abs);
            handleChange(abs).catch((err) => {
              console.error(
                chalk.red(`  unexpected error: ${String(err)}`),
              );
            });
          }, debounceMs),
        );
      }

      watcher.on("change", onFileChange);
      watcher.on("add", onFileChange);

      // ── Startup banner ───────────────────────────────────
      if (!quiet) {
        const mode = opts.reanchor
          ? opts.dryRun
            ? "validate + reanchor (dry-run)"
            : "validate + reanchor"
          : "validate";
        const pathDesc =
          files.length === 0
            ? "workspace"
            : `${watchPaths.length} path(s)`;
        console.log(
          chalk.green(`Watching ${pathDesc} — mode: ${chalk.bold(mode)}`),
        );
        console.log(chalk.dim("Press Ctrl+C to stop.\n"));
      }

      // ── Graceful shutdown ────────────────────────────────
      async function shutdown(): Promise<void> {
        // Clear pending debounce timers
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();

        await watcher.close();

        if (!quiet) {
          console.log(
            `\n${chalk.dim("──────────────────────────────────────")}`,
          );
          console.log(
            `Events processed: ${totalEvents}  |  ` +
              `Reanchors: ${totalReanchors}  |  ` +
              `Errors: ${totalErrors}`,
          );
        }

        process.exit(totalErrors > 0 ? 1 : 0);
      }

      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());

      // Keep the process alive
      await new Promise<void>(() => {
        // Never resolves — the process runs until interrupted
      });
    });
}

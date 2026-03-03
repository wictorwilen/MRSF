/**
 * mrsf status — Show anchor health for all comments.
 */

import type { Command } from "commander";
import chalk from "chalk";
import path from "node:path";
import { sidecarToDocument } from "../lib/discovery.js";
import { parseSidecar, readDocumentLines } from "../lib/parser.js";
import { resolveSidecarPaths } from "../lib/resolve-files.js";
import { findRepoRoot, getCurrentCommit, isStale as gitIsStale } from "../lib/git.js";
import { exactMatch } from "../lib/fuzzy.js";
import type { AnchorHealth, StatusResult } from "../lib/types.js";

export function registerStatus(program: Command): void {
  program
    .command("status [files...]")
    .description("Show anchor health for comments")
    .option("--json", "Output as JSON")
    .action(async (files: string[], opts: { json?: boolean }) => {
      const parentOpts = program.opts();
      const cwd = parentOpts.cwd ?? process.cwd();
      const quiet = parentOpts.quiet ?? false;
      const verbose = parentOpts.verbose ?? false;

      const sidecarPaths = await resolveSidecarPaths(files, cwd);

      if (sidecarPaths.length === 0) {
        if (!quiet) console.log("No sidecar files found.");
        return;
      }

      const repoRoot = await findRepoRoot(cwd);
      const allResults: StatusResult[] = [];

      for (const sp of sidecarPaths) {
        try {
          const doc = await parseSidecar(sp);
          const docPath = sidecarToDocument(sp);
          let lines: string[];
          try {
            lines = await readDocumentLines(docPath);
          } catch {
            // Document missing
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
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`✗ ${sp}: ${msg}`));
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(allResults, null, 2));
        return;
      }

      if (verbose) {
        for (const sp of sidecarPaths) {
          console.log(chalk.dim(`  sidecar: ${sp}`));
        }
      }

      for (const r of allResults) {
        const icon = healthIcon(r.health);
        console.log(`${icon} ${r.commentId}: ${r.reason}`);
      }

      const fresh = allResults.filter((r) => r.health === "fresh").length;
      const stale = allResults.filter((r) => r.health === "stale").length;
      const orphaned = allResults.filter((r) => r.health === "orphaned").length;
      const unknown = allResults.filter((r) => r.health === "unknown").length;

      if (!quiet) {
        console.log(
          `\n${allResults.length} comment(s): ${fresh} fresh, ${stale} stale, ${orphaned} orphaned, ${unknown} unknown`,
        );
      }
    });
}

async function assessHealth(
  comment: { id: string; commit?: string; selected_text?: string; x_reanchor_status?: unknown },
  lines: string[],
  repoRoot: string | null,
): Promise<StatusResult> {
  // Already marked orphaned
  if (comment.x_reanchor_status === "orphaned") {
    return {
      commentId: comment.id,
      health: "orphaned",
      reason: "Marked orphaned by previous re-anchor.",
    };
  }

  // Check text match
  if (comment.selected_text) {
    const matches = exactMatch(lines, comment.selected_text);
    if (matches.length === 0) {
      // No exact match — might be stale or orphaned
      if (comment.commit && repoRoot) {
        const stale = await gitIsStale(comment.commit, repoRoot);
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

    // Text found — check commit freshness
    if (comment.commit && repoRoot) {
      const stale = await gitIsStale(comment.commit, repoRoot);
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

  // No selected_text
  if (!comment.commit) {
    return {
      commentId: comment.id,
      health: "unknown",
      reason: "No selected_text or commit to assess.",
    };
  }

  if (repoRoot) {
    const stale = await gitIsStale(comment.commit, repoRoot);
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

function healthIcon(health: AnchorHealth): string {
  switch (health) {
    case "fresh":
      return chalk.green("●");
    case "stale":
      return chalk.yellow("◐");
    case "orphaned":
      return chalk.red("✗");
    case "unknown":
      return chalk.dim("?");
  }
}

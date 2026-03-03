#!/usr/bin/env node

/**
 * MRSF CLI — entry point.
 *
 *   npx @mrsf/cli <command> [options]
 */

import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";
import { registerValidate } from "./commands/validate.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
import { registerReanchor } from "./commands/reanchor.js";
import { registerAdd } from "./commands/add.js";
import { registerResolve } from "./commands/resolve.js";
import { registerList } from "./commands/list.js";
import { registerInit } from "./commands/init.js";
import { registerStatus } from "./commands/status.js";
import { registerRename } from "./commands/rename.js";

/* ── Banner ────────────────────────────────────────────────────────── */

/**
 * Detect CI/CD or non-interactive environments where the banner should
 * be suppressed.  Checks common CI env vars and whether stdout is a TTY.
 */
function isCI(): boolean {
  const env = process.env;
  return !!(
    env.CI ||
    env.CONTINUOUS_INTEGRATION ||
    env.BUILD_NUMBER ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.CIRCLECI ||
    env.TRAVIS ||
    env.JENKINS_URL ||
    env.CODEBUILD_BUILD_ID ||
    env.TF_BUILD ||
    env.BUILDKITE ||
    env.TEAMCITY_VERSION
  );
}

function showBanner(): void {
  // Skip in CI, non-TTY, --quiet, or --no-color
  if (isCI() || !process.stdout.isTTY) return;
  if (process.argv.includes("-q") || process.argv.includes("--quiet")) return;

  const repo = "https://github.com/wictorwilen/MRSF";
  const banner = `
  ${chalk.cyan.bold("╔╦╗")}${chalk.blue.bold("╦═╗")}${chalk.magenta.bold("╔═╗")}${chalk.yellow.bold("╔═╗")}
  ${chalk.cyan.bold("║║║")}${chalk.blue.bold("╠╦╝")}${chalk.magenta.bold("╚═╗")}${chalk.yellow.bold("╠╣")}
  ${chalk.cyan.bold("╩ ╩")}${chalk.blue.bold("╩╚═")}${chalk.magenta.bold("╚═╝")}${chalk.yellow.bold("╚")}
  ${chalk.dim("Markdown Review Sidecar Format")}  ${chalk.dim.italic(`v${version}`)}
  ${chalk.dim.underline(repo)}
`;
  process.stderr.write(banner + "\n");
}

showBanner();

/* ── Program ───────────────────────────────────────────────────────── */

const program = new Command();

program
  .name("mrsf")
  .description("Markdown Review Sidecar Format — CLI & toolkit")
  .version(version)
  .option("--cwd <dir>", "Working directory")
  .option("--config <path>", "Path to .mrsf.yaml")
  .option("--no-color", "Disable colour output")
  .option("-q, --quiet", "Suppress non-essential output");

registerValidate(program);
registerReanchor(program);
registerAdd(program);
registerResolve(program);
registerList(program);
registerInit(program);
registerStatus(program);
registerRename(program);

program.parse();

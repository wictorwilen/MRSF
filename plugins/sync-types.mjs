#!/usr/bin/env node
/**
 * sync-types.mjs — Copy shared source files into plugin packages.
 *
 * This keeps a single source of truth in plugins/shared/src/ while ensuring
 * each published plugin is self-contained (no dependency on the private
 * @mrsf/plugin-shared package for types or the client-side controller).
 *
 * Usage:
 *   node plugins/sync-types.mjs          # from repo root
 *   node ../sync-types.mjs               # from a plugin directory
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedSrc = resolve(__dirname, "shared", "src");

const plugins = ["rehype", "markdown-it"];
const files = ["types.ts", "controller.ts"];

for (const file of files) {
  const source = readFileSync(resolve(sharedSrc, file), "utf-8");
  const header =
    "/* ---------------------------------------------------------------\n" +
    " * AUTO-GENERATED — DO NOT EDIT\n" +
    " *\n" +
    ` * Source: plugins/shared/src/${file}\n` +
    " * Run `node plugins/sync-types.mjs` to regenerate.\n" +
    " * --------------------------------------------------------------- */\n\n";

  for (const plugin of plugins) {
    const dest = resolve(__dirname, plugin, "src", file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, header + source, "utf-8");
  }

  console.log(`  synced ${file} → ${plugins.map((p) => p + "/src/").join(", ")}`);
}

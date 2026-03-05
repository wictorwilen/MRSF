import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Clean previous build output
rmSync(resolve(__dirname, "dist"), { recursive: true, force: true });

/** Shared build options — bundles @mrsf/plugin-shared, externalises the rest. */
const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  treeShaking: true,
  // @mrsf/plugin-shared is private → bundle it in.
  // Everything else is a real npm dependency → keep external.
  external: [
    "@mrsf/cli",
    "unist-util-visit",
  ],
};

// Node.js entry — full feature set (fs access, sidecar discovery)
await esbuild.build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  platform: "node",
});

// Browser entry — comments / loader only, no Node.js APIs
await esbuild.build({
  ...shared,
  entryPoints: ["src/browser.ts"],
  outfile: "dist/browser.js",
  platform: "neutral",
});

// Client-side controller (auto-init event dispatcher) — self-contained
await esbuild.build({
  ...shared,
  entryPoints: ["src/controller.ts"],
  outfile: "dist/controller.js",
  platform: "browser",
  external: [],
});

// Copy style.css from shared
mkdirSync(resolve(__dirname, "dist"), { recursive: true });
copyFileSync(
  resolve(__dirname, "..", "shared", "src", "style.css"),
  resolve(__dirname, "dist", "style.css"),
);

// Emit type declarations
execSync("npx tsc --emitDeclarationOnly", { stdio: "inherit" });

console.log("Build complete.");

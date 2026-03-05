import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

// Banner for bin: shebang + createRequire polyfill so esbuild's CJS-to-ESM
// shim can resolve Node built-ins (process, fs, etc.) at runtime.
const binBanner = [
  "#!/usr/bin/env node",
  'import { createRequire as __createRequire } from "node:module";',
  "const require = __createRequire(import.meta.url);",
].join("\n");

// Bundle bin.ts (CLI entry) — ESM with require polyfill
await esbuild.build({
  entryPoints: ["src/bin.ts"],
  bundle: true,
  outfile: "dist/bin.js",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: false,
  minify: !isWatch,
  treeShaking: true,
  banner: { js: binBanner },
});

// Read version from package.json to inject at build time
const fs = await import("node:fs/promises");
const pkg = JSON.parse(await fs.readFile("package.json", "utf-8"));

// Copy mrsf.schema.json next to the bundle so the validator can find it at runtime
await fs.copyFile("../cli/mrsf.schema.json", "dist/mrsf.schema.json");

// Bundle server.ts (library entry)
await esbuild.build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  outfile: "dist/server.js",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: false,
  minify: !isWatch,
  treeShaking: true,
  define: { PKG_VERSION: JSON.stringify(pkg.version) },
});

// Also emit type declarations via tsc
const { execSync } = await import("node:child_process");
execSync("npx tsc --emitDeclarationOnly", { stdio: "inherit" });

console.log("Build complete.");

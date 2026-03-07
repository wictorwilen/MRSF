import * as esbuild from "esbuild";
import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

rmSync(resolve(__dirname, "dist"), { recursive: true, force: true });

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  treeShaking: true,
  external: [
    "@mrsf/cli",
    "monaco-editor",
  ],
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  platform: "neutral",
});

await esbuild.build({
  ...shared,
  entryPoints: ["src/browser.ts"],
  outfile: "dist/browser.js",
  platform: "browser",
});

execSync("npx tsc --emitDeclarationOnly", { stdio: "inherit" });

console.log("Build complete.");
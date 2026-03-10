import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
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
    "marked",
  ],
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  platform: "node",
});

await esbuild.build({
  ...shared,
  entryPoints: ["src/browser.ts"],
  outfile: "dist/browser.js",
  platform: "neutral",
});

await esbuild.build({
  ...shared,
  entryPoints: ["src/controller.ts"],
  outfile: "dist/controller.js",
  platform: "browser",
  external: [],
});

mkdirSync(resolve(__dirname, "dist"), { recursive: true });
copyFileSync(
  resolve(__dirname, "..", "shared", "src", "style.css"),
  resolve(__dirname, "dist", "style.css"),
);

execSync("npx tsc --emitDeclarationOnly", { stdio: "inherit" });

console.log("Build complete.");
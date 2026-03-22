import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    "@mrsf/cli/browser",
    "@milkdown/ctx",
    "@milkdown/core",
    "@milkdown/crepe",
    "@milkdown/kit",
    "@milkdown/kit/core",
    "@milkdown/kit/ctx",
    "@milkdown/kit/plugin/listener",
    "@milkdown/plugin-listener",
    "@milkdown/prose",
    "@milkdown/prose/model",
    "@milkdown/prose/state",
    "@milkdown/prose/view",
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

mkdirSync(resolve(__dirname, "dist"), { recursive: true });
const sharedStyle = readFileSync(resolve(__dirname, "..", "shared", "src", "style.css"), "utf8");
const localStyle = readFileSync(resolve(__dirname, "style.css"), "utf8");
writeFileSync(resolve(__dirname, "dist", "style.css"), `${sharedStyle}\n\n${localStyle}`);
execSync("npx tsc --emitDeclarationOnly", { stdio: "inherit" });

console.log("Build complete.");
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

const shared = {
  bundle: true,
  format: "cjs",
  target: "es2022",
  sourcemap: true,
  treeShaking: true,
  external,
  logLevel: "info",
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.cjs",
  platform: "node",
  define: {
    "import.meta.url": "importMetaUrl",
  },
  banner: {
    js: 'const importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});

await esbuild.build({
  ...shared,
  entryPoints: ["src/browser.ts"],
  outfile: "dist/browser.cjs",
  platform: "neutral",
});

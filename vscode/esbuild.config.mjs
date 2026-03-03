import * as esbuild from "esbuild";
import * as fs from "node:fs";

const isWatch = process.argv.includes("--watch");

/**
 * esbuild plugin that replaces `import.meta.url` with a CJS-compatible
 * equivalent. This is necessary because @mrsf/cli is ESM and its
 * validator.ts uses `import.meta.url` at the top level, which becomes
 * `undefined` in esbuild's CJS output format.
 */
const importMetaPlugin = {
  name: "import-meta-url-shim",
  setup(build) {
    build.onLoad({ filter: /\.[jt]s$/ }, (args) => {
      const contents = fs.readFileSync(args.path, "utf8");
      if (!contents.includes("import.meta.url")) return;
      const loader = args.path.endsWith(".ts") ? "ts" : "js";
      return {
        contents: contents.replace(
          /import\.meta\.url/g,
          '(typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : "file:///unknown")',
        ),
        loader,
        resolveDir: args.path.replace(/[/\\][^/\\]+$/, ""),
      };
    });
  },
};

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: !isWatch,
  treeShaking: true,
  plugins: [importMetaPlugin],
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete.");
}

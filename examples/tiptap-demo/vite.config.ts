import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const tiptapSubpaths = [
  "@tiptap/pm/model",
  "@tiptap/pm/state",
  "@tiptap/pm/transform",
  "@tiptap/pm/view",
];

const demoRoot = fileURLToPath(new URL(".", import.meta.url));
const examplesNodeModules = resolve(demoRoot, "../node_modules");

export default defineConfig({
  resolve: {
    dedupe: ["@tiptap/core"],
    alias: [
      {
        find: "@tiptap/core",
        replacement: resolve(examplesNodeModules, "@tiptap/core/dist/index.js"),
      },
      {
        find: /^@tiptap\/pm\/(.+)$/,
        replacement: `${examplesNodeModules}/@tiptap/pm/$1/dist/index.js`,
      },
    ],
  },
  optimizeDeps: {
    include: ["@tiptap/core", ...tiptapSubpaths],
  },
});
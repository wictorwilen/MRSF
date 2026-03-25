import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const tiptapSubpaths = [
  "@tiptap/pm/model",
  "@tiptap/pm/state",
  "@tiptap/pm/transform",
  "@tiptap/pm/view",
];

const milkdownPackages = [
  "@milkdown/core",
  "@milkdown/crepe",
  "@milkdown/ctx",
  "@milkdown/kit",
  "@milkdown/plugin-listener",
  "@milkdown/prose",
  "prosemirror-model",
  "prosemirror-state",
  "prosemirror-transform",
  "prosemirror-view",
];

const examplesRoot = fileURLToPath(new URL(".", import.meta.url));
const examplesNodeModules = resolve(examplesRoot, "node_modules");

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  resolve: {
    dedupe: ["@tiptap/core", ...milkdownPackages],
    alias: [
      {
        find: "@mrsf/milkdown-mrsf/style.css",
        replacement: resolve(examplesRoot, "../plugins/milkdown/dist/style.css"),
      },
      {
        find: "@mrsf/milkdown-mrsf",
        replacement: resolve(examplesRoot, "../plugins/milkdown/dist/browser.js"),
      },
      {
        find: "@tiptap/core",
        replacement: resolve(examplesNodeModules, "@tiptap/core/dist/index.js"),
      },
      {
        find: /^@tiptap\/pm\/(.+)$/,
        replacement: `${examplesNodeModules}/@tiptap/pm/$1/dist/index.js`,
      },
      {
        find: /^@milkdown\/kit\/(.+)$/,
        replacement: `${examplesNodeModules}/@milkdown/kit/$1`,
      },
      {
        find: /^@milkdown\/prose\/(.+)$/,
        replacement: `${examplesNodeModules}/@milkdown/prose/$1`,
      },
      {
        find: "@milkdown/core",
        replacement: resolve(examplesNodeModules, "@milkdown/core/lib/index.js"),
      },
      {
        find: "@milkdown/crepe",
        replacement: resolve(examplesNodeModules, "@milkdown/crepe/lib/esm/index.js"),
      },
      {
        find: "@milkdown/ctx",
        replacement: resolve(examplesNodeModules, "@milkdown/ctx/lib/index.js"),
      },
      {
        find: "@milkdown/kit",
        replacement: resolve(examplesNodeModules, "@milkdown/kit/lib/index.js"),
      },
      {
        find: "@milkdown/plugin-listener",
        replacement: resolve(examplesNodeModules, "@milkdown/plugin-listener/lib/index.js"),
      },
      {
        find: "@milkdown/prose",
        replacement: resolve(examplesNodeModules, "@milkdown/prose/lib/index.js"),
      },
      {
        find: "prosemirror-model",
        replacement: resolve(examplesNodeModules, "prosemirror-model/dist/index.js"),
      },
      {
        find: "prosemirror-state",
        replacement: resolve(examplesNodeModules, "prosemirror-state/dist/index.js"),
      },
      {
        find: "prosemirror-transform",
        replacement: resolve(examplesNodeModules, "prosemirror-transform/dist/index.js"),
      },
      {
        find: "prosemirror-view",
        replacement: resolve(examplesNodeModules, "prosemirror-view/dist/index.js"),
      },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@marp-team/marp-core")) {
            return "vendor-marp-core";
          }

          if (id.includes("node_modules/mathjax-full") || id.includes("node_modules/katex")) {
            return "vendor-marp-math";
          }

          if (id.includes("node_modules/highlight.js")) {
            return "vendor-marp-highlight";
          }

          if (id.includes("plugins/marp/") || id.includes("node_modules/@mrsf/marp-mrsf")) {
            return "vendor-mrsf-marp";
          }

          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: ["@tiptap/core", ...tiptapSubpaths, ...milkdownPackages],
  },
});
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "@mrsf/cli",
          root: "./cli/src",
          globals: true,
        },
      },
      {
        test: {
          name: "@mrsf/mcp",
          root: "./mcp/src",
          globals: true,
        },
      },
      {
        test: {
          name: "@mrsf/plugin-shared",
          root: "./plugins/shared/src",
          environment: "jsdom",
        },
      },
      {
        test: {
          name: "@mrsf/markdown-it-mrsf",
          root: "./plugins/markdown-it/src",
          globals: true,
        },
      },
      {
        test: {
          name: "@mrsf/monaco-mrsf",
          root: "./plugins/monaco/src",
          globals: true,
        },
      },
      {
        test: {
          name: "@mrsf/rehype-mrsf",
          root: "./plugins/rehype/src",
        },
      },
      {
        test: {
          name: "mrsf-vscode",
          root: "./vscode/src",
          globals: true,
          environment: "node",
        },
        resolve: {
          alias: {
            vscode: path.resolve(__dirname, "vscode/src/__tests__/mocks/vscode.ts"),
          },
        },
      },
    ],
  },
});
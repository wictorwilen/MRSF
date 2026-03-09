import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "src",
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "src/__tests__/mocks/vscode.ts"),
    },
  },
});
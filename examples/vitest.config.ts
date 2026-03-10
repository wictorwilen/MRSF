import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["monaco-demo/__tests__/**/*.test.ts"],
    environment: "jsdom",
  },
});
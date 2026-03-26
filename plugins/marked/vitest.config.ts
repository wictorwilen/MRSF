import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "src",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "../coverage",
      include: [
        "**/*.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.d.ts",
        "**/controller.ts",
        "**/gutter.ts",
        "**/html.ts",
        "**/types.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
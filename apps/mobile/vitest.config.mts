import { defineConfig } from "vitest/config";

// unit tests for pure modules only (no React Native imports)
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});

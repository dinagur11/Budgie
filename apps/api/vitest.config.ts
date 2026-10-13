import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Runs before each test file's imports, so the DATABASE_URL guard fires before src/prisma.ts loads.
    setupFiles: ["./tests/setup.ts"],
    // All test files share one database and reset it between tests, so they must not run in parallel.
    fileParallelism: false,
  },
});

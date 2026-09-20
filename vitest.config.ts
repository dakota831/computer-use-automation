import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: that config is rooted at web/ for the
 * console build, and tests live at the repo root alongside the backend they cover.
 */
export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});

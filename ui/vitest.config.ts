import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      "@backend": resolve(__dirname, "../src"),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
  },
});

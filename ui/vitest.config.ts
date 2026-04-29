import { defineConfig } from "vitest/config";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

const aliases = {
  "@": resolve(__dirname, "."),
  "@backend": resolve(__dirname, "../src"),
};

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: "node",
          include: ["__tests__/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        resolve: { alias: aliases },
        test: {
          name: "dom",
          include: ["__tests__/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./__tests__/setup-dom.ts"],
        },
      },
    ],
  },
});

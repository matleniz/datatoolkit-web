/// <reference types="vitest/config" />
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));
const e2eFixtures = join(root, "e2e/fixtures");

export default defineConfig({
  plugins: [react()],
  define: {
    // Engine-readable absolute path to this checkout's e2e fixtures (MAT-190).
    __DTK_E2E_FIXTURES__: JSON.stringify(e2eFixtures),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});

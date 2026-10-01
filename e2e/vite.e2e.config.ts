/// <reference types="vitest/config" />
/**
 * Vite config for Playwright e2e — dedicated API port so parallel worktrees
 * (which fuser-kill 8765/5173) do not tear down this suite mid-run.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));
const e2eFixtures = join(root, "fixtures");
const apiPort = Number(process.env.DTK_E2E_API_PORT ?? "8766");

export default defineConfig({
  plugins: [react()],
  define: {
    __DTK_E2E_FIXTURES__: JSON.stringify(e2eFixtures),
  },
  // Pre-bundle every dependency up front. Anything Vite discovers lazily on a
  // cold `node_modules/.vite` (plotly is imported dynamically) triggers a
  // "new dependencies optimized, reloading" page reload under a running spec.
  optimizeDeps: {
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "react-grid-layout",
      "plotly.js-dist-min",
    ],
  },
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});

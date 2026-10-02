/// <reference types="vitest/config" />
/**
 * Vite config for Playwright e2e — dedicated API port so parallel worktrees
 * (which fuser-kill 8765/5173) do not tear down this suite mid-run.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));
const e2eFixtures = join(root, "fixtures");
const apiPort = Number(process.env.DTK_E2E_API_PORT ?? "8766");

/** Dev only: hand the page the bridge token (`DTK_UI_TOKEN`); no env, no meta, bridge off. */
function uiTokenMeta(): Plugin {
  return {
    name: "dtk-ui-token-meta",
    transformIndexHtml() {
      const token = process.env.DTK_UI_TOKEN;
      if (!token) return [];
      return [
        { tag: "meta", attrs: { name: "dtk-ui-token", content: token }, injectTo: "head" },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), uiTokenMeta()],
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

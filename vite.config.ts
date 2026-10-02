/// <reference types="vitest/config" />
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));
const e2eFixtures = join(root, "e2e/fixtures");

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

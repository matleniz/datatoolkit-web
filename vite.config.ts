/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Dev only: hand the page the bridge token (`DTK_UI_TOKEN`); no env, no meta, bridge off. */
function uiTokenMeta(): Plugin {
  return {
    name: "dtk-ui-token-meta",
    apply: "serve", // never bake a token into `vite build` output
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
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});

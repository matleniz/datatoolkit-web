/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { uiTokenMeta } from "./scripts/uiToken";

const apiTarget = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react(), uiTokenMeta(apiTarget)],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
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

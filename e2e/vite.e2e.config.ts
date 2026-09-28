/// <reference types="vitest/config" />
/**
 * Vite config for Playwright e2e — dedicated API port so parallel worktrees
 * (which fuser-kill 8765/5173) do not tear down this suite mid-run.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.DTK_E2E_API_PORT ?? "8766");

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});

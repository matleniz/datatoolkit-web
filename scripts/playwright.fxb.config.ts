import { defineConfig, devices } from "@playwright/test";

/** Screenshot-only config: reuses the already-running dtk-api + Vite on 5174. */
export default defineConfig({
  testDir: ".",
  testMatch: "fxb-screenshots.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

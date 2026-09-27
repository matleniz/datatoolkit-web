import { defineConfig, devices } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DTK_API_CANDIDATES = [
  process.env.DTK_API_BIN,
  join(homedir(), "datatoolkit/.venv/bin/dtk-api"),
  "dtk-api",
].filter(Boolean) as string[];

function resolveDtkApi(): string | null {
  for (const c of DTK_API_CANDIDATES) {
    if (c === "dtk-api") return c;
    if (existsSync(c)) return c;
  }
  return null;
}

const dtkApi = resolveDtkApi();
if (!dtkApi) {
  console.warn(
    "[e2e] dtk-api not found — starting Vite only. " +
      "Expected ~/datatoolkit/.venv/bin/dtk-api",
  );
}

const dtkHome = mkdtempSync(join(tmpdir(), "dtk-e2e-"));

const webServers = [
  ...(dtkApi
    ? [
        {
          command: `${dtkApi} --port 8765`,
          url: "http://127.0.0.1:8765/api/keys",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            DTK_HOME: dtkHome,
          },
        },
      ]
    : []),
  {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: webServers,
});

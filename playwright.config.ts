import { defineConfig, devices } from "@playwright/test";
import { spawnSync } from "node:child_process";

function dtkApiAvailable(): boolean {
  const r = spawnSync("dtk-api", ["--help"], {
    encoding: "utf8",
    timeout: 5000,
  });
  return r.status === 0 || (r.stdout ?? "").includes("usage") || (r.stderr ?? "").includes("usage");
}

const hasApi = dtkApiAvailable();
if (!hasApi) {
  console.warn(
    "[e2e] dtk-api not found on PATH — starting Vite only. " +
      "Install the engine API with: cd ~/datatoolkit && uv run --extra api dtk-api --help",
  );
}

const webServers = [
  ...(hasApi
    ? [
        {
          command: "dtk-api --port 8765",
          url: "http://127.0.0.1:8765/api/keys",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
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
  fullyParallel: true,
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

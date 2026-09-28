import { defineConfig, devices } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const dtkHome = mkdtempSync(join(tmpdir(), "dtk-e2e-"));
const dtkToolkitDir = join(homedir(), "datatoolkit");

/** Dedicated ports — parallel worktrees fuser-kill 8765/5173. */
const apiPort = Number(process.env.DTK_E2E_API_PORT ?? "8766");
const webPort = Number(process.env.DTK_E2E_WEB_PORT ?? "5175");

function resolveDtkApiCommand(): string {
  if (process.env.DTK_API_CMD) return process.env.DTK_API_CMD;
  if (process.env.DTK_API_BIN) {
    return `${process.env.DTK_API_BIN} --port ${apiPort}`;
  }
  const venvBin = join(dtkToolkitDir, ".venv/bin/dtk-api");
  if (existsSync(venvBin)) {
    return `${venvBin} --port ${apiPort}`;
  }
  return `uv run --project ${dtkToolkitDir} --extra api dtk-api --port ${apiPort}`;
}

const dtkApiCommand = resolveDtkApiCommand();

const webServers = [
  {
    command: dtkApiCommand,
    url: `http://127.0.0.1:${apiPort}/api/keys`,
    // Never reuse — other worktrees may be listening on shared ports with a
    // different DTK_HOME / binary.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DTK_HOME: dtkHome,
    },
  },
  {
    command: `npx vite --config e2e/vite.e2e.config.ts --host 127.0.0.1 --port ${webPort}`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DTK_E2E_API_PORT: String(apiPort),
    },
  },
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: webServers,
});

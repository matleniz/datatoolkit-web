import { defineConfig, devices } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const dtkHome = mkdtempSync(join(tmpdir(), "dtk-e2e-"));
const dtkToolkitDir = join(homedir(), "datatoolkit");

function resolveDtkApiCommand(): string {
  if (process.env.DTK_API_CMD) return process.env.DTK_API_CMD;
  if (process.env.DTK_API_BIN) return `${process.env.DTK_API_BIN} --port 8765`;
  const venvBin = join(dtkToolkitDir, ".venv/bin/dtk-api");
  if (existsSync(venvBin)) {
    return `${venvBin} --port 8765`;
  }
  return `uv run --project ${dtkToolkitDir} --extra api dtk-api --port 8765`;
}

const dtkApiCommand = resolveDtkApiCommand();

const webServers = [
  {
    command: dtkApiCommand,
    url: "http://127.0.0.1:8765/api/keys",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DTK_HOME: dtkHome,
    },
  },
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
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
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

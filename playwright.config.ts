import { defineConfig, devices } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { engineDir } from "./e2e/engine";

// Agent-bridge token (#63): one per run, shared by the engine, the Vite page
// (meta tag) and the specs that post commands to /api/ui.
const uiToken = process.env.DTK_UI_TOKEN ?? randomBytes(24).toString("hex");
process.env.DTK_UI_TOKEN = uiToken;

const dtkHome =
  process.env.DTK_E2E_HOME ?? mkdtempSync(join(tmpdir(), "dtk-e2e-"));
process.env.DTK_E2E_HOME = dtkHome;
// Engine checkout: DTK_ENGINE_DIR, else ~/datatoolkit (e2e/engine.ts). Exported
// so the specs that drive the real MCP tools use the same checkout as dtk-api.
// Those specs fail with a message naming DTK_ENGINE_DIR when it has no .venv;
// DTK_E2E_SKIP_ENGINE=1 is the explicit opt-out that skips them instead.
const dtkToolkitDir = engineDir();
process.env.DTK_ENGINE_DIR = dtkToolkitDir;

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

// The Vite proxy forwards the browser's Origin on PUT / POST, and /api/ui
// refuses origins that are not CORS origins.
const corsOrigins = [
  ...(process.env.DTK_CORS_ORIGINS ?? "").split(",").filter(Boolean),
  `http://127.0.0.1:${webPort}`,
  `http://localhost:${webPort}`,
].join(",");

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
      DTK_UI_TOKEN: uiToken,
      DTK_CORS_ORIGINS: corsOrigins,
      // Agent panel e2e (#67): scripted pack, no network, no key.
      DTK_AGENT_PACK: process.env.DTK_AGENT_PACK ?? "stub",
      // Low upload cap so the 413 spec (#299) stays small; fixtures are < 1 MiB.
      DTK_MAX_UPLOAD_MB: process.env.DTK_MAX_UPLOAD_MB ?? "4",
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
      DTK_UI_TOKEN: uiToken,
    },
  },
];

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
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

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The engine checkout the e2e harness runs `dtk-api` from and the MCP-tools
 * specs drive (`.venv/bin/python`). One resolution for both:
 * `DTK_ENGINE_DIR` when set, else the sibling `~/datatoolkit` checkout.
 */
export function engineDir(): string {
  return process.env.DTK_ENGINE_DIR || join(homedir(), "datatoolkit");
}

/** True when the engine checkout has the synced `.venv` the specs need. */
function engineAvailable(): boolean {
  return existsSync(join(engineDir(), ".venv/bin/python"));
}

/** `DTK_E2E_SKIP_ENGINE=1` opts out of the engine-dependent specs. */
function engineSkipped(): boolean {
  return process.env.DTK_E2E_SKIP_ENGINE === "1";
}

/**
 * For the specs that drive the real MCP tools: skip only on the explicit
 * opt-out, fail with an actionable message when the engine is missing.
 */
export function requireEngine(test: {
  skip(condition: boolean, description: string): void;
}): void {
  const skipped = engineSkipped();
  test.skip(skipped, "DTK_E2E_SKIP_ENGINE=1: engine-dependent spec skipped");
  if (skipped) return;
  if (!engineAvailable()) {
    throw new Error(
      `Engine checkout not found: ${join(engineDir(), ".venv/bin/python")} is missing. ` +
        "Set DTK_ENGINE_DIR to an engine checkout with a synced .venv (extra agent), " +
        "or set DTK_E2E_SKIP_ENGINE=1 to skip the engine-dependent specs.",
    );
  }
}

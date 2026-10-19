/**
 * Hint shown on the engine-down screen, worded for how Studio is served.
 * The browser cannot tell Docker from uv (both serve the production build on
 * port 8080), so `import.meta.env.DEV` (true only under `npm run dev`) is the
 * run-mode signal: dev -> start dtk-api on 8765; otherwise Docker or uv.
 */
export function engineDownHint(dev: boolean): string {
  return dev
    ? "Start dtk-api on port 8765 (uv run --extra api dtk-api --port 8765 in the engine checkout), then retry."
    : "Docker: run `docker compose logs engine` to see why it is down. Without Docker (uv): check the terminal running dtk-studio. Then retry.";
}

/** Shown in the workspace list while listing workspaces fails. */
export const ENGINE_UNREACHABLE_LIST = "Engine unreachable: cannot list workspaces.";

/**
 * Dev only: the `dtk-api` address the Vite dev / preview proxy forwards `/api`
 * to. `DTK_API_PORT` picks another port on loopback; unset or invalid = 8765
 * (the engine's default `--port`). Used by `vite.config.ts`.
 */
const DEFAULT_PORT = 8765;

export function resolveApiTarget(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.DTK_API_PORT ?? "").trim();
  const port = /^\d+$/.test(raw) ? Number(raw) : DEFAULT_PORT;
  return `http://127.0.0.1:${port >= 1 && port <= 65535 ? port : DEFAULT_PORT}`;
}

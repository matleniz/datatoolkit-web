/**
 * Dev only: where the Studio dev server gets the agent-bridge token from.
 * Shared by `vite.config.ts` and `e2e/vite.e2e.config.ts`. Never log the token.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** `$DTK_HOME/agent/runtime.json` (`~/.datatoolkit` when unset), as the engine writes it. */
function runtimeFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.DTK_HOME || join(homedir(), ".datatoolkit"),
    "agent",
    "runtime.json",
  );
}

function hostPort(url: string): string | null {
  try {
    const u = new URL(url);
    const host = LOOPBACK.has(u.hostname) ? "loopback" : u.hostname;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return `${host}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Env `DTK_UI_TOKEN` wins; else the engine runtime file, only when its `url`
 * is the `/api` proxy target (host:port). Anything else → `undefined` (bridge off).
 */
export function resolveUiToken(
  proxyTarget: string,
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): string | undefined {
  if (env.DTK_UI_TOKEN) return env.DTK_UI_TOKEN;
  let data: unknown;
  try {
    data = JSON.parse(readFile(runtimeFilePath(env)));
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  const { url, token } = data as { url?: unknown; token?: unknown };
  if (typeof url !== "string" || typeof token !== "string" || !token)
    return undefined;
  const want = hostPort(proxyTarget);
  return want !== null && hostPort(url) === want ? token : undefined;
}

/** Dev only: hand the page the bridge token; none resolved, no meta, bridge off. */
export function uiTokenMeta(proxyTarget: string): Plugin {
  return {
    name: "dtk-ui-token-meta",
    apply: "serve", // never bake a token into `vite build` output
    transformIndexHtml() {
      // Per request: the engine may restart with a new token.
      const token = resolveUiToken(proxyTarget);
      if (!token) return [];
      return [
        {
          tag: "meta",
          attrs: { name: "dtk-ui-token", content: token },
          injectTo: "head",
        },
      ];
    },
  };
}

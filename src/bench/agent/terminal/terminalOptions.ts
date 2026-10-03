import { uiAuthHeaders, uiError, uiUrl } from "../../../api/client";

export interface TerminalPack {
  id: string;
  title: string;
  available: boolean;
  reason: string | null;
}

/**
 * Terminal packs from `GET /api/ui/agent/options` (`panel: "terminal"`, engine
 * docs "Options and per-session selection"). An engine without the route (404)
 * or without terminal packs gives `[]`.
 */
export async function getTerminalPacks(token: string): Promise<TerminalPack[]> {
  const res = await fetch(uiUrl("/agent/options"), {
    headers: uiAuthHeaders(token),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw await uiError(res, "GET /ui/agent/options");
  return parseTerminalPacks(await res.json());
}

export function parseTerminalPacks(body: unknown): TerminalPack[] {
  const packs = (body as { packs?: unknown } | null)?.packs;
  if (!Array.isArray(packs)) return [];
  const out: TerminalPack[] = [];
  for (const p of packs as Record<string, unknown>[]) {
    if (p?.panel !== "terminal" || typeof p.id !== "string") continue;
    out.push({
      id: p.id,
      title: typeof p.title === "string" ? p.title : p.id,
      available: p.available === true,
      reason: typeof p.reason === "string" ? p.reason : null,
    });
  }
  return out;
}

import type { AgentOptions, AgentStatus, PackMode, PackOption } from "./protocol";

/** Pure helpers behind the mode / pack / model selector (datatoolkit-issues#114). */

export const MODE_ORDER: PackMode[] = ["api", "cli", "test"];

const MODE_LABEL: Record<PackMode, string> = {
  api: "API (direct)",
  cli: "CLI",
  test: "Test",
};

export const modeLabel = (mode: PackMode): string => MODE_LABEL[mode];

/** A pack the chat panel can run now (terminal packs wait for the terminal panel). */
export const selectable = (p: PackOption): boolean => p.available && p.panel === "chat";

/** Modes present in the options, in display order. */
export function modesOf(options: AgentOptions): PackMode[] {
  return MODE_ORDER.filter((m) => options.packs.some((p) => p.mode === m));
}

export const packsFor = (options: AgentOptions, mode: PackMode): PackOption[] =>
  options.packs.filter((p) => p.mode === mode);

/** The session's pack: the status first, else the engine default. */
export function currentPack(options: AgentOptions, status: AgentStatus): PackOption | null {
  const id = status.pack ?? options.default.pack;
  return options.packs.find((p) => p.id === id) ?? null;
}

/** First pack of `mode` that can run now (null = the mode is greyed out). */
export function firstSelectable(options: AgentOptions, mode: PackMode): PackOption | null {
  return packsFor(options, mode).find(selectable) ?? null;
}

/** "Claude (Agent SDK) — claude CLI not logged in" / "… — terminal, weaker guarantee". */
export function packLabel(p: PackOption): string {
  const notes: string[] = [];
  if (p.panel === "terminal") notes.push("terminal, weaker guarantee");
  if (!p.available) notes.push(p.reason ?? "unavailable");
  return notes.length ? `${p.title} — ${notes.join(" · ")}` : p.title;
}

/** Status line: "Claude (Agent SDK) · sonnet · via claude CLI". */
export function whoLine(status: AgentStatus): string {
  return [status.title ?? status.pack, status.model].filter(Boolean).join(" · ");
}

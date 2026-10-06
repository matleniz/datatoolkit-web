import { describe, expect, it } from "vitest";

import {
  currentPack,
  firstSelectable,
  modesOf,
  packLabel,
  packsFor,
  selectable,
  whoLine,
} from "../src/bench/agent/panel/picker";
import { parseAgentEvent, parseAgentOptions, parseAgentStatus } from "../src/bench/agent/panel/protocol";
import { EMPTY_TRANSCRIPT, transcriptReducer } from "../src/bench/agent/panel/transcript";

const RAW = {
  default: { pack: "agent-sdk", model: null },
  packs: [
    {
      id: "agent-sdk",
      title: "Claude (Agent SDK)",
      mode: "cli",
      panel: "chat",
      available: true,
      reason: null,
      provider: "Claude (claude.ai login)",
      default_model: null,
      models: [{ id: "sonnet", label: "Sonnet 5.5", resolved: "claude-sonnet-5-5" }, { label: "no id" }, 3],
      model_free_text: false,
    },
    {
      id: "api-anthropic",
      title: "Anthropic API",
      mode: "api",
      panel: "chat",
      available: false,
      reason: "ANTHROPIC_API_KEY is not set",
      default_model: null,
      models: [],
      model_free_text: true,
      models_error: "no key",
    },
    { id: "claude-code", title: "Claude Code", mode: "cli", panel: "terminal", available: false, reason: "terminal off: set DTK_AGENT_TERMINAL=1", models: [] },
  ],
};

describe("agent options parser (#114)", () => {
  const options = parseAgentOptions(RAW)!;

  it("parses packs and models", () => {
    expect(options.default).toEqual({ pack: "agent-sdk", model: null });
    expect(options.packs.map((p) => p.id)).toEqual(["agent-sdk", "api-anthropic", "claude-code"]);
    expect(options.packs[0]?.models).toEqual([
      { id: "sonnet", label: "Sonnet 5.5", description: undefined, resolved: "claude-sonnet-5-5" },
    ]);
    expect(options.packs[1]).toMatchObject({ available: false, modelFreeText: true, modelsError: "no key" });
  });

  it("drops unknown and malformed entries", () => {
    const parsed = parseAgentOptions({
      packs: [
        null,
        "x",
        { id: "a" },
        { id: "b", title: "B", mode: "weird", panel: "chat" },
        { id: "c", title: "C", mode: "api", panel: "popup" },
        { id: "d", title: "D", mode: "api", panel: "chat", available: true },
        { id: "d", title: "dup", mode: "api", panel: "chat" },
      ],
    })!;
    expect(parsed.packs.map((p) => p.id)).toEqual(["d"]);
    expect(parsed.default).toEqual({ pack: null, model: null });
  });

  it("reads anything else as no options", () => {
    expect(parseAgentOptions(null)).toBeNull();
    expect(parseAgentOptions({})).toBeNull();
    expect(parseAgentOptions({ packs: "x" })).toBeNull();
  });

  it("orders modes, filters packs, picks the first runnable pack", () => {
    expect(modesOf(options)).toEqual(["api", "cli"]);
    expect(packsFor(options, "cli").map((p) => p.id)).toEqual(["agent-sdk", "claude-code"]);
    expect(firstSelectable(options, "api")).toBeNull();
    expect(firstSelectable(options, "cli")?.id).toBe("agent-sdk");
    expect(options.packs.map(selectable)).toEqual([true, false, false]);
  });

  it("labels unavailable and terminal packs", () => {
    expect(packLabel(options.packs[0]!)).toBe("Claude (Agent SDK)");
    expect(packLabel(options.packs[1]!)).toBe("Anthropic API — ANTHROPIC_API_KEY is not set");
    expect(packLabel(options.packs[2]!)).toContain("terminal, weaker guarantee");
  });

  it("follows the session's pack, else the engine default", () => {
    expect(currentPack(options, parseAgentStatus({ pack: "api-anthropic" }))?.id).toBe("api-anthropic");
    expect(currentPack(options, parseAgentStatus({}))?.id).toBe("agent-sdk");
  });

  it("reads the v2 status fields", () => {
    const status = parseAgentStatus({ available: true, pack: "agent-sdk", title: "Claude", model: "sonnet", mode: "cli", panel: "chat" });
    expect(status).toMatchObject({ title: "Claude", mode: "cli", panel: "chat" });
    expect(whoLine(status)).toBe("Claude · sonnet");
  });

  it("folds a config event: reset starts a new conversation, usage kept", () => {
    const ev = parseAgentEvent({ type: "config", pack: "api-anthropic", model: null, reset: true })!;
    expect(ev).toEqual({ type: "config", pack: "api-anthropic", model: null, reset: true });
    const t = transcriptReducer(
      { ...EMPTY_TRANSCRIPT, usage: { input: 5, output: 6, cacheWrite: 0, cacheRead: 0 }, items: [{ kind: "user", key: "m1", text: "hi" }] },
      { type: "event", event: ev },
    );
    expect(t.items).toEqual([]);
    expect(t.usage).toEqual({ input: 5, output: 6, cacheWrite: 0, cacheRead: 0 });
  });
});

import { useState } from "react";

import {
  currentPack,
  firstSelectable,
  modeLabel,
  modesOf,
  packLabel,
  packsFor,
  selectable,
} from "./picker";
import type { AgentOptions, AgentStatus } from "./protocol";

/**
 * Mode (API / CLI) -> pack -> model selector of the agent panel
 * (datatoolkit-issues#114). Disabled while a turn runs (the engine answers
 * 409 anyway). Unavailable packs are listed with their reason.
 */
export function AgentPicker({
  options,
  status,
  busy,
  error,
  onPick,
}: {
  options: AgentOptions;
  status: AgentStatus;
  busy: boolean;
  error: string | null;
  onPick: (pack: string, model: string | null) => void;
}) {
  const pack = currentPack(options, status);
  const mode = pack?.mode ?? modesOf(options)[0];
  const model = status.model ?? "";
  const [typed, setTyped] = useState<string | null>(null);
  if (!mode) return null;

  const commitTyped = () => {
    if (pack && typed !== null && typed !== model) onPick(pack.id, typed.trim() || null);
    setTyped(null);
  };

  return (
    <div className="agent-picker" data-agent-picker>
      <label className="agent-pick">
        <span>Mode</span>
        <select
          aria-label="Agent mode"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            const next = firstSelectable(options, e.target.value as typeof mode);
            if (next) onPick(next.id, null);
          }}
        >
          {modesOf(options).map((m) => (
            <option key={m} value={m} disabled={!firstSelectable(options, m)}>
              {modeLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="agent-pick">
        <span>Agent</span>
        <select
          aria-label="Agent pack"
          value={pack?.id ?? ""}
          disabled={busy}
          onChange={(e) => onPick(e.target.value, null)}
        >
          {pack ? null : <option value="">—</option>}
          {packsFor(options, mode).map((p) => (
            <option key={p.id} value={p.id} disabled={!selectable(p) && p.id !== pack?.id}>
              {packLabel(p)}
            </option>
          ))}
        </select>
      </label>
      {pack ? (
        <label className="agent-pick">
          <span>Model</span>
          {pack.modelFreeText ? (
            <>
              <input
                aria-label="Agent model"
                list="agent-model-list"
                placeholder={pack.defaultModel ?? "provider default"}
                value={typed ?? model}
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={commitTyped}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTyped();
                }}
              />
              <datalist id="agent-model-list">
                {pack.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </datalist>
            </>
          ) : (
            <select
              aria-label="Agent model"
              value={model}
              disabled={busy}
              onChange={(e) => onPick(pack.id, e.target.value || null)}
            >
              <option value="">Default{pack.defaultModel ? ` (${pack.defaultModel})` : ""}</option>
              {pack.models.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </label>
      ) : null}
      {pack?.modelsError ? <p className="agent-pick-note">Model list unavailable: {pack.modelsError}</p> : null}
      {error ? <p className="agent-pick-note error" role="alert">{error}</p> : null}
    </div>
  );
}

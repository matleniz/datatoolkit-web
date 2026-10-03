import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState } from "react";

import { uiToken } from "../../../api/client";
import { setTerminalPanelOpen, useTerminalPanelOpen } from "./terminalOpen";
import { getTerminalPacks, type TerminalPack } from "./terminalOptions";
import { terminalUrl } from "./terminalProtocol";
import { TerminalSocket, type TerminalState } from "./terminalSocket";
import "./TerminalPanel.css";

const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";

/** Same per-tab id as the agent chat and the AgentBridge context. */
function uiSession(): string {
  const key = "dtk-ui-session";
  const known = window.sessionStorage.getItem(key);
  if (known) return known;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(key, id);
  return id;
}

/**
 * Opt-in terminal panel (datatoolkit-issues#115): a CLI agent (claude, gemini,
 * opencode) running as-is in the engine's PTY, rendered natively by xterm.js.
 * Closing the panel closes the socket, which ends the session. Studio handles
 * no credentials: the CLI uses its own login on the engine's machine.
 */
export function TerminalPanel() {
  const open = useTerminalPanelOpen();
  const token = useMemo(uiToken, []);
  if (!open) return null;
  return (
    <aside className="terminal-panel" aria-label="Terminal">
      {token ? <Launcher token={token} /> : <NoToken />}
    </aside>
  );
}

function Head({ pack }: { pack?: string | null }) {
  return (
    <header className="terminal-panel-head">
      <strong>Terminal</strong>
      {pack ? <span className="terminal-panel-who">{pack}</span> : null}
      <span
        className="terminal-badge"
        data-terminal-badge
        title="The CLI's own built-in tools (shell, file edits) are only disabled as far as that CLI allows."
      >
        weaker guarantee
      </span>
      <button
        type="button"
        className="agent-panel-close"
        aria-label="Close terminal panel"
        onClick={() => setTerminalPanelOpen(false)}
      >
        ×
      </button>
    </header>
  );
}

type Packs = { state: "loading" } | { state: "ready"; packs: TerminalPack[] } | { state: "error"; message: string };

/** Pick a terminal pack, then start it: nothing runs until the user asks. */
function Launcher({ token }: { token: string }) {
  const [packs, setPacks] = useState<Packs>({ state: "loading" });
  const [choice, setChoice] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setPacks({ state: "loading" });
    getTerminalPacks(token).then(
      (list) => {
        if (!live) return;
        setPacks({ state: "ready", packs: list });
        setChoice((c) => c || list.find((p) => p.available)?.id || "");
      },
      (e: unknown) => live && setPacks({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  if (running) return <Session token={token} pack={running} onStop={() => setRunning(null)} />;
  const list = packs.state === "ready" ? packs.packs : [];
  const chosen = list.find((p) => p.id === choice);
  return (
    <>
      <Head />
      <div className="agent-absent" data-terminal-launcher>
        {packs.state === "loading" ? <span>Looking for terminal packs…</span> : null}
        {packs.state === "error" ? <p>{packs.message}</p> : null}
        {packs.state === "ready" && list.length === 0 ? (
          <p>
            This engine offers no terminal pack. Start it with <code>DTK_AGENT_TERMINAL=1</code>{" "}
            (or <code>dtk-api --terminal</code>) and <code>DTK_AGENT_PACK</code> set.
          </p>
        ) : null}
        {list.length > 0 ? (
          <>
            <p>
              Runs a CLI agent as-is on the engine&apos;s machine, with its own login. Its built-in
              tools are only disabled as far as that CLI allows (<strong>weaker guarantee</strong>
              {" "}than the chat panel).
            </p>
            <label>
              Pack{" "}
              <select aria-label="Terminal pack" value={choice} onChange={(e) => setChoice(e.target.value)}>
                {list.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.title}
                    {p.available ? "" : " (unavailable)"}
                  </option>
                ))}
              </select>
            </label>
            {chosen && !chosen.available && chosen.reason ? <p>{chosen.reason}</p> : null}
            <button
              type="button"
              className="btn-primary"
              disabled={!chosen?.available}
              onClick={() => setRunning(choice)}
            >
              Start
            </button>
          </>
        ) : null}
        {packs.state !== "loading" ? (
          <button type="button" className="btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
            Check again
          </button>
        ) : null}
      </div>
    </>
  );
}

function NoToken() {
  return (
    <>
      <Head />
      <div className="agent-absent" data-agent-absent>
        <strong>Agent bridge off</strong>
        <p>
          This page has no bridge token. Start Studio with <code>dtk-studio</code>, or set the
          same <code>DTK_UI_TOKEN</code> for <code>dtk-api</code> and <code>npm run dev</code>.
        </p>
      </div>
    </>
  );
}

function statusText(state: TerminalState, detail?: { code?: number | null; message?: string }) {
  if (state === "connecting") return "Connecting…";
  if (state === "ended") {
    return detail?.code == null ? "Session ended." : `Session ended (exit code ${detail.code}).`;
  }
  if (state === "dropped") return detail?.message ?? "Connection lost.";
  return "";
}

function Session({ token, pack: packId, onStop }: { token: string; pack: string; onStop: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TerminalState>("connecting");
  const [detail, setDetail] = useState<{ code?: number | null; message?: string }>();
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setState("connecting");
    setDetail(undefined);
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // The engine takes the initial size on the URL, so fit before connecting.
    try {
      fit.fit();
    } catch {
      /* not laid out yet: the default size, corrected by the first resize */
    }
    const socket = new TerminalSocket(
      terminalUrl(
        { session: uiSession(), token, pack: packId, cols: term.cols, rows: term.rows },
        API_BASE,
        window.location.origin,
      ),
      {
        onState: (s, d) => {
          setState(s);
          setDetail(d);
        },
        onStarted: setStarted,
        onOutput: (data) => term.write(data),
      },
    );
    const sendSize = () => {
      try {
        fit.fit();
      } catch {
        return; // not laid out yet (hidden / zero size)
      }
      socket.resize(term.cols, term.rows);
    };
    term.onData((d) => socket.input(d));
    sendSize();
    const observer = new ResizeObserver(sendSize);
    observer.observe(el);
    term.focus();
    return () => {
      observer.disconnect();
      socket.close();
      term.dispose();
    };
  }, [token, packId, attempt]);

  const over = state === "ended" || state === "dropped";
  return (
    <>
      <Head pack={started ?? packId} />
      <div className="terminal-body">
        <div className="terminal-host" ref={host} data-terminal-host aria-label="Terminal output" />
        {state === "connecting" || over ? (
          <div className="terminal-status" data-terminal-state={state} role="status">
            <span>{statusText(state, detail)}</span>
            {over ? (
              <>
              <button type="button" className="btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
                {state === "dropped" ? "Reconnect" : "Start again"}
              </button>
              <button type="button" className="btn-secondary" onClick={onStop}>
                Change pack
              </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState } from "react";

import { uiToken } from "../../../api/client";
import { setTerminalPanelOpen, useTerminalPanelOpen } from "./terminalOpen";
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
      {token ? <Session token={token} /> : <NoToken />}
    </aside>
  );
}

function Head({ pack, children }: { pack?: string | null; children?: React.ReactNode }) {
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
      {children}
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

function Session({ token }: { token: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TerminalState>("connecting");
  const [detail, setDetail] = useState<{ code?: number | null; message?: string }>();
  const [pack, setPack] = useState<string | null>(null);

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
    const socket = new TerminalSocket(
      terminalUrl(uiSession(), token, API_BASE, window.location.origin),
      {
        onState: (s, d) => {
          setState(s);
          setDetail(d);
        },
        onReady: setPack,
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
  }, [token, attempt]);

  const over = state === "ended" || state === "dropped";
  return (
    <>
      <Head pack={pack} />
      <div className="terminal-body">
        <div className="terminal-host" ref={host} data-terminal-host aria-label="Terminal output" />
        {state === "connecting" || over ? (
          <div className="terminal-status" data-terminal-state={state} role="status">
            <span>{statusText(state, detail)}</span>
            {over ? (
              <button type="button" className="btn-secondary" onClick={() => setAttempt((n) => n + 1)}>
                {state === "dropped" ? "Reconnect" : "Start again"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

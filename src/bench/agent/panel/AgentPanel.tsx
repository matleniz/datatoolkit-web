import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { uiToken } from "../../../api/client";
import { AgentPicker } from "./AgentPicker";
import { MessageItem } from "./MessageItem";
import { setAgentPanelOpen, useAgentPanelOpen } from "./panelOpen";
import { whoLine } from "./picker";
import type { AgentStatus } from "./protocol";
import { formatTokens, formatUsage } from "./transcript";
import { useAgentChat, type AgentChat } from "./useAgentChat";
import "./AgentPanel.css";

/**
 * In-Studio agent panel (datatoolkit-issues#67): a side panel between the
 * inspector and the tool rail, opened by the rail's Agent icon. Chat with the
 * engine's agent pack over the UI bridge; the chat stays alive while the
 * panel is closed (events keep folding in).
 */
export function AgentPanel() {
  const token = useMemo(uiToken, []);
  const open = useAgentPanelOpen();
  if (!token) {
    return open ? (
      <PanelShell>
        <Absent title="Agent bridge off">
          This page has no bridge token. Start Studio with <code>dtk-studio</code>, or set the
          same <code>DTK_UI_TOKEN</code> for <code>dtk-api</code> and <code>npm run dev</code>.
        </Absent>
      </PanelShell>
    ) : null;
  }
  return <ChatPanel token={token} open={open} />;
}

function PanelShell({ status, children }: { status?: AgentStatus; children: React.ReactNode }) {
  const who = status?.available ? whoLine(status) : "";
  return (
    <aside className="agent-panel" aria-label="Agent">
      <header className="agent-panel-head">
        <strong>Agent</strong>
        {who ? (
          <span className="agent-panel-who" data-agent-who title={status?.provider}>
            {who}
          </span>
        ) : null}
        <button
          type="button"
          className="agent-panel-close"
          aria-label="Close agent panel"
          onClick={() => setAgentPanelOpen(false)}
        >
          ×
        </button>
      </header>
      {children}
    </aside>
  );
}

function Absent({ title, children, onRetry }: {
  title: string;
  children: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="agent-absent" data-agent-absent>
      <strong>{title}</strong>
      <p>{children}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Check again
        </button>
      ) : null}
    </div>
  );
}

function ChatPanel({ token, open }: { token: string; open: boolean }) {
  const chat = useAgentChat(token);
  const { link, refresh } = chat;
  // Re-check the pack each time the panel opens (the engine may have restarted).
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);
  if (!open) return null;

  if (link.state === "loading") {
    return (
      <PanelShell>
        <div className="agent-absent">Connecting…</div>
      </PanelShell>
    );
  }
  if (link.state === "unreachable") {
    return (
      <PanelShell>
        <Absent title="Engine unreachable" onRetry={refresh}>
          {link.message}
        </Absent>
      </PanelShell>
    );
  }
  const picker = link.options ? (
    <AgentPicker
      options={link.options}
      status={link.status}
      busy={chat.transcript.running}
      error={chat.configError}
      onPick={chat.configure}
    />
  ) : null;
  if (!link.status.available) {
    return (
      <PanelShell>
        {picker}
        <Absent title="No agent" onRetry={refresh}>
          {link.status.reason ?? "The engine runs without an agent pack."}
          {link.status.pack === null ? (
            <>
              {" "}Start it with <code>DTK_AGENT_PACK=agent-sdk</code> (or{" "}
              <code>dtk-api --agent</code>) and a logged-in <code>claude</code> CLI (or{" "}
              <code>ANTHROPIC_API_KEY</code>).
            </>
          ) : null}
        </Absent>
      </PanelShell>
    );
  }
  return (
    <PanelShell status={link.status}>
      {picker}
      <Conversation chat={chat} status={link.status} />
    </PanelShell>
  );
}

function Conversation({ chat, status }: { chat: AgentChat; status: AgentStatus }) {
  const { transcript, send, stop, reply, clear } = chat;
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.items]);

  const submit = () => {
    const text = draft.trim();
    if (!text || transcript.running) return;
    send(text);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };
  const cap = status.maxTokens ? ` · cap ${formatTokens(status.maxTokens)}` : "";

  return (
    <>
      <div className="agent-messages" ref={listRef} aria-label="Agent conversation" aria-live="polite">
        {transcript.items.length === 0 ? (
          <p className="agent-hint">
            Ask about the data on screen or for a step, e.g. “open the distribution of age by
            cohort” or “impute ledd with the median”. Step edits apply at once with Undo; destructive ones wait for your review.
            {status.provider ? ` What the agent reads is sent to ${status.provider}.` : ""}
          </p>
        ) : null}
        {transcript.items.map((item) => (
          <MessageItem key={item.key} item={item} onReply={reply} />
        ))}
        {transcript.running ? <div className="agent-typing" aria-label="Agent is working">…</div> : null}
      </div>
      <footer className="agent-panel-foot">
        <textarea
          className="agent-input"
          aria-label="Message the agent"
          placeholder="Message the agent (Enter to send, Shift+Enter for a new line)"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="agent-foot-row">
          <span className="agent-usage" data-agent-usage title="Tokens used this session">
            {formatUsage(transcript.usage)}
            {cap}
          </span>
          {transcript.items.length > 0 && !transcript.running ? (
            <button type="button" className="btn-secondary" onClick={clear}>
              Clear
            </button>
          ) : null}
          {transcript.running ? (
            <button type="button" className="btn-secondary agent-stop" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={!draft.trim()}
              onClick={submit}
            >
              Send
            </button>
          )}
        </div>
      </footer>
    </>
  );
}

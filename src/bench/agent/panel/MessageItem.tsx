import { useRef } from "react";

import { useAppDispatch, useAppState } from "../../../state/AppStore";
import { inlineCode, splitBlocks } from "./blocks";
import { chipJump, chipLabel, chipTarget } from "./chips";
import type { TranscriptItem } from "./transcript";

/** How long a chip click highlights what it points at (same as AgentBridge). */
const TOUCH_MS = 2_000;

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {splitBlocks(text).map((b, i) =>
        b.kind === "code" ? (
          <pre key={i} className="agent-code" data-lang={b.lang || undefined}>
            <code>{b.code}</code>
          </pre>
        ) : (
          <p key={i}>
            {inlineCode(b.text).map((part, j) =>
              typeof part === "string" ? part : <code key={j}>{part.code}</code>,
            )}
          </p>
        ),
      )}
    </>
  );
}

const STATUS_TEXT = {
  running: "running…",
  review: "waiting for your review in Studio",
  applied: "applied after your review",
  rejected: "dismissed in Studio",
  ok: "done",
  error: "failed",
} as const;

function ToolChip({ item }: { item: Extract<TranscriptItem, { kind: "tool" }> }) {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const timer = useRef<number | undefined>(undefined);
  const target = chipTarget(item.name, item.input);
  const failed = item.status === "error" || item.status === "rejected";
  const jump = failed ? null : chipJump(target, workspace?.steps ?? []);
  const detail = item.error ?? item.summary;

  const go = () => {
    if (!jump) return;
    jump.actions.forEach(dispatch);
    const { columns = [], tools = [], steps = [] } = jump.touch;
    const at = Date.now();
    dispatch({ type: "AGENT_TOUCH", touch: { columns, tools, steps, rows: [], cells: [], at } });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dispatch({ type: "AGENT_TOUCH_CLEAR", at }), TOUCH_MS);
  };

  return (
    <div className={`agent-chip ${item.status}`} data-tool-call={item.name}>
      <button
        type="button"
        className="agent-chip-btn"
        disabled={!jump}
        title={jump ? "Show what this call touched" : undefined}
        onClick={go}
      >
        <span className="agent-chip-dot" aria-hidden="true" />
        <span className="agent-chip-label">{chipLabel(item.name, target)}</span>
      </button>
      <span className="agent-chip-status">{STATUS_TEXT[item.status]}</span>
      {detail ? <span className="agent-chip-detail">{detail}</span> : null}
    </div>
  );
}

/** Same look as AgentBridge's review banner (`agent-review` / `agent-actions`). */
function PermissionCard({
  item,
  onReply,
}: {
  item: Extract<TranscriptItem, { kind: "permission" }>;
  onReply: (id: string, allow: boolean) => void;
}) {
  return (
    <section className="agent-review agent-permission" aria-label="Agent permission request">
      <strong>Agent asks to run {item.tool}: {item.summary}</strong>
      {item.lines.length ? (
        <ul>
          {item.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {item.status === "pending" ? (
        <div className="agent-actions">
          <button type="button" className="btn-primary" onClick={() => onReply(item.id, true)}>
            Allow
          </button>
          <button type="button" className="btn-secondary" onClick={() => onReply(item.id, false)}>
            Deny
          </button>
        </div>
      ) : (
        <div className="agent-permission-done">{item.status === "allowed" ? "Allowed" : "Denied"}</div>
      )}
    </section>
  );
}

export function MessageItem({
  item,
  onReply,
}: {
  item: TranscriptItem;
  onReply: (id: string, allow: boolean) => void;
}) {
  switch (item.kind) {
    case "user":
      return (
        <div className="agent-msg user" data-role="user">
          <Paragraphs text={item.text} />
        </div>
      );
    case "assistant":
      return (
        <div className="agent-msg assistant" data-role="assistant">
          <Paragraphs text={item.text} />
        </div>
      );
    case "tool":
      return <ToolChip item={item} />;
    case "permission":
      return <PermissionCard item={item} onReply={onReply} />;
    case "error":
      return (
        <div className="agent-msg error" role="alert">
          {item.message}
        </div>
      );
  }
}

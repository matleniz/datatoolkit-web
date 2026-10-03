import { useId, useMemo, useRef, useState } from "react";

import { useAppDispatch, useAppState } from "../../../state/AppStore";
import { chipJump, chipLabel, chipTarget } from "./chips";
import { renderMarkdown } from "./markdown";
import { LINES_MAX, summaryLines } from "./toolSummary";
import type { TranscriptItem } from "./transcript";

/** How long a chip click highlights what it points at (same as AgentBridge). */
const TOUCH_MS = 2_000;

/** User text stays plain (no Markdown); `pre-wrap` keeps its line breaks. */
function PlainText({ text }: { text: string }) {
  return <p>{text}</p>;
}

/** The sanitised output of `renderMarkdown` (see markdown.ts). */
function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="agent-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const STATUS_TEXT = {
  running: "running…",
  review: "waiting for your review in Studio",
  applied: "applied after your review",
  rejected: "dismissed in Studio",
  ok: "done",
  error: "failed",
} as const;

/** One value, cut with a "show more" toggle when long. */
function Value({ line }: { line: ReturnType<typeof summaryLines>[number] }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <span className="agent-kv-value">{more ? line.full : line.short}</span>
      {line.truncated ? (
        <button type="button" className="agent-more" onClick={() => setMore(!more)}>
          {more ? "show less" : "show more"}
        </button>
      ) : null}
    </>
  );
}

function ToolDetails({ item, id }: { item: Extract<TranscriptItem, { kind: "tool" }>; id: string }) {
  const [allInput, setAllInput] = useState(false);
  const lines = summaryLines(item.input);
  const shown = allInput ? lines : lines.slice(0, LINES_MAX);
  const output = item.error ?? item.summary;
  return (
    <div className="agent-chip-body" id={id}>
      <div className="agent-chip-section">Input</div>
      {lines.length === 0 ? <div className="agent-kv-empty">(none)</div> : null}
      {shown.map((line) => (
        <div key={line.key} className="agent-kv">
          <span className="agent-kv-key">{line.key}:</span> <Value line={line} />
        </div>
      ))}
      {lines.length > shown.length ? (
        <button type="button" className="agent-more" onClick={() => setAllInput(true)}>
          +{lines.length - shown.length} more
        </button>
      ) : null}
      <div className="agent-chip-section">Output</div>
      {output ? (
        <div className={`agent-kv${item.error ? " error" : ""}`}>
          <Value line={summaryLines({ output })[0]!} />
        </div>
      ) : (
        <div className="agent-kv-empty">{item.status === "running" ? "(running…)" : "(none)"}</div>
      )}
    </div>
  );
}

/**
 * Collapsed by default (datatoolkit-issues#113): one line with the label, the
 * status and, for a failed call, its error; the toggle expands input / output.
 * "Show" keeps the jump / highlight of what the call touched.
 */
function ToolChip({ item }: { item: Extract<TranscriptItem, { kind: "tool" }> }) {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const target = chipTarget(item.name, item.input);
  const failed = item.status === "error" || item.status === "rejected";
  const jump = failed ? null : chipJump(target, workspace?.steps ?? []);

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
      <div className="agent-chip-row">
        <button
          type="button"
          className="agent-chip-btn"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen(!open)}
        >
          <span className="agent-chip-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="agent-chip-dot" aria-hidden="true" />
          <span className="agent-chip-label">{chipLabel(item.name, target)}</span>
          <span className="agent-chip-status">{STATUS_TEXT[item.status]}</span>
        </button>
        {jump ? (
          <button
            type="button"
            className="agent-chip-jump"
            title="Show what this call touched"
            onClick={go}
          >
            Show
          </button>
        ) : null}
      </div>
      {!open && item.error ? <div className="agent-chip-detail">{item.error}</div> : null}
      {open ? <ToolDetails item={item} id={bodyId} /> : null}
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
          <PlainText text={item.text} />
        </div>
      );
    case "assistant":
      return (
        <div className="agent-msg assistant" data-role="assistant">
          <Markdown text={item.text} />
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

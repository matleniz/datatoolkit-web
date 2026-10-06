import { useState } from "react";

import { MEMORY_KINDS, type MemoryEntry, type MemoryKind } from "../../../api/types";
import { useAppDispatch, useAppState } from "../../../state/AppStore";
import {
  MEMORY_MAX_CHARS,
  MEMORY_TEXT_MAX,
  memoryCapError,
  memoryChars,
  withMemoryEntry,
} from "../../../state/memory";
import { nowIso } from "../../../state/memoryCommands";

/**
 * "Agent memory" view of the agent panel (datatoolkit-issues#179): the open
 * workspace's memory entries, edited / deleted / cleared through the reducer
 * (one pipeline undo entry each) and saved with the workspace.
 */
export function MemoryView() {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState<string | null>(null);

  if (!workspace) {
    return <p className="agent-memory-empty">Open a workspace to see its agent memory.</p>;
  }
  const entries = workspace.memory ?? [];
  const clear = () => {
    const n = entries.length;
    if (window.confirm(`Clear the agent memory of “${workspace.name}” (${n} ${n === 1 ? "entry" : "entries"})?`)) {
      dispatch({ type: "CLEAR_MEMORY" });
    }
  };

  return (
    <section className="agent-memory" aria-label="Agent memory">
      <p className="agent-memory-hint">
        What the agent reads at the start of each chat in “{workspace.name}”. It adds and updates
        entries itself (with Undo); edit or delete them here.
      </p>
      {entries.length === 0 ? (
        <p className="agent-memory-empty">No memory yet.</p>
      ) : (
        <ul className="agent-memory-list">
          {entries.map((entry) =>
            editing === entry.id ? (
              <MemoryEditor
                key={entry.id}
                entry={entry}
                entries={entries}
                onDone={() => setEditing(null)}
              />
            ) : (
              <MemoryRow
                key={entry.id}
                entry={entry}
                onEdit={() => setEditing(entry.id)}
                onDelete={() => dispatch({ type: "REMOVE_MEMORY_ENTRY", id: entry.id })}
              />
            ),
          )}
        </ul>
      )}
      <div className="agent-memory-foot">
        <span className="agent-memory-usage" data-memory-usage>
          {entries.length} {entries.length === 1 ? "entry" : "entries"} ·{" "}
          {memoryChars(entries)} / {MEMORY_MAX_CHARS} chars
        </span>
        {entries.length > 0 ? (
          <button type="button" className="btn-secondary" onClick={clear}>
            Clear memory
          </button>
        ) : null}
      </div>
    </section>
  );
}

function MemoryRow({ entry, onEdit, onDelete }: {
  entry: MemoryEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="agent-memory-item" data-memory-id={entry.id}>
      <span className={`agent-memory-kind kind-${entry.kind}`}>{entry.kind}</span>
      <span className="agent-memory-text">{entry.text}</span>
      <span className="agent-memory-actions">
        <button type="button" className="agent-memory-btn" aria-label={`Edit memory ${entry.id}`} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="agent-memory-btn" aria-label={`Delete memory ${entry.id}`} onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}

function MemoryEditor({ entry, entries, onDone }: {
  entry: MemoryEntry;
  entries: MemoryEntry[];
  onDone: () => void;
}) {
  const dispatch = useAppDispatch();
  const [text, setText] = useState(entry.text);
  const [kind, setKind] = useState<MemoryKind>(entry.kind);
  const trimmed = text.trim();
  const next: MemoryEntry = { id: entry.id, text: trimmed, kind, updated_at: nowIso() };
  const error = trimmed ? memoryCapError(withMemoryEntry(entries, next)) : "the text is empty";
  const save = () => {
    if (error) return;
    if (trimmed !== entry.text || kind !== entry.kind) dispatch({ type: "SET_MEMORY_ENTRY", entry: next });
    onDone();
  };
  return (
    <li className="agent-memory-item editing" data-memory-id={entry.id}>
      <select
        aria-label="Memory kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as MemoryKind)}
      >
        {MEMORY_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <textarea
        aria-label="Memory text"
        className="agent-memory-input"
        value={text}
        maxLength={MEMORY_TEXT_MAX}
        rows={3}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
        }}
      />
      {error ? <span className="agent-memory-error">Cannot save: {error}</span> : null}
      <span className="agent-memory-actions">
        <button type="button" className="btn-primary" disabled={!!error} onClick={save}>
          Save
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </span>
    </li>
  );
}

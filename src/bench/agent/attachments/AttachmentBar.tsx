import { useRef } from "react";

import { formatSize, type Attachment } from "./attachmentState";
import type { Attachments } from "./useAttachments";
import "./attachments.css";

/** Attach button (file picker) plus one chip per file; names render as text only. */
export function AttachmentBar({ attachments, disabled }: { attachments: Attachments; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { items, addFiles, remove } = attachments;
  return (
    <div className="agent-attach-bar">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Attachment file"
        data-attach-input
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="btn-secondary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Attach
      </button>
      {items.map((a) => (
        <Chip key={a.id} item={a} onRemove={() => remove(a.id)} />
      ))}
    </div>
  );
}

function Chip({ item, onRemove }: { item: Attachment; onRemove: () => void }) {
  return (
    <span
      className="agent-attach-chip"
      data-attachment={item.status}
      title={item.status === "failed" ? item.error : item.name}
    >
      <span className="agent-attach-name">{item.name}</span>
      <span className="agent-attach-meta">
        {formatSize(item.size)} · {item.status === "failed" ? "failed" : item.status === "ready" ? "ready" : "uploading…"}
      </span>
      <button type="button" aria-label={`Remove ${item.name}`} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

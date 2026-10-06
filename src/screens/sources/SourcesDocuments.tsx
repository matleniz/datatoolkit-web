import { useId, useState, type DragEvent } from "react";

import { apiClient, documentFileUrl } from "../../api/client";
import type { WorkspaceDocument } from "../../api/types";
import { formatSize } from "../../bench/agent/attachments/attachmentState";
import { NoteButton } from "../../bench/notes/NotePopover";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { keptDocument } from "../../state/documentCommands";
import { saveable } from "../../state/workspaceSaveGate";
import { engineMessage } from "./sourcesLogic";

const KIND_LABEL: Record<WorkspaceDocument["kind"], string> = {
  text: "text",
  pdf: "pdf",
  table: "table",
  other: "file",
};

/**
 * Documents section of the Sources card (datatoolkit-issues#178): reference
 * files stored with the workspace (upload refs), open / download, note,
 * remove; the agent lists and reads them in any chat. Each add / remove /
 * note is one pipeline undo entry, saved with the workspace.
 */
export function SourcesDocuments() {
  const { workspace } = useAppState();
  const dispatch = useAppDispatch();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  if (!workspace) return null;
  const documents = workspace.documents ?? [];
  const canAdd = saveable(workspace) && !busy;

  const add = async (files: File[]) => {
    if (!canAdd || files.length === 0) return;
    setBusy(true);
    setError(null);
    // Ids follow the documents added in this batch (dispatch renders later).
    const current = [...documents];
    try {
      for (const file of files) {
        const { path } = await apiClient.upload(file.name, file);
        const doc = await keptDocument(
          current,
          { name: file.name, path },
          (p, n) => apiClient.describeDocument(p, n),
          undefined,
          workspace.id_counters,
        );
        if (typeof doc === "string") throw new Error(doc.replace(/^bad_command: /, ""));
        if ("existing" in doc) continue;
        current.push(doc);
        dispatch({ type: "ADD_DOCUMENT", document: doc });
      }
    } catch (e) {
      setError(engineMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!canAdd || !e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      setOver(false);
      if (e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      void add(Array.from(e.dataTransfer.files));
    },
  };

  return (
    <div
      className={`sources-documents${over ? " drop-over" : ""}`}
      role="region"
      aria-label="Documents"
      data-documents-drop
      {...dropProps}
    >
      <div className="sources-documents-head">
        <span className="sources-documents-title">Documents</span>
        <span className="sources-documents-sub">
          Reference files kept with the workspace (data dictionary, protocol, paper). You and the
          agent can open them in any session.
        </span>
      </div>
      {documents.length > 0 ? (
        <ul className="sources-documents-list">
          {documents.map((d) => (
            <DocumentRow key={d.id} workspace={workspace.name} doc={d} />
          ))}
        </ul>
      ) : null}
      {error ? (
        <div className="sources-documents-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="sources-documents-foot">
        <input
          id={inputId}
          type="file"
          multiple
          style={{ display: "none" }}
          disabled={!canAdd}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void add(files);
          }}
        />
        <label
          htmlFor={inputId}
          className={`btn-add-file${canAdd ? "" : " disabled"}`}
          aria-disabled={!canAdd}
          title={saveable(workspace) ? undefined : "Add a train file first: documents are saved with the workspace"}
        >
          {busy ? "Adding…" : "+ Add a document (text, markdown, csv, pdf…)"}
        </label>
        <span className="sources-documents-hint">or drop files here</span>
      </div>
    </div>
  );
}

function DocumentRow({ workspace, doc }: { workspace: string; doc: WorkspaceDocument }) {
  const dispatch = useAppDispatch();
  const url = documentFileUrl(workspace, doc.id);
  return (
    <li className="sources-document" data-document-id={doc.id}>
      <a className="sources-document-name" href={url} target="_blank" rel="noreferrer" title={`Open ${doc.name}`}>
        {doc.name}
      </a>
      <span className="sources-document-meta">
        {KIND_LABEL[doc.kind]} · {formatSize(doc.size)}
      </span>
      <NoteButton
        className="sources-document-note"
        label={`document ${doc.name}`}
        text={doc.note ?? null}
        onSave={(text) => dispatch({ type: "SET_DOCUMENT_NOTE", id: doc.id, text })}
      />
      <a className="sources-document-btn" href={url} download={doc.name} aria-label={`Download ${doc.name}`}>
        Download
      </a>
      <button
        type="button"
        className="sources-document-btn"
        aria-label={`Remove ${doc.name}`}
        title="Remove from the workspace (the uploaded file stays; Undo in the workbench)"
        onClick={() => dispatch({ type: "REMOVE_DOCUMENT", id: doc.id })}
      >
        Remove
      </button>
    </li>
  );
}

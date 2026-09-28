import { useMemo, useRef, useState } from "react";

import { apiClient } from "../../api/client";
import type { EngineError, Workspace, WorkspaceSummary } from "../../api/types";
import { abandonPendingWorkspaceSave } from "../../state/AppStore";
import {
  deleteConfirmMessage,
  filterWorkspaceSummaries,
  formatMtime,
  multiDeleteConfirmMessage,
  pickFallbackWorkspace,
  roleLine,
  sortWorkspaceSummaries,
  suggestDuplicateName,
  type WorkspaceSortDir,
  type WorkspaceSortKey,
} from "./workspaceManagerLogic";

function engineMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Partial<EngineError>;
    const msg = typeof e.message === "string" ? e.message : "";
    const typ = typeof e.type === "string" ? e.type : "";
    if (typ && msg) return `${typ}: ${msg}`;
    if (msg) return msg;
  }
  return String(err);
}

export interface WorkspaceSidebarProps {
  summaries: WorkspaceSummary[];
  activeName: string;
  listError: string | null;
  onSelect: (name: string) => void;
  onSummariesChange: (next: WorkspaceSummary[]) => void;
  /** After create: parent should select the new empty workspace. */
  onCreated: (name: string) => void;
  /**
   * After deleting names that included the active workspace.
   * `fallback` is null when nothing remains.
   */
  onActiveRemoved: (deletedNames: string[], fallback: string | null) => void;
  /** After rename of the active workspace (or any rename that parent tracks). */
  onRenamed: (oldName: string, ws: Workspace) => void;
  onDuplicated: (ws: Workspace) => void;
  onExport: (name: string) => void;
  onError: (message: string) => void;
}

export function WorkspaceSidebar({
  summaries,
  activeName,
  listError,
  onSelect,
  onSummariesChange,
  onCreated,
  onActiveRemoved,
  onRenamed,
  onDuplicated,
  onExport,
  onError,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<WorkspaceSortKey>("name");
  const [sortDir, setSortDir] = useState<WorkspaceSortDir>("asc");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const renameSubmitting = useRef<string | null>(null);
  const refreshGen = useRef(0);

  const visible = useMemo(
    () =>
      sortWorkspaceSummaries(
        filterWorkspaceSummaries(summaries, query),
        sortKey,
        sortDir,
      ),
    [summaries, query, sortKey, sortDir],
  );

  const selectedNames = useMemo(
    () => Object.keys(selected).filter((n) => selected[n]),
    [selected],
  );

  const refreshSummaries = async (): Promise<WorkspaceSummary[]> => {
    const gen = ++refreshGen.current;
    const next = await apiClient.listWorkspaceSummaries();
    if (gen !== refreshGen.current) return next;
    onSummariesChange(next);
    return next;
  };

  /** Patch local list immediately; refresh shapes in the background. */
  const optimisticThenRefresh = (
    patch: (prev: WorkspaceSummary[]) => WorkspaceSummary[],
  ) => {
    onSummariesChange(patch(summaries));
    void refreshSummaries().catch((err: unknown) => {
      onError(engineMessage(err));
    });
  };

  const toggleSort = (key: WorkspaceSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "mtime" ? "desc" : "asc");
    }
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const ws: Workspace = {
      name: trimmed,
      datasets: {
        train: { x: { kind: "csv", path: "" } },
      },
      label: { mode: "order" },
      merges: [],
      variables: [],
      steps: [],
    };
    try {
      await apiClient.saveWorkspace(ws);
      optimisticThenRefresh((prev) => {
        const stub: WorkspaceSummary = {
          name: trimmed,
          mtime: new Date().toISOString(),
          step_count: 0,
          target: null,
          train: {
            kind: "csv",
            path: "",
            file: null,
            shape: null,
          },
          test: null,
        };
        return [...prev.filter((s) => s.name !== trimmed), stub].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      });
      setShowNew(false);
      setNewName("");
      onCreated(trimmed);
    } catch (err: unknown) {
      onError(engineMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRenameSubmit = async (oldName: string) => {
    if (renameSubmitting.current === oldName) return;
    renameSubmitting.current = oldName;
    const trimmed = renameValue.trim();
    setRenaming(null);
    if (!trimmed || trimmed === oldName || busy) {
      renameSubmitting.current = null;
      return;
    }
    setBusy(true);
    try {
      const ws = await apiClient.renameWorkspace(oldName, trimmed);
      setSelected((prev) => {
        const next = { ...prev };
        delete next[oldName];
        return next;
      });
      optimisticThenRefresh((prev) =>
        prev
          .map((s) =>
            s.name === oldName
              ? { ...s, name: trimmed, mtime: new Date().toISOString() }
              : s,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      onRenamed(oldName, ws);
    } catch (err: unknown) {
      onError(engineMessage(err));
      void refreshSummaries().catch(() => {
        /* already reported */
      });
    } finally {
      setBusy(false);
      renameSubmitting.current = null;
    }
  };

  const handleDuplicate = async (name: string) => {
    if (busy) return;
    const copyName = suggestDuplicateName(
      name,
      summaries.map((s) => s.name),
    );
    setBusy(true);
    try {
      const ws = await apiClient.duplicateWorkspace(name, copyName);
      const src = summaries.find((s) => s.name === name);
      optimisticThenRefresh((prev) => {
        const stub: WorkspaceSummary = src
          ? {
              ...src,
              name: copyName,
              mtime: new Date().toISOString(),
            }
          : {
              name: copyName,
              mtime: new Date().toISOString(),
              step_count: ws.steps.length,
              target: null,
              train: {
                kind: ws.datasets.train.x.kind,
                path: ws.datasets.train.x.path,
                file: null,
                shape: null,
              },
              test: null,
            };
        return [...prev, stub].sort((a, b) => a.name.localeCompare(b.name));
      });
      onDuplicated(ws);
    } catch (err: unknown) {
      onError(engineMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteNames = async (names: string[]) => {
    if (names.length === 0 || busy) return;
    const unique = [...new Set(names)];
    const byName = new Map(summaries.map((s) => [s.name, s]));
    const message =
      unique.length === 1 && byName.get(unique[0]!)
        ? deleteConfirmMessage(byName.get(unique[0]!)!)
        : multiDeleteConfirmMessage(unique);
    if (!window.confirm(message)) return;

    // Cancel autosave BEFORE DELETEs so a debounced / in-flight PUT cannot
    // resurrect these names (MAT-217).
    abandonPendingWorkspaceSave(unique);

    setBusy(true);
    const deleted: string[] = [];
    try {
      for (const name of unique) {
        await apiClient.deleteWorkspace(name);
        deleted.push(name);
      }
      setSelected({});
      const remainingLocal = summaries
        .filter((s) => !deleted.includes(s.name))
        .map((s) => s.name);
      onSummariesChange(summaries.filter((s) => !deleted.includes(s.name)));
      void refreshSummaries().catch(() => {
        /* best-effort */
      });
      if (deleted.includes(activeName)) {
        const fallback = pickFallbackWorkspace(
          remainingLocal,
          remainingLocal.find((n) => n !== activeName) ?? null,
        );
        onActiveRemoved(deleted, fallback);
      }
    } catch (err: unknown) {
      onError(engineMessage(err));
      try {
        await refreshSummaries();
      } catch {
        /* already reported */
      }
      if (deleted.includes(activeName)) {
        const remaining = summaries
          .map((s) => s.name)
          .filter((n) => !deleted.includes(n));
        onActiveRemoved(deleted, pickFallbackWorkspace(remaining));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="sources-sidebar" aria-label="Workspaces">
      <div className="sources-sidebar-title">Workspaces</div>
      <div className="sources-sidebar-desc">
        A workspace = which files make train and test, how the label joins, and
        the ordered log of steps.
      </div>

      {listError ? (
        <div className="engine-error-box" role="alert">
          {listError}
        </div>
      ) : null}

      <div className="ws-toolbar" role="search">
        <input
          type="search"
          className="ws-search"
          placeholder="Search workspaces"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search workspaces"
        />
        <div className="ws-sort" role="group" aria-label="Sort workspaces">
          <button
            type="button"
            className={`ws-sort-btn ${sortKey === "name" ? "on" : ""}`}
            aria-pressed={sortKey === "name"}
            onClick={() => toggleSort("name")}
          >
            Name{sortKey === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
          <button
            type="button"
            className={`ws-sort-btn ${sortKey === "mtime" ? "on" : ""}`}
            aria-pressed={sortKey === "mtime"}
            onClick={() => toggleSort("mtime")}
          >
            Modified
            {sortKey === "mtime" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        </div>
      </div>

      {selectedNames.length > 0 ? (
        <div className="ws-bulk-bar">
          <span className="ws-bulk-count">
            {selectedNames.length} selected
          </span>
          <button
            type="button"
            className="ws-action danger"
            disabled={busy}
            onClick={() => void deleteNames(selectedNames)}
          >
            Delete selected
          </button>
        </div>
      ) : null}

      <div className="ws-list" role="list" aria-label="Workspace list">
        {visible.map((s) => {
          const isActive = s.name === activeName;
          const isChecked = Boolean(selected[s.name]);
          const isRenaming = renaming === s.name;
          return (
            <div
              key={s.name}
              className={`ws-item ${isActive ? "active" : ""}`}
              role="listitem"
              data-workspace={s.name}
            >
              <div className="ws-item-main">
                <label className="ws-check">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    aria-label={`Select ${s.name}`}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSelected((prev) => {
                        const next = { ...prev };
                        if (on) next[s.name] = true;
                        else delete next[s.name];
                        return next;
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
                {isRenaming ? (
                  <div className="ws-item-select ws-item-renaming">
                    <input
                      type="text"
                      className="ws-rename-input"
                      value={renameValue}
                      aria-label={`Rename ${s.name}`}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleRenameSubmit(s.name);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenaming(null);
                        }
                      }}
                      onBlur={() => void handleRenameSubmit(s.name)}
                    />
                    <span className="ws-item-meta">
                      Enter to confirm · Esc to cancel
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ws-item-select"
                    onClick={() => onSelect(s.name)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="ws-item-name">{s.name}</span>
                    <span className="ws-item-meta">
                      {formatMtime(s.mtime)} · {s.step_count} step
                      {s.step_count === 1 ? "" : "s"}
                      {s.target ? ` · target ${s.target}` : ""}
                      {isActive ? " · open" : ""}
                    </span>
                    <span className="ws-item-files">
                      train {roleLine(s.train)}
                      {" · "}
                      test {roleLine(s.test)}
                    </span>
                  </button>
                )}
              </div>
              <div
                className="ws-item-actions"
                role="group"
                aria-label={`Actions for ${s.name}`}
              >
                <button
                  type="button"
                  className="ws-action"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(s.name);
                    setRenameValue(s.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="ws-action"
                  disabled={busy}
                  onClick={() => void handleDuplicate(s.name)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="ws-action"
                  disabled={busy}
                  onClick={() => onExport(s.name)}
                >
                  Export
                </button>
                <button
                  type="button"
                  className="ws-action danger"
                  disabled={busy}
                  onClick={() => void deleteNames([s.name])}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {visible.length === 0 && summaries.length === 0 ? (
          <div className="ws-empty">No workspaces yet.</div>
        ) : null}
        {visible.length === 0 && summaries.length > 0 ? (
          <div className="ws-empty">No match for “{query.trim()}”.</div>
        ) : null}
      </div>

      {showNew ? (
        <div className="new-ws-form">
          <input
            type="text"
            className="new-ws-input"
            placeholder="Workspace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <div className="new-ws-actions">
            <button
              type="button"
              className="new-ws-create"
              disabled={busy}
              onClick={() => void handleCreate()}
            >
              Create
            </button>
            <button
              type="button"
              className="new-ws-cancel"
              onClick={() => setShowNew(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn-new-ws"
          onClick={() => setShowNew(true)}
        >
          + New workspace
        </button>
      )}
    </aside>
  );
}

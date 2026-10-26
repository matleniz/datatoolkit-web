import { useEffect, useState, type ChangeEvent, type RefObject } from "react";
import { apiClient } from "../../api/client";
import type { FileSourceSpec } from "../../api/types";
import {
  ALL_ROLES,
  formatDetectedFromSpec,
  ROLE_LABELS,
  type FileRole,
  type SourceFileItem,
} from "./sourcesLogic";
import { PendingRegion, Skeleton } from "../../placeholder/Skeleton";
import { fileWarning } from "./sourcesScreenLogic";
import { SourceOptionsEditor } from "./SourceOptionsEditor";
import { SourcesDocuments } from "./SourcesDocuments";

interface RoleChipsProps {
  file: SourceFileItem;
  currentRole: FileRole | "ignore";
  isGuessed: boolean | undefined;
  onPickRole: (fileId: string, role: FileRole) => void;
}

function RoleChips({ file, currentRole, isGuessed, onPickRole }: RoleChipsProps) {
  return (
    <div className="file-roles" role="group" aria-label={`Role for ${file.name}`}>
      {ALL_ROLES.map((r) => {
        const isSelected = currentRole === r;
        return (
          <button
            key={r}
            type="button"
            className={`chip-role ${isSelected ? "on" : ""}`}
            aria-pressed={isSelected}
            onClick={() => onPickRole(file.id, r)}
          >
            {ROLE_LABELS[r]}
            {isSelected && isGuessed ? (
              <span className="chip-guess-dot" title="Guessed from file name">
                (guess)
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface FileBlockProps {
  /** The files are being inspected: the column list is a placeholder. */
  loading: boolean;
  file: SourceFileItem;
  currentRole: FileRole | "ignore";
  isGuessed: boolean | undefined;
  optsOpen: boolean;
  optsBusy: boolean;
  optsNotice: string | undefined;
  csvEngines: string[];
  onPickRole: (fileId: string, role: FileRole) => void;
  onToggleOptions: (fileId: string) => void;
  onSpecChange: (fileId: string, spec: FileSourceSpec) => void;
}

/**
 * A file the engine cannot use as a table shows a warning on its own row: the
 * verdict ("Empty file" / "Not a readable table") and the engine's message
 * verbatim underneath (#239, #246). The Train X result card carries the
 * blocking alert, so there the row notice is a status, not a second alert.
 */
function FileLoadError({ file, role }: { file: SourceFileItem; role: FileRole | "ignore" }) {
  const warning = fileWarning(file);
  if (!warning) return null;
  return (
    <div
      className="engine-error-box file-warning"
      role={role === "trainX" ? "status" : "alert"}
      data-file-load-error={file.id}
    >
      <strong>{warning.title}</strong>
      <div className="file-warning-reason">{warning.reason}</div>
    </div>
  );
}

function FileBlock({
  loading,
  file: fl,
  currentRole,
  isGuessed,
  optsOpen,
  optsBusy,
  optsNotice,
  csvEngines,
  onPickRole,
  onToggleOptions,
  onSpecChange,
}: FileBlockProps) {
  return (
    <div className="files-table-block">
      <div className="files-table-row">
        <div className="file-info">
          <span className="file-name">{fl.name}</span>
          <span className="file-cols" title={fl.cols.join(", ")}>
            {loading && fl.cols.length === 0 ? (
              <PendingRegion label={`Reading the columns of ${fl.name}`}>
                <Skeleton width="70%" height={9} />
              </PendingRegion>
            ) : (
              fl.cols.join(", ")
            )}
          </span>
        </div>

        <div className="file-detected">
          {fl.detected || formatDetectedFromSpec(fl.spec, null)}
          <button
            type="button"
            className={`btn-file-options ${optsOpen ? "on" : ""}`}
            aria-expanded={optsOpen}
            aria-controls={`options-${fl.id}`}
            onClick={() => onToggleOptions(fl.id)}
          >
            Options
          </button>
        </div>

        <RoleChips
          file={fl}
          currentRole={currentRole}
          isGuessed={isGuessed}
          onPickRole={onPickRole}
        />
      </div>

      <FileLoadError file={fl} role={currentRole} />

      {optsOpen ? (
        <div
          id={`options-${fl.id}`}
          className="file-options-panel"
          aria-label={`Load options for ${fl.name}`}
        >
          {optsBusy ? (
            <span className="file-options-busy">Updating preview…</span>
          ) : null}
          {optsNotice ? (
            <div className="file-options-notice" role="status">
              {optsNotice}
            </div>
          ) : null}
          <SourceOptionsEditor
            file={fl}
            busy={optsBusy}
            csvEngines={csvEngines}
            onChange={(next) => void onSpecChange(fl.id, next)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** CSV engines from the key schema; [] (picker hidden) until / unless it loads. */
function useCsvEngines(): string[] {
  const [engines, setEngines] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    apiClient
      .csvEngines()
      .then((names) => {
        if (active) setEngines(names);
      })
      .catch(() => {
        /* the picker is optional: pandas stays the only engine */
      });
    return () => {
      active = false;
    };
  }, []);
  return engines;
}

interface SourcesFilesCardProps {
  loading: boolean;
  files: SourceFileItem[];
  roles: Record<string, FileRole>;
  guessedMap: Record<string, boolean>;
  optionsOpen: Record<string, boolean>;
  optionsBusy: Record<string, boolean>;
  optionsNotice: Record<string, string>;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement>;
  /** Why the last upload was refused (413, #299); null hides the line. */
  uploadError: string | null;
  onPickRole: (fileId: string, role: FileRole) => void;
  onToggleOptions: (fileId: string) => void;
  onSpecChange: (fileId: string, spec: FileSourceSpec) => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function SourcesFilesCard({
  loading,
  files,
  roles,
  guessedMap,
  optionsOpen,
  optionsBusy,
  optionsNotice,
  fileInputId,
  fileInputRef,
  uploadError,
  onPickRole,
  onToggleOptions,
  onSpecChange,
  onUpload,
}: SourcesFilesCardProps) {
  const csvEngines = useCsvEngines();
  return (
    <section className="sources-card" aria-label="Files list">
      <div className="files-table-header">
        <span className="col-file">File</span>
        <span className="col-detected">Detected (file_inspect)</span>
        <span className="col-role">Role</span>
      </div>

      {files.map((fl) => (
        <FileBlock
          key={fl.id}
          loading={loading}
          file={fl}
          currentRole={roles[fl.id] || "ignore"}
          isGuessed={guessedMap[fl.id]}
          optsOpen={Boolean(optionsOpen[fl.id])}
          optsBusy={Boolean(optionsBusy[fl.id])}
          optsNotice={optionsNotice[fl.id]}
          csvEngines={csvEngines}
          onPickRole={onPickRole}
          onToggleOptions={onToggleOptions}
          onSpecChange={onSpecChange}
        />
      ))}

      <div className="files-table-footer">
        <input
          id={fileInputId}
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={onUpload}
        />
        <label
          htmlFor={fileInputId}
          className="btn-add-file"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          + Add a file (csv, parquet, excel, json)
        </label>
        {uploadError ? (
          <span className="files-upload-error" role="alert">
            {uploadError}
          </span>
        ) : null}
      </div>

      <SourcesDocuments />
    </section>
  );
}

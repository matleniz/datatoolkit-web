import type { ChangeEvent, RefObject } from "react";
import type { FileSourceSpec } from "../../api/types";
import {
  ALL_ROLES,
  formatDetectedFromSpec,
  ROLE_LABELS,
  type FileRole,
  type SourceFileItem,
} from "./sourcesLogic";
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
  file: SourceFileItem;
  currentRole: FileRole | "ignore";
  isGuessed: boolean | undefined;
  optsOpen: boolean;
  optsBusy: boolean;
  onPickRole: (fileId: string, role: FileRole) => void;
  onToggleOptions: (fileId: string) => void;
  onSpecChange: (fileId: string, spec: FileSourceSpec) => void;
}

function FileBlock({
  file: fl,
  currentRole,
  isGuessed,
  optsOpen,
  optsBusy,
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
            {fl.cols.join(", ")}
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

      {optsOpen ? (
        <div
          id={`options-${fl.id}`}
          className="file-options-panel"
          aria-label={`Load options for ${fl.name}`}
        >
          {optsBusy ? (
            <span className="file-options-busy">Updating preview…</span>
          ) : null}
          <SourceOptionsEditor
            file={fl}
            busy={optsBusy}
            onChange={(next) => void onSpecChange(fl.id, next)}
          />
        </div>
      ) : null}
    </div>
  );
}

interface SourcesFilesCardProps {
  files: SourceFileItem[];
  roles: Record<string, FileRole>;
  guessedMap: Record<string, boolean>;
  optionsOpen: Record<string, boolean>;
  optionsBusy: Record<string, boolean>;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement>;
  onPickRole: (fileId: string, role: FileRole) => void;
  onToggleOptions: (fileId: string) => void;
  onSpecChange: (fileId: string, spec: FileSourceSpec) => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function SourcesFilesCard({
  files,
  roles,
  guessedMap,
  optionsOpen,
  optionsBusy,
  fileInputId,
  fileInputRef,
  onPickRole,
  onToggleOptions,
  onSpecChange,
  onUpload,
}: SourcesFilesCardProps) {
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
          file={fl}
          currentRole={roles[fl.id] || "ignore"}
          isGuessed={guessedMap[fl.id]}
          optsOpen={Boolean(optionsOpen[fl.id])}
          optsBusy={Boolean(optionsBusy[fl.id])}
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
      </div>

      <SourcesDocuments />
    </section>
  );
}

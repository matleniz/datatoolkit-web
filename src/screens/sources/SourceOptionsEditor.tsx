import type { ChangeEvent } from "react";
import type {
  CsvSource,
  ExcelSource,
  FileSourceSpec,
  JsonSource,
  ParquetSource,
} from "../../api/types";
import type { RecordPathInfo, SheetInfo, SourceFileItem } from "./sourcesLogic";

export interface SourceOptionsEditorProps {
  file: SourceFileItem;
  busy?: boolean;
  onChange: (next: FileSourceSpec) => void;
}

function parseCsvList(raw: string): string[] | null {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

function CsvOptions({
  spec,
  busy,
  onChange,
}: {
  spec: CsvSource;
  busy?: boolean;
  onChange: (next: CsvSource) => void;
}) {
  const set = (patch: Partial<CsvSource>) => onChange({ ...spec, ...patch });

  return (
    <div className="source-options-grid" aria-label="CSV load options">
      <label className="source-opt">
        <span>sep</span>
        <input
          type="text"
          aria-label="sep"
          value={spec.sep ?? ""}
          disabled={busy}
          onChange={(e) => set({ sep: e.target.value || undefined })}
        />
      </label>
      <label className="source-opt">
        <span>decimal</span>
        <input
          type="text"
          aria-label="decimal"
          value={spec.decimal ?? ""}
          disabled={busy}
          onChange={(e) => set({ decimal: e.target.value || undefined })}
        />
      </label>
      <label className="source-opt">
        <span>header</span>
        <input
          type="number"
          aria-label="header"
          value={spec.header ?? ""}
          disabled={busy}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value;
            set({ header: v === "" ? null : Number(v) });
          }}
        />
      </label>
      <label className="source-opt">
        <span>encoding</span>
        <input
          type="text"
          aria-label="encoding"
          value={spec.encoding ?? ""}
          disabled={busy}
          onChange={(e) => set({ encoding: e.target.value || undefined })}
        />
      </label>
      <label className="source-opt source-opt-wide">
        <span>na_values</span>
        <input
          type="text"
          aria-label="na_values"
          placeholder="comma-separated"
          value={(spec.na_values ?? []).join(", ")}
          disabled={busy}
          onChange={(e) => set({ na_values: parseCsvList(e.target.value) })}
        />
      </label>
      <label className="source-opt source-opt-wide">
        <span>dtype</span>
        <input
          type="text"
          aria-label="dtype"
          placeholder='{"column":"str"}'
          value={
            spec.dtype && Object.keys(spec.dtype).length > 0
              ? JSON.stringify(spec.dtype)
              : ""
          }
          disabled={busy}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              set({ dtype: null });
              return;
            }
            try {
              const parsed = JSON.parse(raw) as Record<string, string>;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                set({ dtype: parsed });
              }
            } catch {
              /* keep typing until valid JSON */
            }
          }}
        />
      </label>
      <label className="source-opt source-opt-wide">
        <span>parse_dates</span>
        <input
          type="text"
          aria-label="parse_dates"
          placeholder="comma-separated columns"
          value={(spec.parse_dates ?? []).join(", ")}
          disabled={busy}
          onChange={(e) => set({ parse_dates: parseCsvList(e.target.value) })}
        />
      </label>
      <label className="source-opt">
        <span>on_bad_lines</span>
        <select
          aria-label="on_bad_lines"
          value={spec.on_bad_lines ?? "error"}
          disabled={busy}
          onChange={(e) =>
            set({
              on_bad_lines: e.target.value as "error" | "warn" | "skip",
            })
          }
        >
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="skip">skip</option>
        </select>
      </label>
    </div>
  );
}

function ExcelOptions({
  spec,
  sheets,
  busy,
  onChange,
}: {
  spec: ExcelSource;
  sheets?: SheetInfo[];
  busy?: boolean;
  onChange: (next: ExcelSource) => void;
}) {
  const set = (patch: Partial<ExcelSource>) => onChange({ ...spec, ...patch });

  return (
    <div className="source-options-grid" aria-label="Excel load options">
      <label className="source-opt">
        <span>sheet</span>
        {sheets && sheets.length > 0 ? (
          <select
            aria-label="sheet"
            value={String(spec.sheet ?? sheets[0]?.sheet ?? 0)}
            disabled={busy}
            onChange={(e) => {
              const name = e.target.value;
              const info = sheets.find((s) => s.sheet === name);
              set({
                sheet: name,
                header: info?.suggested_header ?? spec.header ?? 0,
              });
            }}
          >
            {sheets.map((s) => (
              <option key={s.sheet} value={s.sheet}>
                {s.sheet} ({s.rows}×{s.cols})
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            aria-label="sheet"
            value={String(spec.sheet ?? 0)}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              const asNum = Number(v);
              set({
                sheet:
                  Number.isFinite(asNum) &&
                  v.trim() !== "" &&
                  String(asNum) === v
                    ? asNum
                    : v,
              });
            }}
          />
        )}
      </label>
      <label className="source-opt">
        <span>header</span>
        <input
          type="number"
          aria-label="header"
          value={spec.header ?? ""}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            set({ header: v === "" ? null : Number(v) });
          }}
        />
      </label>
    </div>
  );
}

function JsonOptions({
  spec,
  recordPaths,
  busy,
  onChange,
}: {
  spec: JsonSource;
  recordPaths?: RecordPathInfo[];
  busy?: boolean;
  onChange: (next: JsonSource) => void;
}) {
  const set = (patch: Partial<JsonSource>) => onChange({ ...spec, ...patch });
  const pathChoices = recordPaths?.map((r) => r.record_path) ?? [];
  const currentPath = spec.record_path ?? "";

  return (
    <div className="source-options-grid" aria-label="JSON load options">
      <label className="source-opt source-opt-check">
        <input
          type="checkbox"
          aria-label="lines"
          checked={Boolean(spec.lines)}
          disabled={busy}
          onChange={(e) => set({ lines: e.target.checked })}
        />
        <span>lines (JSONL)</span>
      </label>
      <label className="source-opt source-opt-wide">
        <span>record_path</span>
        {pathChoices.length > 0 ? (
          <select
            aria-label="record_path"
            value={currentPath}
            disabled={busy}
            onChange={(e) =>
              set({ record_path: e.target.value ? e.target.value : null })
            }
          >
            <option value="">(root)</option>
            {pathChoices.map((p) => {
              const info = recordPaths?.find((r) => r.record_path === p);
              return (
                <option key={p} value={p}>
                  {p}
                  {info ? ` (${info.records} records)` : ""}
                </option>
              );
            })}
          </select>
        ) : (
          <input
            type="text"
            aria-label="record_path"
            placeholder="e.g. data.items"
            value={currentPath}
            disabled={busy}
            onChange={(e) =>
              set({ record_path: e.target.value ? e.target.value : null })
            }
          />
        )}
      </label>
    </div>
  );
}

function ParquetOptions({
  spec,
  busy,
  onChange,
}: {
  spec: ParquetSource;
  busy?: boolean;
  onChange: (next: ParquetSource) => void;
}) {
  return (
    <div className="source-options-grid" aria-label="Parquet load options">
      <label className="source-opt source-opt-wide">
        <span>columns</span>
        <input
          type="text"
          aria-label="columns"
          placeholder="comma-separated (empty = all)"
          value={(spec.columns ?? []).join(", ")}
          disabled={busy}
          onChange={(e) =>
            onChange({ ...spec, columns: parseCsvList(e.target.value) })
          }
        />
      </label>
    </div>
  );
}

/**
 * Per-kind load Options editor, prefilled from the file's current spec.
 * Parent is responsible for re-previewing on change.
 */
export function SourceOptionsEditor({
  file,
  busy,
  onChange,
}: SourceOptionsEditorProps) {
  const { spec } = file;

  if (spec.kind === "csv") {
    return (
      <CsvOptions
        spec={spec}
        busy={busy}
        onChange={(next) => onChange(next)}
      />
    );
  }
  if (spec.kind === "excel") {
    return (
      <ExcelOptions
        spec={spec}
        sheets={file.sheets}
        busy={busy}
        onChange={(next) => onChange(next)}
      />
    );
  }
  if (spec.kind === "json") {
    return (
      <JsonOptions
        spec={spec}
        recordPaths={file.recordPaths}
        busy={busy}
        onChange={(next) => onChange(next)}
      />
    );
  }
  if (spec.kind === "parquet") {
    return (
      <ParquetOptions
        spec={spec}
        busy={busy}
        onChange={(next) => onChange(next)}
      />
    );
  }
  return null;
}

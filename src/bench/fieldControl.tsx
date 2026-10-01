import type { ReactNode } from "react";

import type { ColumnKind } from "../api/types";
import { Chips } from "./Chips";
import { filterColumnsByDtype, type EditorField } from "./schemaFields";

function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function display(v: unknown): string {
  return Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
}

/** Comma list → values; numeric lists keep the raw text while incomplete. */
function parseList(raw: string, numeric: boolean): unknown {
  if (raw.trim() === "") return null;
  if (!numeric) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  const nums = raw.split(",").map((s) => Number(s.trim()));
  return nums.some(Number.isNaN) ? raw : nums;
}

const isNullOption = (o: string) => o === "" || o === "__null__";

type Columns = { name: string; kind: ColumnKind }[];

/** Everything a per-widget renderer needs; built once by `fieldControl`. */
interface Ctx {
  field: EditorField;
  value: unknown;
  set: (v: unknown) => void;
  columns: Columns;
  dock: boolean;
  placeholder?: string;
  inputClass: string;
}

function currentColumns(value: unknown, multi: boolean): string[] {
  if (multi) return (value as string[] | null | undefined) ?? [];
  return value ? [String(value)] : [];
}

function columnControl({ field, value, set, columns, dock }: Ctx, multi: boolean): ReactNode {
  const { label } = field;
  const current = currentColumns(value, multi);
  const eligible = filterColumnsByDtype(columns, field.dtypeFilter);
  return (
    <>
      <Chips
        small
        label={label}
        options={eligible}
        isOn={(n) => current.includes(n)}
        onPick={(n) =>
          set(multi ? toggled(current, n) : dock && current.includes(n) ? null : n)
        }
        chipLabel={(n) => `${label}: ${n}`}
      >
        {/* Stale names (already dropped) stay selectable so the user can clear them (MAT-177). */}
        {current
          .filter((n) => !eligible.includes(n))
          .map((n) => (
            <button
              key={`gone-${n}`}
              type="button"
              className="small-chip on"
              aria-pressed={true}
              aria-label={`${label}: ${n} (already gone)`}
              title="Already gone from this frame — click to remove"
              onClick={() => set(multi ? current.filter((x) => x !== n) : null)}
            >
              {n} ×
            </button>
          ))}
      </Chips>
      {!eligible.length ? (
        <span className="ed-help">No matching column.</span>
      ) : null}
    </>
  );
}

function enumControl({ field, value, set }: Ctx): ReactNode {
  return (
    <Chips
      label={field.label}
      options={field.enumValues ?? []}
      isOn={(o) => (isNullOption(o) ? value == null : value === o)}
      onPick={(o) => set(isNullOption(o) ? null : o)}
      text={(o) => (isNullOption(o) ? "none" : o === " " ? "space" : o)}
    />
  );
}

function enumListControl({ field, value, set }: Ctx): ReactNode {
  const current = (value as string[] | null | undefined) ?? [];
  return (
    <Chips
      label={field.label}
      options={field.enumValues ?? []}
      isOn={(o) => current.includes(o)}
      onPick={(o) => set(toggled(current, o))}
    />
  );
}

function boolControl({ field, value, set }: Ctx): ReactNode {
  return (
    <Chips
      label={field.label}
      options={[true, false]}
      isOn={(b) => value === b}
      onPick={set}
      text={(b) => (b ? "yes" : "no")}
    />
  );
}

function autoNumberControl({ field, value, set, dock, inputClass }: Ctx): ReactNode {
  const { label } = field;
  const isAuto = value === "auto" || value == null;
  return (
    <div
      className={dock ? "dock-param-auto-num" : "chip-row"}
      style={dock ? undefined : { alignItems: "center" }}
    >
      <button
        type="button"
        className={isAuto ? "chip on" : "chip"}
        aria-pressed={isAuto}
        aria-label={`${label}: auto`}
        onClick={() => set("auto")}
      >
        auto
      </button>
      <input
        aria-label={label}
        className={inputClass}
        type="number"
        min={2}
        max={200}
        placeholder="count"
        value={isAuto ? "" : String(value)}
        style={dock ? undefined : { width: 88 }}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = Number(raw);
          if (raw === "") set("auto");
          else if (!Number.isNaN(n)) set(n);
        }}
      />
    </div>
  );
}

/** Blur of a numeric list: a half-typed string collapses to the numbers it holds. */
function settleNumberList(value: unknown, set: (v: unknown) => void) {
  if (typeof value !== "string") return;
  const nums = value
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => !Number.isNaN(n));
  set(nums.length ? nums : null);
}

function listControl({ field, value, set, inputClass }: Ctx, numeric: boolean): ReactNode {
  return (
    <input
      aria-label={field.label}
      className={inputClass}
      value={display(value)}
      placeholder={numeric ? "e.g. 0, 10, 20, 50" : "e.g. a, b, c"}
      onChange={(e) => set(parseList(e.target.value, numeric))}
      onBlur={() => {
        if (numeric) settleNumberList(value, set);
      }}
    />
  );
}

/** Keep raw text while incomplete (e.g. "-" / "1."). */
function parseScalar(raw: string, numeric: boolean, key: string): unknown {
  if (!numeric) {
    // A `name` param names a new column: keep it an identifier.
    return key === "name" ? raw.replace(/[^A-Za-z0-9_]/g, "_") : raw;
  }
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

function scalarControl(
  { field, value, set, dock, placeholder, inputClass }: Ctx,
  numeric: boolean,
): ReactNode {
  return (
    <input
      aria-label={field.label}
      className={inputClass}
      type={numeric && dock ? "number" : undefined}
      inputMode={numeric && !dock ? "decimal" : undefined}
      placeholder={placeholder ?? (numeric && !dock ? "optional" : undefined)}
      value={display(value)}
      onChange={(e) => set(parseScalar(e.target.value, numeric, field.key))}
      onBlur={() => {
        if (!numeric || typeof value !== "string") return;
        const n = Number(value.trim());
        if (value.trim() === "") set(null);
        else if (!Number.isNaN(n)) set(n);
      }}
    />
  );
}

/**
 * Control for a generic schema widget, shared by the step editor and the dock
 * Parameters panel (`dock`); null for widgets the caller renders itself.
 */
export function fieldControl(
  field: EditorField,
  value: unknown,
  set: (v: unknown) => void,
  columns: Columns,
  { dock = false, placeholder }: { dock?: boolean; placeholder?: string } = {},
): ReactNode {
  const ctx: Ctx = {
    field,
    value,
    set,
    columns,
    dock,
    placeholder,
    inputClass: dock ? "ed-input dock-param-input" : "ed-input",
  };
  switch (field.widget) {
    case "column":
      return columnControl(ctx, false);
    case "columns":
      return columnControl(ctx, true);
    case "enum":
      return enumControl(ctx);
    case "enum_list":
      return enumListControl(ctx);
    case "bool":
      return boolControl(ctx);
    case "auto_number":
      return autoNumberControl(ctx);
    case "number_list":
      return listControl(ctx, true);
    case "string_list":
      return listControl(ctx, false);
    case "number":
      return scalarControl(ctx, true);
    case "text":
      return scalarControl(ctx, false);
    default:
      return null;
  }
}

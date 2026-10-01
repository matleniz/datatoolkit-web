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

/**
 * Control for a generic schema widget, shared by the step editor and the dock
 * Parameters panel (`dock`); null for widgets the caller renders itself.
 */
export function fieldControl(
  field: EditorField,
  value: unknown,
  set: (v: unknown) => void,
  columns: { name: string; kind: ColumnKind }[],
  { dock = false, placeholder }: { dock?: boolean; placeholder?: string } = {},
): ReactNode {
  const { label, widget } = field;
  const inputClass = dock ? "ed-input dock-param-input" : "ed-input";
  switch (widget) {
    case "column":
    case "columns": {
      const multi = widget === "columns";
      const current = multi
        ? ((value as string[] | null | undefined) ?? [])
        : value
          ? [String(value)]
          : [];
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
    case "enum":
      return (
        <Chips
          label={label}
          options={field.enumValues ?? []}
          isOn={(o) => (isNullOption(o) ? value == null : value === o)}
          onPick={(o) => set(isNullOption(o) ? null : o)}
          text={(o) => (isNullOption(o) ? "none" : o === " " ? "space" : o)}
        />
      );
    case "enum_list": {
      const current = (value as string[] | null | undefined) ?? [];
      return (
        <Chips
          label={label}
          options={field.enumValues ?? []}
          isOn={(o) => current.includes(o)}
          onPick={(o) => set(toggled(current, o))}
        />
      );
    }
    case "bool":
      return (
        <Chips
          label={label}
          options={[true, false]}
          isOn={(b) => value === b}
          onPick={set}
          text={(b) => (b ? "yes" : "no")}
        />
      );
    case "auto_number": {
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
    case "number_list":
    case "string_list": {
      const numeric = widget === "number_list";
      return (
        <input
          aria-label={label}
          className={inputClass}
          value={display(value)}
          placeholder={numeric ? "e.g. 0, 10, 20, 50" : "e.g. a, b, c"}
          onChange={(e) => set(parseList(e.target.value, numeric))}
          onBlur={() => {
            if (numeric && typeof value === "string") {
              const nums = value
                .split(",")
                .map((x) => Number(x.trim()))
                .filter((n) => !Number.isNaN(n));
              set(nums.length ? nums : null);
            }
          }}
        />
      );
    }
    case "number":
    case "text": {
      const numeric = widget === "number";
      return (
        <input
          aria-label={label}
          className={inputClass}
          type={numeric && dock ? "number" : undefined}
          inputMode={numeric && !dock ? "decimal" : undefined}
          placeholder={placeholder ?? (numeric && !dock ? "optional" : undefined)}
          value={display(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (!numeric) {
              // A `name` param names a new column: keep it an identifier.
              set(field.key === "name" ? raw.replace(/[^A-Za-z0-9_]/g, "_") : raw);
            } else if (raw.trim() === "") {
              set(null);
            } else {
              // Keep raw text while incomplete (e.g. "-" / "1.").
              const n = Number(raw);
              set(Number.isNaN(n) ? raw : n);
            }
          }}
          onBlur={() => {
            if (!numeric || typeof value !== "string") return;
            const n = Number(value.trim());
            if (value.trim() === "") set(null);
            else if (!Number.isNaN(n)) set(n);
          }}
        />
      );
    }
    default:
      return null;
  }
}

import type { ColumnKind } from "../../api/types";
import type { EditorField } from "../schemaFields";
import { filterColumnsByDtype } from "../schemaFields";

/**
 * Compact schema-driven field controls for the dock Parameters panel.
 * Widgets match `schemaToFields` (numbers, enums, booleans, column pickers,
 * auto_number, lists) — same mapping as the step editor, slimmed for dock.
 */
export function DockParamField({
  field,
  params,
  columns,
  onChange,
}: {
  field: EditorField;
  params: Record<string, unknown>;
  columns: { name: string; kind: ColumnKind }[];
  onChange: (key: string, value: unknown) => void;
}) {
  const eligible = filterColumnsByDtype(columns, field.dtypeFilter);
  const value = params[field.key];

  if (field.widget === "columns" || field.widget === "column") {
    const multi = field.widget === "columns";
    const current = multi
      ? ((value as string[] | null | undefined) ?? [])
      : value
        ? [String(value)]
        : [];
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <div className="chip-row" role="group" aria-label={field.label}>
          {eligible.map((n) => {
            const on = current.includes(n);
            return (
              <button
                key={n}
                type="button"
                className={on ? "small-chip on" : "small-chip"}
                aria-pressed={on}
                onClick={() => {
                  if (multi) {
                    const a = [...current];
                    const i = a.indexOf(n);
                    if (i >= 0) a.splice(i, 1);
                    else a.push(n);
                    onChange(field.key, a);
                  } else {
                    onChange(field.key, on ? null : n);
                  }
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
      </label>
    );
  }

  if (field.widget === "enum") {
    const values = field.enumValues ?? [];
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <div className="chip-row" role="group" aria-label={field.label}>
          {values.map((o) => {
            const isNullOpt = o === "" || o === "__null__";
            const optVal = isNullOpt ? null : o;
            const on = isNullOpt
              ? value === null || value === undefined
              : value === optVal;
            return (
              <button
                key={isNullOpt ? "__null__" : o}
                type="button"
                className={on ? "chip on" : "chip"}
                aria-pressed={on}
                onClick={() => onChange(field.key, optVal)}
              >
                {isNullOpt ? "none" : o}
              </button>
            );
          })}
        </div>
      </label>
    );
  }

  if (field.widget === "bool") {
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <div className="chip-row" role="group" aria-label={field.label}>
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              className={value === b ? "chip on" : "chip"}
              aria-pressed={value === b}
              onClick={() => onChange(field.key, b)}
            >
              {b ? "yes" : "no"}
            </button>
          ))}
        </div>
      </label>
    );
  }

  if (field.widget === "auto_number") {
    const isAuto = value === "auto" || value === undefined || value === null;
    const numDisplay = isAuto ? "" : String(value);
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <div className="dock-param-auto-num">
          <button
            type="button"
            className={isAuto ? "chip on" : "chip"}
            aria-pressed={isAuto}
            aria-label={`${field.label}: auto`}
            onClick={() => onChange(field.key, "auto")}
          >
            auto
          </button>
          <input
            aria-label={field.label}
            className="ed-input dock-param-input"
            type="number"
            min={2}
            max={200}
            placeholder="count"
            value={numDisplay}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                onChange(field.key, "auto");
                return;
              }
              const n = Number(raw);
              if (!Number.isNaN(n)) onChange(field.key, n);
            }}
          />
        </div>
      </label>
    );
  }

  if (field.widget === "number" || field.widget === "text") {
    const display = value === null || value === undefined ? "" : String(value);
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <input
          aria-label={field.label}
          className="ed-input dock-param-input"
          type={field.widget === "number" ? "number" : "text"}
          value={display}
          onChange={(e) => {
            const raw = e.target.value;
            if (field.widget === "number") {
              if (raw.trim() === "") {
                onChange(field.key, null);
                return;
              }
              const n = Number(raw);
              onChange(field.key, Number.isNaN(n) ? null : n);
            } else {
              onChange(field.key, raw);
            }
          }}
        />
      </label>
    );
  }

  if (field.widget === "number_list" || field.widget === "string_list") {
    const isNum = field.widget === "number_list";
    const display = Array.isArray(value)
      ? value.join(", ")
      : value === null || value === undefined
        ? ""
        : String(value);
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <input
          aria-label={field.label}
          className="ed-input dock-param-input"
          value={display}
          placeholder={isNum ? "e.g. 0, 10, 50" : "a, b, c"}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === "") {
              onChange(field.key, null);
              return;
            }
            if (isNum) {
              const nums = raw.split(",").map((s) => Number(s.trim()));
              if (nums.some((n) => Number.isNaN(n))) onChange(field.key, raw);
              else onChange(field.key, nums);
            } else {
              onChange(
                field.key,
                raw
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
            }
          }}
        />
      </label>
    );
  }

  if (field.widget === "enum_list") {
    const current = (value as string[] | null | undefined) ?? [];
    return (
      <label className="dock-param" data-dock-param={field.key}>
        <span className="dock-param-label">{field.label}</span>
        <div className="chip-row" role="group" aria-label={field.label}>
          {(field.enumValues ?? []).map((o) => {
            const on = current.includes(o);
            return (
              <button
                key={o}
                type="button"
                className={on ? "chip on" : "chip"}
                aria-pressed={on}
                onClick={() => {
                  const a = [...current];
                  const i = a.indexOf(o);
                  if (i >= 0) a.splice(i, 1);
                  else a.push(o);
                  onChange(field.key, a);
                }}
              >
                {o}
              </button>
            );
          })}
        </div>
      </label>
    );
  }

  return null;
}

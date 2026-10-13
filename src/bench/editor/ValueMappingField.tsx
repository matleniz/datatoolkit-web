import { useEffect, useRef, useState } from "react";
import type { ColumnKind } from "../../api/types";
import { Chips } from "../Chips";
import {
  buildMapping,
  rowsOf,
  type PairRow,
  type ValueMapping,
} from "./valueMapping";

type Columns = { name: string; kind: ColumnKind }[];

/**
 * `replace_values.mapping` (#198): pick columns, then `old -> new` pairs per
 * column; an empty new value turns the old one into a missing value.
 */
export function ValueMappingField({
  value,
  columns,
  onChange,
}: {
  value: ValueMapping | undefined;
  columns: Columns;
  onChange: (m: ValueMapping) => void;
}) {
  const stored = value ?? {};
  const [selected, setSelected] = useState<string[]>(() => Object.keys(stored));
  const [rows, setRows] = useState<Record<string, PairRow[]>>(() =>
    Object.fromEntries(Object.entries(stored).map(([c, p]) => [c, rowsOf(p)])),
  );
  const kindOf = (c: string) => columns.find((x) => x.name === c)?.kind;

  // Params changed from outside (undo, the agent): take them, but never our own echo.
  const lastEmitted = useRef(JSON.stringify(stored));
  useEffect(() => {
    const now = JSON.stringify(value ?? {});
    if (now === lastEmitted.current) return;
    lastEmitted.current = now;
    const m = value ?? {};
    setSelected(Object.keys(m));
    setRows(Object.fromEntries(Object.entries(m).map(([c, p]) => [c, rowsOf(p)])));
  }, [value]);

  const commit = (nextSel: string[], nextRows: Record<string, PairRow[]>) => {
    setSelected(nextSel);
    setRows(nextRows);
    const mapping = buildMapping(nextSel, nextRows, kindOf);
    lastEmitted.current = JSON.stringify(mapping);
    onChange(mapping);
  };

  const toggle = (col: string) => {
    if (selected.includes(col)) {
      commit(
        selected.filter((c) => c !== col),
        rows,
      );
    } else {
      commit([...selected, col], { ...rows, [col]: rows[col] ?? [{ old: "", nw: "" }] });
    }
  };

  const setRow = (col: string, i: number, patch: Partial<PairRow>) => {
    const list = (rows[col] ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r));
    commit(selected, { ...rows, [col]: list });
  };
  const addRow = (col: string) =>
    commit(selected, { ...rows, [col]: [...(rows[col] ?? []), { old: "", nw: "" }] });
  const removeRow = (col: string, i: number) =>
    commit(selected, { ...rows, [col]: (rows[col] ?? []).filter((_, j) => j !== i) });

  return (
    <div className="ed-field" data-ed-field="mapping">
      <span className="ed-label">Columns</span>
      <Chips
        small
        label="Column"
        options={columns.map((c) => c.name)}
        isOn={(n) => selected.includes(n)}
        onPick={toggle}
        chipLabel={(n) => `Column: ${n}`}
      />
      {selected.map((col) => (
        <div key={col} className="ed-field" data-value-mapping-column={col}>
          <span className="ed-label">{col}: old value → new value</span>
          {(rows[col] ?? []).map((r, i) => (
            <div key={i} className="order-row">
              <input
                aria-label={`${col}: old value ${i + 1}`}
                className="ed-input"
                placeholder="old value"
                value={r.old}
                onChange={(e) => setRow(col, i, { old: e.target.value })}
              />
              <span className="order-rank">→</span>
              <input
                aria-label={`${col}: new value ${i + 1}`}
                className="ed-input"
                placeholder="new value (empty = missing)"
                value={r.nw}
                onChange={(e) => setRow(col, i, { nw: e.target.value })}
              />
              <button
                type="button"
                aria-label={`${col}: remove pair ${i + 1}`}
                className="order-btn"
                onClick={() => removeRow(col, i)}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary"
            aria-label={`${col}: add a pair`}
            onClick={() => addRow(col)}
          >
            + Add a pair
          </button>
        </div>
      ))}
      {!selected.length ? <span className="ed-help">Pick a column first.</span> : null}
    </div>
  );
}

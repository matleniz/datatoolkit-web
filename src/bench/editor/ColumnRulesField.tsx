import { useEffect, useState } from "react";
import type { ColumnKind } from "../../api/types";
import { Chips } from "../Chips";
import {
  dtypeOfKind,
  formatAllowed,
  MAX_COLUMN_RULES,
  parseAllowed,
  parseBound,
  patchRule,
  RULE_DTYPES,
  rulesOf,
  type ColumnRule,
  type RuleDtype,
} from "./columnRules";

type Columns = { name: string; kind: ColumnKind }[];

/** Text input that keeps what the user typed (e.g. "1.") while it commits the parsed value. */
function DraftInput({
  label,
  value,
  format,
  parse,
  onCommit,
  placeholder,
}: {
  label: string;
  value: unknown;
  format: (v: never) => string;
  parse: (text: string) => unknown;
  onCommit: (v: unknown) => void;
  placeholder?: string;
}) {
  const shown = value === undefined ? "" : (format as (v: unknown) => string)(value);
  const [text, setText] = useState(shown);
  // Params changed from outside (undo, the agent): take them, never our own echo.
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <input
      className="ed-input rule-input"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(parse(e.target.value));
      }}
    />
  );
}

function RuleRow({
  rule,
  index,
  onChange,
  onRemove,
}: {
  rule: ColumnRule;
  index: number;
  onChange: (r: ColumnRule) => void;
  onRemove: () => void;
}) {
  const at = (what: string) => `${rule.name || `rule ${index + 1}`}: ${what}`;
  const set = (patch: Partial<ColumnRule>) => onChange(patchRule(rule, patch));
  const flag = (key: "required" | "nullable" | "unique", off: boolean, text: string) => {
    const on = rule[key] ?? !off;
    return (
      <label className="rule-flag">
        <input
          type="checkbox"
          aria-label={at(text)}
          checked={on}
          // The engine default is not stored: only a deviation is sent.
          onChange={(e) => set({ [key]: e.target.checked === !off ? undefined : e.target.checked })}
        />
        {text}
      </label>
    );
  };
  const dtype = rule.dtype;
  return (
    <div className="rule-row" role="group" aria-label={`Rule ${rule.name || index + 1}`}>
      <div className="rule-head">
        <input
          className="ed-input rule-name"
          aria-label={`Rule ${index + 1}: column name`}
          placeholder="Column name"
          value={rule.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <button type="button" className="link-btn" aria-label={at("remove")} onClick={onRemove}>
          Remove
        </button>
      </div>
      <Chips
        small
        label={at("type")}
        options={RULE_DTYPES}
        isOn={(t) => dtype === t}
        onPick={(t) => set({ dtype: dtype === t ? undefined : (t as RuleDtype) })}
        chipLabel={(t) => at(`type ${t}`)}
      />
      <div className="rule-flags">
        {flag("required", false, "required")}
        {flag("nullable", false, "nullable")}
        {flag("unique", true, "unique")}
      </div>
      <div className="rule-bounds">
        <DraftInput
          label={at("min")}
          placeholder="min"
          value={rule.min}
          format={(v: number | string) => String(v)}
          parse={(t) => parseBound(t, dtype)}
          onCommit={(v) => set({ min: v as ColumnRule["min"] })}
        />
        <DraftInput
          label={at("max")}
          placeholder="max"
          value={rule.max}
          format={(v: number | string) => String(v)}
          parse={(t) => parseBound(t, dtype)}
          onCommit={(v) => set({ max: v as ColumnRule["max"] })}
        />
        <DraftInput
          label={at("max missing %")}
          placeholder="max missing %"
          value={rule.max_missing_pct}
          format={(v: number) => String(v)}
          parse={(t) => (t.trim() === "" || Number.isNaN(Number(t)) ? undefined : Number(t))}
          onCommit={(v) => set({ max_missing_pct: v as number | undefined })}
        />
      </div>
      <DraftInput
        label={at("allowed values")}
        placeholder="allowed values, comma separated"
        value={rule.allowed}
        format={formatAllowed}
        parse={(t) => parseAllowed(t, dtype)}
        onCommit={(v) => set({ allowed: v as ColumnRule["allowed"] })}
      />
    </div>
  );
}

/**
 * `expected_schema.columns`: one rule per column (type, required, nullable,
 * unique, bounds, allowed values). Rules for frame columns are one click away.
 */
export function ColumnRulesField({
  label,
  value,
  columns,
  onChange,
}: {
  label: string;
  value: unknown;
  columns: Columns;
  onChange: (rules: ColumnRule[]) => void;
}) {
  const rules = rulesOf(value);
  const ruled = new Set(rules.map((r) => r.name));
  const free = columns.filter((c) => !ruled.has(c.name));
  const full = rules.length >= MAX_COLUMN_RULES;
  const add = (name: string, kind?: ColumnKind) => {
    const dtype = dtypeOfKind(kind);
    onChange([...rules, dtype ? { name, dtype } : { name }]);
  };
  return (
    <div className="ed-field" data-ed-field="columns">
      <span className="ed-label">{label}</span>
      <span className="ed-help">
        One rule per column. Violations are listed under the preview; the data is never changed.
      </span>
      {free.length > 0 && !full ? (
        <Chips
          small
          label="Add a rule for a column"
          options={free.map((c) => c.name)}
          isOn={() => false}
          onPick={(n) => add(n, free.find((c) => c.name === n)?.kind)}
          chipLabel={(n) => `Add rule: ${n}`}
        />
      ) : null}
      {rules.map((r, i) => (
        <RuleRow
          // Rules are positional (names are editable), so the index is the identity.
          key={i}
          rule={r}
          index={i}
          onChange={(next) => onChange(rules.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(rules.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        className="btn-secondary"
        disabled={full}
        onClick={() => onChange([...rules, { name: "" }])}
      >
        Add a rule
      </button>
    </div>
  );
}

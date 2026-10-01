import { useEffect } from "react";
import { apiClient } from "../../api/client";
import type { ColumnKind, JsonValue } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { FormulaField } from "./FormulaField";
import { formatLearnedState } from "../format";
import { targetColumnOf } from "../left/datasetSource";
import { pickerPreset, resolveOp, toEngineParams } from "../presets";
import { Chips } from "../Chips";
import { fieldControl } from "../fieldControl";
import {
  featureOpColumnsNeedingImpute,
  imputeConstantNeedsNumber,
  stepParamsValid,
  fieldValuePresent,
  type EditorField,
} from "../schemaFields";
import {
  FITTING_OPS,
  OP_STAGE,
  STAGE_COLOR,
  STAGE_NAME,
  STAGES,
  stepSubLabel,
} from "../stages";
import { useWorkbenchData } from "../WorkbenchData";

const opLabel = (op: string) =>
  op.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Step picker: one button per op, grouped by stage, seeded from the selection. */
function OpPicker() {
  const { workspace, selection } = useAppState();
  const dispatch = useAppDispatch();
  const { columns, profiles, transforms } = useWorkbenchData();

  const open = async (op: string) => {
    const selected = selection.columns.flatMap(
      (name) => columns.find((c) => c.name === name) ?? [],
    );
    const target = workspace ? targetColumnOf(workspace) : null;
    // A schema error is shown by the editor itself: open it unseeded.
    const schema = await apiClient.transformSchema(op).catch(() => null);
    const params = schema
      ? toEngineParams(op, pickerPreset(schema, op, selected, target, profiles), schema)
      : {};
    dispatch({ type: "OPEN_EDITOR", op, params });
  };

  return (
    <aside className="step-editor" aria-label="Step editor" data-owner="W2">
      <div className="ed-head">
        <span className="ed-serif">Add a step</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => dispatch({ type: "CLOSE_EDITOR" })}
        >
          Cancel
        </button>
      </div>
      <p className="ed-help">
        Pick a transform. You set every parameter before anything is applied.
      </p>
      {STAGES.map((st) => {
        const ops = Object.keys(OP_STAGE).filter(
          (k) => OP_STAGE[k] === st.id && k !== "map_value",
        );
        if (!ops.length) return null;
        return (
          <div key={st.id} className="picker-group">
            <div className="picker-label">
              <span className="picker-dot" style={{ background: st.color }} />
              {st.label}
            </div>
            <div className="picker-grid">
              {ops.map((op) => {
                const info = transforms.find((t) => t.op === op);
                return (
                  <button
                    key={op}
                    type="button"
                    className={op === "formula" ? "picker-op formula" : "picker-op"}
                    title={info?.description ?? ""}
                    onClick={() => void open(op)}
                  >
                    {info?.title ?? opLabel(op)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

/** "Learned on train" box text for the current editor state. */
function learnedText(
  fits: boolean,
  state: {
    preview: { state: Record<string, JsonValue> } | null;
    schemaError: string | null;
    schemaLoading: boolean;
    paramsOk: boolean;
    editorBlocker: string | null;
    previewLoading: boolean;
  },
): string {
  if (!fits) return "Not fitted: nothing is learned on train";
  if (state.preview) return formatLearnedState(state.preview.state);
  if (state.schemaError) return "Fix the schema error to see what is learned.";
  if (state.schemaLoading) return "Loading parameters…";
  if (state.paramsOk && state.editorBlocker) return state.editorBlocker;
  if (state.paramsOk && state.previewLoading) return "Fitting on train…";
  return "Complete the parameters to see what is learned.";
}

/** Why Apply is disabled, for its tooltip. */
function applyTitle(
  formError: string | null,
  schemaLoading: boolean,
  previewLoading: boolean,
  isLatest: boolean,
): string {
  if (formError) return formError;
  if (schemaLoading) return "Loading parameters…";
  if (previewLoading) return "Waiting for preview…";
  if (!isLatest) return "Go back to the latest version first.";
  return "Complete the parameters";
}

/** W2 — step editor (replaces inspector when open). */
export function StepEditor() {
  const { editor, workspace } = useAppState();
  const dispatch = useAppDispatch();
  const {
    columns,
    profiles,
    transforms,
    schemaFields,
    schemaLoading,
    schemaError,
    editorBlocker,
    preview,
    previewError,
    pendingStep,
    pendingDiffText,
    previewLoading,
    applyPending,
    isLatest,
  } = useWorkbenchData();

  if (!editor) return null;
  if (!editor.op) return <OpPicker />;

  const op = resolveOp(editor.op);
  const stage = OP_STAGE[editor.op] ?? OP_STAGE[op] ?? "transform";
  const info = transforms.find((t) => t.op === op);
  const title = info?.title ?? op;
  const paramsValid = stepParamsValid(op, editor.params, schemaFields);
  const missingByColumn = new Map<string, number>();
  for (const [name, pr] of profiles) {
    missingByColumn.set(name, pr.missing);
  }
  const needImputeCols = featureOpColumnsNeedingImpute(
    op,
    editor.params,
    missingByColumn,
  );
  const formError =
    schemaError ||
    editorBlocker ||
    previewError ||
    (!paramsValid.ok ? paramsValid.missing : null) ||
    null;
  // Wait for schema + successful preview before Apply (slow Parkinson-sized
  // frames used to allow Apply during previewLoading — MAT-177).
  const canApply =
    !!pendingStep &&
    !previewError &&
    !schemaError &&
    !editorBlocker &&
    !schemaLoading &&
    !previewLoading &&
    isLatest;
  const learned = learnedText(FITTING_OPS.has(op), {
    preview,
    schemaError,
    schemaLoading,
    paramsOk: paramsValid.ok,
    editorBlocker,
    previewLoading,
  });
  let effectText = pendingDiffText || "no change on this view";
  if (!pendingStep) effectText = isLatest ? "—" : "Go back to the latest version first.";
  else if (previewLoading && !preview) effectText = "Computing preview…";

  return (
    <aside className="step-editor" aria-label="Step editor" data-owner="W2">
      <div className="ed-head">
        <span
          className="ed-kicker"
          style={{ color: STAGE_COLOR[stage] }}
        >
          New step · {STAGE_NAME[stage]}
        </span>
        <button
          type="button"
          className="link-btn"
          onClick={() => dispatch({ type: "OPEN_EDITOR", op: null })}
        >
          ← All transforms
        </button>
      </div>
      <div className="ed-serif ed-title">{title}</div>
      <div className="ed-what">{info?.description ?? ""}</div>

      <div className="ed-fields">
        {schemaLoading ? (
          <div className="ed-help" data-ed-schema-loading="">
            Loading parameters from the transform schema…
          </div>
        ) : null}
        {!schemaLoading && schemaError ? (
          <div className="ed-error" role="alert" data-ed-schema-error="">
            {schemaError}
          </div>
        ) : null}
        {!schemaLoading &&
          !schemaError &&
          schemaFields.length === 0 &&
          editor.op ? (
          <div className="ed-help" data-ed-schema-empty="">
            Loading parameters… if this persists, the transform schema may be
            empty or mismatched with this Studio build.
          </div>
        ) : null}
        {schemaFields.map((field) => (
          <Field
            key={field.key}
            field={field}
            columns={columns}
            params={editor.params}
            op={op}
            variables={workspace?.variables ?? []}
          />
        ))}

        <div className="ed-field">
          <span className="ed-label">Apply to</span>
          <div className="chip-row">
            {(
              [
                ["train", "Train only", "Fit and apply on train only"],
                ["both", "Train + test", "Fit on train, apply to both"],
                ["test", "Test only", "Fit and apply on test only (alignment)"],
              ] as const
            ).map(([t, label, tip]) => (
              <button
                key={t}
                type="button"
                className={editor.target === t ? "chip on" : "chip"}
                title={tip}
                onClick={() =>
                  dispatch({ type: "SET_EDITOR_TARGET", target: t })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ed-learned-box">
        <div className="ed-label-caps">Learned on train</div>
        <pre className="ed-learned">{learned}</pre>
        <div className="ed-label-caps" style={{ marginTop: 10 }}>
          Effect on this view
        </div>
        <div>
          {effectText}
        </div>
      </div>

      {(formError && !schemaError) || editorBlocker ? (
        <div className="ed-error" role="alert" data-ed-disabled-reason="">
          <div>{editorBlocker || previewError || paramsValid.missing}</div>
          {needImputeCols.length > 0 ? (
            <button
              type="button"
              className="link-btn"
              data-ed-open-impute=""
              style={{ marginTop: 6 }}
              onClick={() =>
                dispatch({
                  type: "OPEN_EDITOR",
                  op: "impute",
                  params: toEngineParams("impute", {
                    column: needImputeCols[0],
                    strategy: "median",
                  }),
                })
              }
            >
              Open Impute…
            </button>
          ) : null}
        </div>
      ) : null}
      {!canApply && formError ? (
        <div className="ed-help" data-ed-apply-hint="">
          Apply is disabled: {formError}
        </div>
      ) : null}

      <div className="ed-actions">
        <button
          type="button"
          className="btn-secondary grow"
          onClick={() => dispatch({ type: "CLOSE_EDITOR" })}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn-primary grow2"
          disabled={!canApply}
          title={
            canApply
              ? undefined
              : applyTitle(formError, schemaLoading, previewLoading, isLatest)
          }
          onClick={applyPending}
        >
          Apply step
        </button>
      </div>
      {pendingStep ? (
        <div className="ed-sub muted">
          {stepSubLabel(pendingStep.op, pendingStep.params)}
        </div>
      ) : null}
    </aside>
  );
}

type Columns = { name: string; kind: ColumnKind }[];

function MappingField({
  params,
  columns,
  onChange,
}: {
  params: Record<string, unknown>;
  columns: Columns;
  onChange: (m: Record<string, string>) => void;
}) {
  const mapping = (params.mapping as Record<string, string>) ?? {};
  const from = Object.keys(mapping)[0] ?? "";
  const to = from ? mapping[from]! : "";
  return (
    <div className="ed-field">
      <span className="ed-label">Column → new name</span>
      <Chips
        small
        options={columns.map((c) => c.name)}
        isOn={(n) => from === n}
        onPick={(n) => onChange({ [n]: to || n })}
      />
      <input
        aria-label="New name"
        className="ed-input"
        placeholder="new_name"
        value={to}
        onChange={(e) => {
          const v = e.target.value.replace(/[^A-Za-z0-9_]/g, "_");
          if (from) onChange({ [from]: v });
        }}
      />
    </div>
  );
}

function DtypesField({
  params,
  columns,
  onChange,
}: {
  params: Record<string, unknown>;
  columns: Columns;
  onChange: (d: Record<string, string>) => void;
}) {
  const dtypes = (params.dtypes as Record<string, string>) ?? {};
  const col = Object.keys(dtypes)[0] ?? "";
  const dtype = col ? dtypes[col]! : "float";
  return (
    <div className="ed-field">
      <span className="ed-label">Column</span>
      <Chips
        small
        options={columns.map((c) => c.name)}
        isOn={(n) => col === n}
        onPick={(n) => onChange({ [n]: dtype })}
      />
      <span className="ed-label">Type</span>
      <Chips
        options={["float", "int", "str", "bool"]}
        isOn={(t) => dtype === t}
        onPick={(t) => {
          if (col) onChange({ [col]: t });
        }}
      />
    </div>
  );
}

/** Synced from workspace.variables when applying formula; shown as info. */
function VariablesField({ label, count }: { label: string; count: number }) {
  return (
    <div className="ed-field">
      <span className="ed-label">{label}</span>
      <span className="ed-help">
        {count
          ? `${count} variable(s) from the workspace will be frozen on train.`
          : "@variables of the workspace are frozen on train when the step is fitted."}
      </span>
    </div>
  );
}

function Field({
  field,
  columns,
  params,
  op,
  variables,
}: {
  field: EditorField;
  columns: Columns;
  params: Record<string, unknown>;
  op: string;
  variables: { name: string; stat: string; column: string }[];
}) {
  const dispatch = useAppDispatch();

  if (field.whenStrategyConstant && params.strategy !== "constant") {
    return null;
  }

  const set = (key: string, value: unknown) => {
    dispatch({
      type: "SET_EDITOR_PARAMS",
      params: { ...params, [key]: value },
    });
  };
  const setOwn = (value: unknown) => set(field.key, value);

  switch (field.widget) {
    case "sentinels":
      return <SentinelsField params={params} columns={columns} onChange={setOwn} />;
    case "categories":
      return <CategoriesField params={params} columns={columns} onChange={setOwn} />;
    case "mapping":
      return <MappingField params={params} columns={columns} onChange={setOwn} />;
    case "dtypes":
      return <DtypesField params={params} columns={columns} onChange={setOwn} />;
    case "formula":
      return (
        <FormulaField
          label={field.label}
          expr={String(params.expr ?? "")}
          onExprChange={(next) => set("expr", next)}
          columns={columns}
          variables={variables}
          nameSet={Boolean(params.name)}
        />
      );
    case "variables":
      return (
        <VariablesField
          label={field.label}
          count={((params.variables as unknown[]) ?? []).length}
        />
      );
    case "conditions":
      return (
        <ConditionsField field={field} params={params} columns={columns} onChange={setOwn} />
      );
    default:
      return <GenericField field={field} columns={columns} params={params} op={op} set={setOwn} />;
  }
}

function GenericField({
  field,
  columns,
  params,
  op,
  set,
}: {
  field: EditorField;
  columns: Columns;
  params: Record<string, unknown>;
  op: string;
  set: (v: unknown) => void;
}) {
  // Engine fill_value is string | number; numeric columns must get a number
  // (string "0" raises), so it is typed as a number field for those.
  const fill = field.key === "fill_value";
  const fillNumeric = fill && imputeConstantNeedsNumber(params, columns);
  let placeholder: string | undefined;
  if (fill) placeholder = fillNumeric ? "e.g. 0" : "e.g. MISSING";
  const control = fieldControl(
    fill ? { ...field, widget: fillNumeric ? "number" : "text" } : field,
    params[field.key],
    set,
    columns,
    { placeholder },
  );
  if (!control) return null;
  const missing = field.required && !fieldValuePresent(params[field.key]);
  const columnWidget = field.widget === "column" || field.widget === "columns";
  let fillAttr: string | undefined;
  if (fill) fillAttr = fillNumeric ? "1" : "0";
  return (
    <div
      className={missing ? "ed-field ed-field-missing" : "ed-field"}
      data-ed-field={field.key}
      data-ed-missing={missing ? "1" : undefined}
      data-ed-fill-numeric={fillAttr}
    >
      <span className="ed-label">{field.label}</span>
      {field.description && columnWidget ? (
        <span className="ed-help">{field.description}</span>
      ) : null}
      {control}
      {op === "drop_duplicates" && field.key === "keep" ? (
        <span className="ed-help">
          keep first/last requires sort_by. Prefer an identifier column, or
          use keep none.
        </span>
      ) : null}
    </div>
  );
}

function SentinelsField({
  params,
  columns,
  onChange,
}: {
  params: Record<string, unknown>;
  columns: Columns;
  onChange: (s: Record<string, JsonValue[]>) => void;
}) {
  const sentinels = (params.sentinels as Record<string, JsonValue[]>) ?? {};
  const col = Object.keys(sentinels)[0] ?? "";
  const values = col ? sentinels[col]! : [-999];
  return (
    <div className="ed-field">
      <span className="ed-label">Column</span>
      <Chips
        small
        options={columns.map((c) => c.name)}
        isOn={(n) => col === n}
        onPick={(n) => onChange({ [n]: values.length ? values : [-999] })}
      />
      <span className="ed-label">Sentinel values (comma separated)</span>
      <input
        aria-label="Sentinel values"
        className="ed-input"
        value={values.map(String).join(", ")}
        onChange={(e) => {
          const raw = e.target.value
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== "")
            .map((x) => (Number.isNaN(Number(x)) ? x : Number(x)));
          if (col) onChange({ [col]: raw as JsonValue[] });
        }}
      />
    </div>
  );
}

function CategoriesField({
  params,
  columns,
  onChange,
}: {
  params: Record<string, unknown>;
  columns: Columns;
  onChange: (c: Record<string, JsonValue[]>) => void;
}) {
  const categories = (params.categories as Record<string, JsonValue[]>) ?? {};
  const col = Object.keys(categories)[0] ?? "";
  const order = col ? categories[col]! : [];
  const textCols = columns.filter((c) => c.kind === "text");
  const { selection } = useAppState();
  const { profiles } = useWorkbenchData();

  // Seed from the active grid column when opened with empty categories (MAT-155 #4).
  useEffect(() => {
    if (col) return;
    const active = selection.columns[0] ?? null;
    if (!active) return;
    const pr = profiles.get(active);
    const seeded = pr?.top_values?.map((t) => t.value) ?? [];
    onChange({ [active]: seeded });
  }, [col, selection.columns, profiles, onChange]);

  // Seed order from top_values when column is set but order is still empty.
  useEffect(() => {
    if (col && order.length === 0 && profiles.has(col)) {
      const pr = profiles.get(col);
      const seeded = pr?.top_values?.map((t) => t.value) ?? [];
      if (seeded.length > 0) {
        onChange({ [col]: seeded });
      }
    }
  }, [col, order.length, profiles, onChange]);

  const pickCol = (name: string) => {
    const pr = profiles.get(name);
    const seeded =
      order.length > 0 && col === name
        ? order
        : (pr?.top_values?.map((t) => t.value) ?? []);
    onChange({ [name]: seeded });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const a = order.slice();
    const [item] = a.splice(i, 1);
    a.splice(j, 0, item!);
    if (col) onChange({ [col]: a });
  };

  return (
    <div className="ed-field">
      <span className="ed-label">Column</span>
      <Chips
        small
        options={textCols.map((c) => c.name)}
        isOn={(n) => col === n}
        onPick={pickCol}
      />
      <span className="ed-label">Order, low → high</span>
      <div className="order-list">
        {order.map((o, i) => (
          <div key={`${String(o)}-${i}`} className="order-row">
            <span className="order-rank">{i}</span>
            <span className="order-text">{String(o)}</span>
            <button
              type="button"
              aria-label="Move up"
              className="order-btn"
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move down"
              className="order-btn"
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      {!order.length ? (
        <span className="ed-help">
          {col
            ? "No categories yet for this column."
            : "Pick a column first."}
        </span>
      ) : null}
    </div>
  );
}

function ConditionsField({
  field,
  params,
  columns,
  onChange,
}: {
  field: EditorField;
  params: Record<string, unknown>;
  columns: { name: string; kind: ColumnKind }[];
  onChange: (
    conditions: Array<{ column: string; op: string; value: unknown }>,
  ) => void;
}) {
  const conditions =
    (params.conditions as
      | Array<{ column: string; op: string; value: unknown }>
      | undefined) ?? [];
  const operators = field.enumValues ?? [
    "eq",
    "ne",
    "gt",
    "ge",
    "lt",
    "le",
    "isin",
    "notin",
    "isna",
    "notna",
  ];

  useEffect(() => {
    if (conditions.length === 0 && columns.length > 0) {
      onChange([
        {
          column: columns[0]?.name ?? "",
          op: "gt",
          value: 0,
        },
      ]);
    }
  }, [conditions.length, columns, onChange]);

  const updateCondition = (
    index: number,
    patch: Partial<{ column: string; op: string; value: unknown }>,
  ) => {
    const next = conditions.map((c, i) => {
      if (i !== index) return c;
      const updated = { ...c, ...patch };
      if (patch.op === "isna" || patch.op === "notna") {
        updated.value = null;
      } else if (
        (patch.op === "isin" || patch.op === "notin") &&
        !Array.isArray(updated.value)
      ) {
        updated.value =
          updated.value !== undefined && updated.value !== null
            ? [updated.value]
            : [];
      }
      return updated;
    });
    onChange(next);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const addCondition = () => {
    const firstCol = columns[0]?.name ?? "";
    onChange([
      ...conditions,
      {
        column: firstCol,
        op: "gt",
        value: 0,
      },
    ]);
  };

  return (
    <div className="ed-field" data-conditions-field>
      <span className="ed-label">{field.label}</span>
      <div
        className="conditions-list"
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        {conditions.map((c, idx) => {
          const isNullOp = c.op === "isna" || c.op === "notna";
          const isListOp = c.op === "isin" || c.op === "notin";
          const displayVal =
            c.value === null || c.value === undefined
              ? ""
              : Array.isArray(c.value)
                ? c.value.join(", ")
                : String(c.value);

          return (
            <div
              key={idx}
              className="condition-row"
              data-condition-row={idx}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <select
                aria-label={`Condition ${idx + 1} column`}
                className="ed-select"
                value={c.column}
                onChange={(e) =>
                  updateCondition(idx, { column: e.target.value })
                }
                style={{ flex: 1, minWidth: 100 }}
              >
                {columns.map((col) => (
                  <option key={col.name} value={col.name}>
                    {col.name}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Condition ${idx + 1} operator`}
                className="ed-select"
                value={c.op}
                onChange={(e) => updateCondition(idx, { op: e.target.value })}
                style={{ width: 100 }}
              >
                {operators.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>

              {!isNullOp ? (
                <input
                  aria-label={`Condition ${idx + 1} value`}
                  className="ed-input"
                  style={{ flex: 1, minWidth: 80 }}
                  placeholder={isListOp ? "val1, val2" : "value"}
                  value={displayVal}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (isListOp) {
                      const list = raw
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .map((s) => (Number.isNaN(Number(s)) ? s : Number(s)));
                      updateCondition(idx, { value: list });
                    } else {
                      const num = Number(raw);
                      const parsed =
                        raw.trim() !== "" && !Number.isNaN(num) ? num : raw;
                      updateCondition(idx, { value: parsed });
                    }
                  }}
                />
              ) : (
                <div
                  style={{
                    flex: 1,
                    color: "var(--dtk-muted)",
                    fontSize: 12,
                    paddingLeft: 4,
                  }}
                >
                  ∅
                </div>
              )}

              {conditions.length > 1 ? (
                <button
                  type="button"
                  className="small-chip"
                  aria-label={`Remove condition ${idx + 1}`}
                  onClick={() => removeCondition(idx)}
                  title="Remove condition"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6 }}>
        <button
          type="button"
          className="link-btn"
          onClick={addCondition}
          aria-label="Add condition"
        >
          + Add condition
        </button>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import type { ColumnKind, JsonValue } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { FormulaField } from "./FormulaField";
import { formatLearnedState } from "../format";
import { isNumericKind } from "../kinds";
import { targetColumnOf } from "../left/datasetSource";
import { resolveOp, toEngineParams } from "../presets";
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

const WHAT: Record<string, string> = {
  replace_sentinels:
    "Turns placeholder values such as -999 or \"N/A\" into real missing values.",
  impute:
    "Fills missing values with a statistic learned on train. The same value fills test.",
  onehot:
    "One 0/1 column per train category. A test category never seen in train becomes all zeros.",
  standardize_text:
    "Strips spaces and/or lowercases so spelling variants become one category. Optionally unify separators (- _ .) into spaces.",
  to_numeric:
    "Parses text numbers with currency symbols, thousands / decimal separators, and optional % into floats.",
  extract:
    "Pulls named regex groups from a text column into new typed columns.",
  drop_high_missing:
    "Drops columns whose train missing fraction exceeds a threshold. The same columns are dropped on test.",
  formula:
    "Your own column from an expression over columns, numbers, functions and @variables.",
  polynomial:
    "Expand numeric columns into polynomial features (readable names like a^2, a*b).",
  power_transform:
    "Yeo-Johnson / Box-Cox power map; lambdas learned on train.",
  quantile_transform:
    "Map values to a uniform or normal distribution using train quantiles.",
  spline:
    "Expand numeric columns into B-spline basis functions (knots learned on train).",
  drop_columns: "Removes columns from the frames the step applies to.",
  drop_duplicates:
    "Removes rows identical on the subset. keep first/last requires sort_by.",
  clip: "Caps values at percentiles learned on train.",
  scale: "Standard / robust / min-max scaling; statistics come from train.",
  rename: "Renames columns.",
  cast: "Converts columns to another type.",
  ordinal: "Replaces each category by its rank in the order you set.",
  log1p: "Replaces x by log(1 + x).",
  parse_dates: "Parses text into dates.",
  filter_rows:
    "Keep rows matching conditions (e.g. column > value or column not missing).",
};

/** W2 — step editor (replaces inspector when open). */
export function StepEditor() {
  const { editor, workspace, selection } = useAppState();
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

  if (!editor.op) {
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
                <span
                  className="picker-dot"
                  style={{ background: st.color }}
                />
                {st.label}
              </div>
              <div className="picker-grid">
                {ops.map((op) => {
                  const info = transforms.find((t) => t.op === op);
                  const title =
                    info?.title ??
                    op.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  const sel1 = selection.columns[0];
                  const preset: Record<string, unknown> = {};
                  const target = workspace ? targetColumnOf(workspace) : null;
                  if (target) {
                    if (
                      [
                        "select_k_best",
                        "select_from_model",
                        "drop_missing_target",
                        "drop_high_missing",
                        "drop_low_variance",
                        "drop_correlated",
                        "pca",
                        "group_agg",
                      ].includes(op)
                    ) {
                      preset.target = target;
                    }
                  }
                  if (sel1) {
                    const pr = profiles.get(sel1);
                    const isNum = pr ? isNumericKind(pr.kind) : false;
                    if (
                      [
                        "impute",
                        "onehot",
                        "clip",
                        "log1p",
                        "parse_dates",
                        "standardize_text",
                        "replace_sentinels",
                        "to_numeric",
                        "extract",
                      ].includes(op)
                    ) {
                      preset.column = sel1;
                      if (op === "replace_sentinels") preset.values = [-999];
                      if (op === "to_numeric" && pr?.currency_as_text) {
                        const fmt = pr.currency_as_text;
                        preset.decimal = fmt.decimal;
                        preset.thousands = fmt.thousands;
                        preset.percent = fmt.percent;
                      }
                    }
                    // Seed ordinal from the active column even when kind is not
                    // yet "text" so + Step does not require a second chip click.
                    if (op === "ordinal") {
                      preset.column = sel1;
                    }
                    if ((op === "bin" || op === "cyclical") && isNum) {
                      preset.column = sel1;
                    }
                    if (
                      op === "scale" ||
                      op === "drop_columns" ||
                      op === "impute_knn" ||
                      op === "impute_iterative" ||
                      op === "interactions" ||
                      op === "polynomial" ||
                      op === "power_transform" ||
                      op === "quantile_transform" ||
                      op === "spline" ||
                      op === "align_to_train"
                    ) {
                      preset.columns = selection.columns.slice();
                    }
                    if (op === "ffill") {
                      preset.sort_by = sel1;
                    }
                    if (op === "group_agg") {
                      preset.group = sel1;
                      if (selection.columns.length > 1) {
                        preset.value = selection.columns[1];
                      }
                    }
                    if (op === "drop_missing_target" && !preset.target) {
                      preset.target = sel1;
                    }
                    if (op === "rename" || op === "cast") {
                      preset.column = sel1;
                    }
                    if (op === "formula") preset.expr = sel1;
                    if (op === "filter_rows") {
                      const pr = profiles.get(sel1);
                      const isNum = pr ? isNumericKind(pr.kind) : false;
                      preset.conditions = [
                        {
                          column: sel1,
                          op: isNum ? "gt" : "notna",
                          value: isNum ? 0 : null,
                        },
                      ];
                      preset.combine = "and";
                    }
                  }
                  if (op === "filter_rows" && !preset.conditions) {
                    const col = columns[0]?.name ?? "";
                    preset.conditions = [
                      {
                        column: col,
                        op: "gt",
                        value: 0,
                      },
                    ];
                    preset.combine = "and";
                  }
                  return (
                    <button
                      key={op}
                      type="button"
                      className={
                        op === "formula" ? "picker-op formula" : "picker-op"
                      }
                      title={info?.description ?? WHAT[op] ?? ""}
                      onClick={() =>
                        dispatch({
                          type: "OPEN_EDITOR",
                          op,
                          params: toEngineParams(op, preset),
                        })
                      }
                    >
                      {title}
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

  const op = resolveOp(editor.op);
  const stage = OP_STAGE[editor.op] ?? OP_STAGE[op] ?? "transform";
  const info = transforms.find((t) => t.op === op);
  const title = info?.title ?? op;
  const what = WHAT[op] ?? info?.description ?? "";
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
  const fits = FITTING_OPS.has(op);
  let learned: string;
  if (!fits) {
    learned = "Not fitted: nothing is learned on train";
  } else if (preview) {
    learned = formatLearnedState(preview.state);
  } else if (schemaError) {
    learned = "Fix the schema error to see what is learned.";
  } else if (schemaLoading) {
    learned = "Loading parameters…";
  } else if (!paramsValid.ok) {
    learned = "Complete the parameters to see what is learned.";
  } else if (editorBlocker) {
    learned = editorBlocker;
  } else if (previewLoading) {
    learned = "Fitting on train…";
  } else {
    learned = "Complete the parameters to see what is learned.";
  }

  const effectText = !pendingStep
    ? isLatest
      ? "—"
      : "Go back to the latest version first."
    : previewLoading && !preview
      ? "Computing preview…"
      : pendingDiffText || "no change on this view";

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
      <div className="ed-what">{what}</div>

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
            !canApply
              ? formError ||
                (schemaLoading
                  ? "Loading parameters…"
                  : previewLoading
                    ? "Waiting for preview…"
                    : !isLatest
                      ? "Go back to the latest version first."
                      : "Complete the parameters")
              : undefined
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

function Field({
  field,
  columns,
  params,
  op,
  variables,
}: {
  field: EditorField;
  columns: { name: string; kind: ColumnKind }[];
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

  if (field.widget === "sentinels") {
    return (
      <SentinelsField
        params={params}
        columns={columns}
        onChange={(sentinels) => set("sentinels", sentinels)}
      />
    );
  }

  if (field.widget === "categories") {
    return (
      <CategoriesField
        params={params}
        columns={columns}
        onChange={(categories) => set("categories", categories)}
      />
    );
  }

  if (field.widget === "mapping") {
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
          onPick={(n) => set("mapping", { [n]: to || n })}
        />
        <input
          aria-label="New name"
          className="ed-input"
          placeholder="new_name"
          value={to}
          onChange={(e) => {
            const v = e.target.value.replace(/[^A-Za-z0-9_]/g, "_");
            if (from) set("mapping", { [from]: v });
          }}
        />
      </div>
    );
  }

  if (field.widget === "dtypes") {
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
          onPick={(n) => set("dtypes", { [n]: dtype })}
        />
        <span className="ed-label">Type</span>
        <Chips
          options={["float", "int", "str", "bool"]}
          isOn={(t) => dtype === t}
          onPick={(t) => {
            if (col) set("dtypes", { [col]: t });
          }}
        />
      </div>
    );
  }

  if (field.widget === "formula") {
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
  }

  if (field.widget === "variables") {
    // Synced from workspace.variables when applying formula; shown as info.
    const vars = (params.variables as unknown[]) ?? [];
    return (
      <div className="ed-field">
        <span className="ed-label">{field.label}</span>
        <span className="ed-help">
          {vars.length
            ? `${vars.length} variable(s) from the workspace will be frozen on train.`
            : "@variables of the workspace are frozen on train when the step is fitted."}
        </span>
      </div>
    );
  }

  if (field.widget === "conditions") {
    return (
      <ConditionsField
        field={field}
        params={params}
        columns={columns}
        onChange={(conditions) => set("conditions", conditions)}
      />
    );
  }

  // Engine fill_value is string | number; numeric columns must get a number
  // (string "0" raises), so it is typed as a number field for those.
  const fill = field.key === "fill_value";
  const fillNumeric = fill && imputeConstantNeedsNumber(params, columns);
  const control = fieldControl(
    fill ? { ...field, widget: fillNumeric ? "number" : "text" } : field,
    params[field.key],
    (v) => set(field.key, v),
    columns,
    { placeholder: fill ? (fillNumeric ? "e.g. 0" : "e.g. MISSING") : undefined },
  );
  if (!control) return null;
  const missing = field.required && !fieldValuePresent(params[field.key]);
  return (
    <div
      className={missing ? "ed-field ed-field-missing" : "ed-field"}
      data-ed-field={field.key}
      data-ed-missing={missing ? "1" : undefined}
      data-ed-fill-numeric={fill ? (fillNumeric ? "1" : "0") : undefined}
    >
      <span className="ed-label">{field.label}</span>
      {field.description &&
      (field.widget === "column" || field.widget === "columns") ? (
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
  columns: { name: string; kind: ColumnKind }[];
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
  columns: { name: string; kind: ColumnKind }[];
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

import type { ColumnKind, JsonValue } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { formulaPlaceholder } from "./formulaPlaceholder";
import { formatLearnedState } from "../format";
import { isNumericKind } from "../kinds";
import { resolveOp, toEngineParams } from "../presets";
import {
  filterColumnsByDtype,
  stepParamsValid,
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

const FUNCS_OPS = [
  "log1p(",
  "sqrt(",
  "abs(",
  "min(",
  "max(",
  "+",
  "−",
  "×",
  "÷",
  "(",
  ")",
] as const;

const WHAT: Record<string, string> = {
  replace_sentinels:
    "Turns placeholder values such as -999 or \"N/A\" into real missing values.",
  impute:
    "Fills missing values with a statistic learned on train. The same value fills test.",
  onehot:
    "One 0/1 column per train category. A test category never seen in train becomes all zeros.",
  standardize_text:
    "Strips spaces and/or lowercases so spelling variants become one category.",
  formula:
    "Your own column from an expression over columns, numbers, functions and @variables.",
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
};

/** W2 — step editor (replaces inspector when open). */
export function StepEditor() {
  const { editor, workspace, selection } = useAppState();
  const dispatch = useAppDispatch();
  const {
    columns,
    transforms,
    schemaFields,
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
                  if (sel1) {
                    if (
                      [
                        "impute",
                        "onehot",
                        "clip",
                        "log1p",
                        "parse_dates",
                        "standardize_text",
                        "replace_sentinels",
                      ].includes(op)
                    ) {
                      preset.column = sel1;
                      if (op === "replace_sentinels") preset.values = [-999];
                    }
                    if (op === "scale" || op === "drop_columns") {
                      preset.columns = selection.columns.slice();
                    }
                    if (op === "rename" || op === "cast") {
                      preset.column = sel1;
                    }
                    if (op === "formula") preset.expr = sel1;
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
  const canApply = !!pendingStep && !previewError && isLatest;
  const fits = FITTING_OPS.has(op);
  let learned: string;
  if (!fits) {
    learned = "Not fitted: nothing is learned on train";
  } else if (preview) {
    learned = formatLearnedState(preview.state);
  } else if (!paramsValid.ok) {
    learned = "Complete the parameters to see what is learned.";
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

      {(previewError || (!paramsValid.ok && paramsValid.missing)) && (
        <div className="ed-error" role="alert">
          {previewError || paramsValid.missing}
        </div>
      )}

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
  const { preview, previewError } = useWorkbenchData();

  if (field.whenStrategyConstant && params.strategy !== "constant") {
    return null;
  }

  const set = (key: string, value: unknown) => {
    dispatch({
      type: "SET_EDITOR_PARAMS",
      params: { ...params, [key]: value },
    });
  };

  const eligible = filterColumnsByDtype(columns, field.dtypeFilter);

  if (field.widget === "columns" || field.widget === "column") {
    const multi = field.widget === "columns";
    const current = multi
      ? ((params[field.key] as string[] | null | undefined) ?? [])
      : params[field.key]
        ? [String(params[field.key])]
        : [];
    return (
      <div className="ed-field">
        <span className="ed-label">{field.label}</span>
        <div className="chip-row">
          {eligible.map((n) => {
            const on = current.includes(n);
            return (
              <button
                key={n}
                type="button"
                className={on ? "small-chip on" : "small-chip"}
                onClick={() => {
                  if (multi) {
                    const a = [...current];
                    const i = a.indexOf(n);
                    if (i >= 0) a.splice(i, 1);
                    else a.push(n);
                    set(field.key, a);
                  } else {
                    set(field.key, n);
                  }
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        {!eligible.length ? (
          <span className="ed-help">No matching column.</span>
        ) : null}
      </div>
    );
  }

  if (field.widget === "enum") {
    return (
      <div className="ed-field">
        <span className="ed-label">{field.label}</span>
        <div className="chip-row">
          {(field.enumValues ?? []).map((o) => (
            <button
              key={o}
              type="button"
              className={params[field.key] === o ? "chip on" : "chip"}
              onClick={() => set(field.key, o)}
            >
              {o}
            </button>
          ))}
        </div>
        {op === "drop_duplicates" && field.key === "keep" ? (
          <span className="ed-help">
            keep first/last requires sort_by. Prefer an identifier column, or
            use keep none.
          </span>
        ) : null}
      </div>
    );
  }

  if (field.widget === "bool") {
    return (
      <div className="ed-field">
        <span className="ed-label">{field.label}</span>
        <div className="chip-row">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              className={params[field.key] === b ? "chip on" : "chip"}
              onClick={() => set(field.key, b)}
            >
              {b ? "yes" : "no"}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.widget === "number" || field.widget === "text") {
    const rawVal = params[field.key];
    const display =
      rawVal === null || rawVal === undefined ? "" : String(rawVal);
    return (
      <div className="ed-field">
        <span className="ed-label">{field.label}</span>
        <input
          aria-label={field.label}
          className="ed-input"
          value={display}
          placeholder={field.widget === "number" ? "optional" : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (field.widget === "number") {
              if (raw.trim() === "") {
                set(field.key, null);
                return;
              }
              const v = Number(raw);
              set(field.key, Number.isNaN(v) ? null : v);
            } else if (field.key === "name") {
              set(field.key, raw.replace(/[^A-Za-z0-9_]/g, "_"));
            } else {
              set(field.key, raw);
            }
          }}
        />
      </div>
    );
  }

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
        <div className="chip-row">
          {columns.map((c) => (
            <button
              key={c.name}
              type="button"
              className={from === c.name ? "small-chip on" : "small-chip"}
              onClick={() => set("mapping", { [c.name]: to || c.name })}
            >
              {c.name}
            </button>
          ))}
        </div>
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
        <div className="chip-row">
          {columns.map((c) => (
            <button
              key={c.name}
              type="button"
              className={col === c.name ? "small-chip on" : "small-chip"}
              onClick={() => set("dtypes", { [c.name]: dtype })}
            >
              {c.name}
            </button>
          ))}
        </div>
        <span className="ed-label">Type</span>
        <div className="chip-row">
          {["float", "int", "str", "bool"].map((t) => (
            <button
              key={t}
              type="button"
              className={dtype === t ? "chip on" : "chip"}
              onClick={() => {
                if (col) set("dtypes", { [col]: t });
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.widget === "formula") {
    const expr = String(params.expr ?? "");
    const insert = (txt: string) => {
      const next = `${expr.replace(/\s+$/, "")} ${txt}`.trim();
      set("expr", next);
    };
    const numCols = columns.filter((c) => isNumericKind(c.kind));
    let status =
      "Columns, numbers, @variables, + − × ÷ ^ ( ), log log1p exp sqrt abs round min max.";
    let statusClass = "formula-status muted";
    if (previewError) {
      status = previewError;
      statusClass = "formula-status err";
    } else if (preview && params.name) {
      status = "OK · expression accepted by the engine";
      statusClass = "formula-status ok";
    }
    return (
      <div className="ed-field">
        <span className="ed-label">{field.label}</span>
        <input
          aria-label="Expression"
          className="ed-input formula"
          value={expr}
          placeholder={formulaPlaceholder(columns, variables)}
          onChange={(e) => set("expr", e.target.value)}
        />
        <span className="ed-help">Insert a column</span>
        <div className="chip-row">
          {numCols.map((c) => (
            <button
              key={c.name}
              type="button"
              className="tiny-chip"
              onClick={() => insert(c.name)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <span className="ed-help">Variables, functions, operators</span>
        <div className="chip-row">
          {variables.map((v) => (
            <button
              key={v.name}
              type="button"
              className="tiny-chip var"
              onClick={() => insert(`@${v.name}`)}
            >
              @{v.name}
            </button>
          ))}
          {FUNCS_OPS.map((t) => {
            const ins =
              ({ "−": "-", "×": "*", "÷": "/" } as Record<string, string>)[t] ??
              t;
            return (
              <button
                key={t}
                type="button"
                className="tiny-chip"
                onClick={() => insert(ins)}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div className={statusClass}>{status}</div>
      </div>
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
            : "Insert @variables from the Variables tab; they are frozen when the step is fitted."}
        </span>
      </div>
    );
  }

  return null;
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
      <div className="chip-row">
        {columns.map((c) => (
          <button
            key={c.name}
            type="button"
            className={col === c.name ? "small-chip on" : "small-chip"}
            onClick={() => onChange({ [c.name]: values.length ? values : [-999] })}
          >
            {c.name}
          </button>
        ))}
      </div>
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

  // Seed order from top_values when column picked empty — left to caller via profiles.
  const { profiles } = useWorkbenchData();

  const pickCol = (name: string) => {
    const pr = profiles.get(name);
    const seeded =
      order.length > 0
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
      <div className="chip-row">
        {textCols.map((c) => (
          <button
            key={c.name}
            type="button"
            className={col === c.name ? "small-chip on" : "small-chip"}
            onClick={() => pickCol(c.name)}
          >
            {c.name}
          </button>
        ))}
      </div>
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
        <span className="ed-help">Pick a column first.</span>
      ) : null}
    </div>
  );
}

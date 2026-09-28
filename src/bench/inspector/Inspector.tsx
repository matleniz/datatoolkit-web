import { useState, type ReactNode } from "react";

import type { ColumnKind, JsonValue } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import { colAlerts, profileBars } from "../alerts";
import { chartPrefillFromSelection } from "../dock/chartPrefill";
import {
  fmt,
  fmtPreview,
  isNull,
  TEXT_PREVIEW_CHARS,
  truncateText,
} from "../format";
import { isNumericKind, isTextKind, KIND_LABEL } from "../kinds";
import { toEngineParams } from "../presets";
import { useWorkbenchData } from "../WorkbenchData";
import { buildValueGroups } from "./valueGroups";

function openChart(
  dispatch: ReturnType<typeof useAppDispatch>,
  cols: { name: string; kind: ColumnKind | string }[],
) {
  dispatch({
    type: "SET_CHART_DRAFT",
    draft: chartPrefillFromSelection(cols),
  });
  dispatch({ type: "OPEN_TOOL", id: "chart" });
}

/** W2 — column / row / cell inspector (318px). */
export function Inspector() {
  const { selection, targetColumn } = useAppState();
  const dispatch = useAppDispatch();
  const {
    columns,
    rows,
    profiles,
    isLatest,
    display,
    identity,
    profilesIdentity,
  } = useWorkbenchData();
  // MAT-175: which frame the stats come from (profiles lag rows briefly).
  const identityAttrs = {
    "data-identity": profilesIdentity ?? "",
    "data-identity-current": identity.key,
  };

  const openEd = (
    op: string,
    params: Record<string, unknown> = {},
    target: "train" | "test" | "both" = "both",
  ) => {
    if (!isLatest) return;
    dispatch({
      type: "OPEN_EDITOR",
      op,
      params: toEngineParams(op, params),
      target,
    });
  };

  const selCols = selection.columns.filter(
    (c) =>
      columns.some((x) => x.name === c) ||
      display.cols.some((x) => x.name === c),
  );

  const btn = (
    title: string,
    onClick: () => void,
    opts?: { tool?: boolean; disabled?: boolean; tip?: string },
  ) => (
    <button
      key={title}
      type="button"
      className={opts?.tool ? "insp-btn tool" : "insp-btn"}
      title={opts?.tip}
      disabled={opts?.disabled || (!opts?.tool && !isLatest)}
      onClick={onClick}
    >
      {title}
    </button>
  );

  // Cell
  if (selection.cell) {
    const { rid, col } = selection.cell;
    const row = rows.find((r) => r._rid === rid);
    const meta = columns.find((c) => c.name === col);
    const kind = meta?.kind ?? "text";
    const cv = row?.[col];
    const actions: ReactNode[] = [];
    if (isNull(cv)) {
      actions.push(
        btn(`Impute ${col}…`, () =>
          openEd("impute", {
            column: col,
            strategy: isNumericKind(kind) ? "median" : "most_frequent",
          }),
        ),
      );
    } else {
      const label =
        typeof cv === "string"
          ? `“${fmtPreview(cv, 40)}”`
          : fmtPreview(cv as JsonValue, 40);
      actions.push(
        btn(`Treat ${label} as missing…`, () =>
          openEd("replace_sentinels", { column: col, values: [cv] }),
        ),
      );
      if (isTextKind(kind)) {
        actions.push(
          btn("Map this value to…", () =>
            openEd("map_value", {
              column: col,
              from: String(cv),
              to: String(cv).trim().toLowerCase(),
            }),
          ),
        );
      }
    }
    return (
      <aside
        className="inspector"
        aria-label="Inspector"
        data-owner="W2"
        {...identityAttrs}
      >
        <div className="insp-scroll">
          <div className="insp-kicker">Cell · row {rid + 1}</div>
          <div className="insp-title">{col}</div>
          <div className="insp-chips">
            <span className="insp-chip">{KIND_LABEL[kind]}</span>
          </div>
          <div className="insp-cell-box">
            <div className="ed-help">Current value</div>
            {isNull(cv) ? (
              <div className="insp-cell-value">missing</div>
            ) : typeof cv === "string" ? (
              <TruncatedText value={cv} quoted />
            ) : (
              <div className="insp-cell-value">{fmt(cv as JsonValue)}</div>
            )}
            <div className="ed-help">
              An edit is saved as a rule over every matching cell, not as a
              patch: it replays on test and on any new file.
            </div>
          </div>
          {!isLatest ? <OldBanner /> : null}
          <Group label="Turn into a rule">{actions}</Group>
        </div>
      </aside>
    );
  }

  // Row
  if (selection.row !== null) {
    const rid = selection.row;
    const row = rows.find((r) => r._rid === rid);
    if (!row) {
      return <EmptyInspector />;
    }
    const issues: { text: string; warn: boolean }[] = [];
    const fields = columns.map((c) => {
      const v = row[c.name];
      const bad = isNull(v) || (v === -999 && c.kind === "number");
      if (bad) {
        issues.push({
          text: `${c.name}${isNull(v) ? " missing" : " = -999"}`,
          warn: true,
        });
      }
      return {
        k: c.name,
        v:
          typeof v === "string"
            ? v !== v.trim()
              ? `“${fmtPreview(v)}”`
              : fmtPreview(v)
            : fmt(v as JsonValue),
        bad,
      };
    });
    return (
      <aside
        className="inspector"
        aria-label="Inspector"
        data-owner="W2"
        {...identityAttrs}
      >
        <div className="insp-scroll">
          <div className="insp-kicker">Row</div>
          <div className="insp-title">
            #{rid + 1}
            {row.customer_id ? ` · ${String(row.customer_id)}` : ""}
          </div>
          <div className="insp-chips">
            {issues.length ? (
              issues.map((i) => (
                <span key={i.text} className="insp-chip warn">
                  {i.text}
                </span>
              ))
            ) : (
              <span className="insp-chip ok">nothing unusual</span>
            )}
          </div>
          <div className="insp-fields">
            {fields.map((f) => (
              <div key={f.k} className="insp-field-row">
                <span>{f.k}</span>
                <span className={f.bad ? "bad-val" : "mono"}>{f.v}</span>
              </div>
            ))}
          </div>
          {!isLatest ? <OldBanner /> : null}
          <Group label="Actions">
            {btn("Drop duplicates…", () =>
              openEd(
                "drop_duplicates",
                {
                  keep: "none",
                  sort_by: null,
                },
                "train",
              ),
            )}
          </Group>
        </div>
      </aside>
    );
  }

  // Multi
  if (selCols.length > 1) {
    const numSel = selCols.filter((c) => {
      const k = columns.find((x) => x.name === c)?.kind;
      return isNumericKind(k);
    });
    return (
      <aside
        className="inspector"
        aria-label="Inspector"
        data-owner="W2"
        {...identityAttrs}
      >
        <div className="insp-scroll">
          <div className="insp-kicker">{selCols.length} columns</div>
          <div className="insp-title">{selCols.join(", ")}</div>
          <div className="insp-chips">
            <span className="insp-chip">{numSel.length} numeric</span>
          </div>
          {!isLatest ? <OldBanner /> : null}
          <Group label="Analyse">
            {btn(
              "Compare",
              () => dispatch({ type: "OPEN_TOOL", id: "compare" }),
              { tool: true },
            )}
            {btn(
              "Correlation",
              () => dispatch({ type: "OPEN_TOOL", id: "corr" }),
              { tool: true },
            )}
            {btn(
              "Chart…",
              () =>
                openChart(
                  dispatch,
                  selCols.map((name) => {
                    const k =
                      columns.find((x) => x.name === name)?.kind ?? "text";
                    return { name, kind: k };
                  }),
                ),
              { tool: true },
            )}
          </Group>
          <Group label="Transform">
            {numSel.length === 2
              ? btn(`Derive ${numSel[0]} ÷ ${numSel[1]}…`, () =>
                  openEd("derive", {
                    a: numSel[0],
                    b: numSel[1],
                    op: "ratio",
                  }),
                )
              : null}
            {btn("New feature…", () =>
              openEd("formula", { expr: "", name: "" }),
            )}
            {numSel.length
              ? btn("Polynomial features…", () =>
                  openEd("polynomial", {
                    columns: numSel.slice(),
                    degree: 2,
                  }),
                )
              : null}
            {numSel.length
              ? btn("Power transform…", () =>
                  openEd("power_transform", { columns: numSel.slice() }),
                )
              : null}
            {numSel.length
              ? btn("Quantile transform…", () =>
                  openEd("quantile_transform", {
                    columns: numSel.slice(),
                  }),
                )
              : null}
            {numSel.length
              ? btn(`Scale ${numSel.length}…`, () =>
                  openEd("scale", {
                    columns: numSel.filter(
                      (c) =>
                        columns.find((x) => x.name === c)?.kind === "number",
                    ),
                  }),
                )
              : null}
            {btn(`Drop ${selCols.length}…`, () =>
              openEd("drop_columns", {
                columns: selCols.filter((c) => c !== targetColumn),
              }),
            )}
          </Group>
        </div>
      </aside>
    );
  }

  // Single column
  if (selCols.length === 1) {
    const c1 = selCols[0]!;
    const meta = columns.find((c) => c.name === c1);
    const k1 = (meta?.kind ?? "text") as ColumnKind;
    const pr = profiles.get(c1);
    const isT1 = c1 === targetColumn;
    const alerts = colAlerts(pr);
    const bars = pr ? profileBars(pr, 64, 6) : [];

    const stats: [string, string][] = pr
      ? [
          ["non-null", String(pr.count - pr.missing)],
          ["missing", String(pr.missing)],
          ["distinct", String(pr.distinct)],
        ]
      : [];
    if (pr && k1 === "number" && pr.histogram) {
      /* mean etc. not in profile — show outliers / sentinels */
      const sent = pr.sentinel_candidates[0];
      if (sent) stats.push([String(sent.value), String(sent.count)]);
      if (pr.outliers) stats.push(["outliers", String(pr.outliers)]);
    } else if (pr?.top_values?.[0]) {
      stats.push([
        "top",
        `${String(pr.top_values[0].value)} (${pr.top_values[0].count})`,
      ]);
    }

    const analyse = [
      btn(
        "Distribution",
        () => {
          dispatch({ type: "SET_DIST_BY", by: null });
          dispatch({ type: "OPEN_TOOL", id: "dist" });
        },
        { tool: true },
      ),
      btn(
        "Distribution by…",
        () => {
          const names = columns.map((c) => c.name);
          const by =
            targetColumn &&
            targetColumn !== c1 &&
            names.includes(targetColumn)
              ? targetColumn
              : names.find((n) => n !== c1) ?? null;
          dispatch({ type: "SET_DIST_BY", by });
          dispatch({ type: "OPEN_TOOL", id: "dist" });
        },
        { tool: true },
      ),
      btn(
        "Chart…",
        () => openChart(dispatch, [{ name: c1, kind: k1 }]),
        { tool: true },
      ),
      btn(
        "Outliers",
        () => dispatch({ type: "OPEN_TOOL", id: "outliers" }),
        { tool: true },
      ),
      btn(
        "vs target",
        () => dispatch({ type: "OPEN_TOOL", id: "target" }),
        { tool: true },
      ),
      btn(
        "Train vs test",
        () => dispatch({ type: "OPEN_TOOL", id: "drift" }),
        { tool: true },
      ),
    ];
    if (k1 === "number") {
      analyse.push(
        btn("+ Variable", () =>
          dispatch({ type: "SET_LEFT_TAB", tab: "vars" }),
        ),
      );
    }

    const transform: ReactNode[] = [];
    if (isTextKind(k1) && pr?.looks_like_dates) {
      transform.push(
        btn("Parse dates…", () => openEd("parse_dates", { column: c1 })),
      );
    }
    if (isTextKind(k1) && pr?.currency_as_text) {
      const fmt = pr.currency_as_text;
      transform.push(
        btn("Parse as number…", () =>
          openEd("to_numeric", {
            column: c1,
            decimal: fmt.decimal,
            thousands: fmt.thousands,
            percent: fmt.percent,
          }),
        ),
      );
    } else if (isTextKind(k1) && pr?.numbers_as_text) {
      transform.push(
        btn("Cast to float…", () =>
          openEd("cast", { column: c1, dtype: "float" }),
        ),
      );
    }
    if (k1 === "number") {
      transform.push(
        btn("Replace sentinels…", () =>
          openEd("replace_sentinels", { column: c1, values: [-999] }),
        ),
        btn("Impute…", () => openEd("impute", { column: c1 })),
        btn("Clip…", () => openEd("clip", { column: c1 })),
        btn("log1p…", () => openEd("log1p", { column: c1 })),
        btn("Scale…", () => openEd("scale", { columns: [c1] })),
      );
    }
    if (isTextKind(k1) && !pr?.looks_like_dates) {
      transform.push(
        btn("Standardize text…", () =>
          openEd("standardize_text", { column: c1 }),
        ),
        btn("Map a value…", () => openEd("map_value", { column: c1 })),
        btn("Impute…", () =>
          openEd("impute", { column: c1, strategy: "most_frequent" }),
        ),
      );
      if (!isT1) {
        transform.push(
          btn("One-hot…", () => openEd("onehot", { column: c1 })),
          btn("Ordinal…", () => openEd("ordinal", { column: c1 })),
        );
      }
    }
    if ((k1 === "binary" || k1 === "bool") && pr?.missing) {
      transform.push(
        btn("Impute…", () =>
          openEd("impute", { column: c1, strategy: "most_frequent" }),
        ),
      );
    }
    if (k1 === "date") {
      transform.push(
        btn("Date parts…", () => openEd("datetime_parts", { column: c1 })),
      );
    }
    transform.push(
      btn("Formula…", () => openEd("formula", { expr: c1 })),
      btn("Rename…", () => openEd("rename", { column: c1 }, "both")),
      btn("Cast…", () => openEd("cast", { column: c1 })),
    );
    if (!isT1) {
      transform.push(
        btn("Drop…", () => openEd("drop_columns", { columns: [c1] })),
      );
    }

    const groups =
      isTextKind(k1) && pr?.variants
        ? buildValueGroups({
            topValues: pr.top_values,
            distinct: pr.distinct,
            rows,
            column: c1,
          })
        : [];

    return (
      <aside
        className="inspector"
        aria-label="Inspector"
        data-owner="W2"
        {...identityAttrs}
      >
        <div className="insp-scroll">
          <div className="insp-kicker">Column</div>
          <div className="insp-title">{c1}</div>
          <div className="insp-chips">
            <span className="insp-chip">{KIND_LABEL[k1]}</span>
            {isT1 ? <span className="insp-chip target">target</span> : null}
            {alerts.map((a) => (
              <span key={a.text} className={`insp-chip alert-${a.tone}`}>
                {a.text}
              </span>
            ))}
          </div>
          <div className="insp-stats">
            {stats.map(([k, v]) => (
              <div key={k} className="insp-stat">
                <span>{k}</span>
                <span
                  className={
                    (k === "missing" || k === "-999") && v !== "0"
                      ? "bad-val"
                      : "mono"
                  }
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          {bars.length ? (
            <>
              <div className="insp-bars">
                {bars.map((b, i) => (
                  <span
                    key={i}
                    title={b.tip}
                    style={{
                      flex: "1 1 0",
                      minWidth: 6,
                      height: b.heightPx,
                      background: k1 === "number" ? "#1d5b86" : "#a8844a",
                      borderRadius: "1px 1px 0 0",
                    }}
                  />
                ))}
              </div>
              <div className="insp-bar-ends">
                <span>
                  {k1 === "number"
                    ? fmt(pr?.histogram?.edges[0] as never)
                    : bars[0]?.label}
                </span>
                <span>
                  {k1 === "number"
                    ? fmt(
                        pr?.histogram?.edges[
                          (pr.histogram?.edges.length ?? 1) - 1
                        ] as never,
                      )
                    : bars[bars.length - 1]?.label}
                </span>
              </div>
            </>
          ) : null}
          {groups.length ? (
            <div className="insp-groups">
              <div className="ed-label">
                Value groups{" "}
                <span className="muted">
                  · identical once stripped + lowercased
                </span>
              </div>
              {groups.map((g) => (
                <div key={g.to} className="insp-group-row">
                  <span className="mono">{g.to}</span>
                  <span className="muted">← {g.from}</span>
                </div>
              ))}
            </div>
          ) : null}
          {!isLatest ? <OldBanner /> : null}
          <Group label="Analyse">{analyse}</Group>
          <Group label="Transform">{transform}</Group>
        </div>
      </aside>
    );
  }

  return <EmptyInspector />;
}

/** Long cell text: truncate by default; expand into a capped scroll box. */
function TruncatedText({
  value,
  quoted = false,
}: {
  value: string;
  quoted?: boolean;
}) {
  const [showFull, setShowFull] = useState(false);
  const { text, truncated } = truncateText(value, TEXT_PREVIEW_CHARS);
  const display = showFull ? value : truncated ? `${text}…` : text;
  const wrapped = quoted ? `“${display}”` : display;
  return (
    <div className="insp-cell-text">
      <div
        className={
          showFull && truncated
            ? "insp-cell-value insp-cell-value-full"
            : "insp-cell-value"
        }
        data-truncated={truncated && !showFull ? "1" : "0"}
        data-full-len={value.length}
      >
        {wrapped}
      </div>
      {truncated ? (
        <button
          type="button"
          className="insp-show-full"
          aria-expanded={showFull}
          onClick={() => setShowFull((v) => !v)}
        >
          {showFull ? "Show less" : "Show full text"}
        </button>
      ) : null}
    </div>
  );
}

function EmptyInspector() {
  return (
    <aside className="inspector" aria-label="Inspector" data-owner="W2">
      <div className="insp-scroll">
        <div className="ed-serif" style={{ fontSize: 22, marginBottom: 8 }}>
          Inspector
        </div>
        <div className="ed-help" style={{ lineHeight: 1.6 }}>
          Click a <strong>column header</strong> (right-click for its menu), a{" "}
          <strong>row number</strong> or a <strong>cell</strong>. Or start a
          step from <strong>+ Step</strong> in the pipeline.
        </div>
      </div>
    </aside>
  );
}

function OldBanner() {
  return (
    <div className="insp-old">
      You are viewing an older version. Go back to the latest one to add a
      step.
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="insp-group">
      <div className="ed-label-caps">{label}</div>
      <div className="insp-actions">{children}</div>
    </div>
  );
}

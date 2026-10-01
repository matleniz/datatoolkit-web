import { useState, type ReactNode } from "react";

import type { ColumnKind, ColumnProfile, JsonValue } from "../../api/types";
import { useAppDispatch, useAppState } from "../../state/AppStore";
import type { ToolId } from "../../state/reducer";
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

type Dispatch = ReturnType<typeof useAppDispatch>;
type Params = Record<string, unknown>;
/** One action button: shown when `show`, opens the `op` editor. */
type OpButton = [show: unknown, title: string, op: string, params: Params];

function openChart(
  dispatch: Dispatch,
  cols: { name: string; kind: ColumnKind | string }[],
) {
  dispatch({
    type: "SET_CHART_DRAFT",
    draft: chartPrefillFromSelection(cols),
  });
  dispatch({ type: "OPEN_TOOL", id: "chart" });
}

/** Editor / button helpers shared by every selection kind. */
function useActions() {
  const dispatch = useAppDispatch();
  const { isLatest } = useWorkbenchData();
  const openEd = (
    op: string,
    params: Params = {},
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
  const btn = (title: string, onClick: () => void, opts?: { tool: boolean }) => (
    <button
      key={title}
      type="button"
      className={opts?.tool ? "insp-btn tool" : "insp-btn"}
      disabled={!opts?.tool && !isLatest}
      onClick={onClick}
    >
      {title}
    </button>
  );
  const opBtns = (list: OpButton[]) =>
    list
      .filter(([show]) => show)
      .map(([, title, op, params]) => btn(title, () => openEd(op, params)));
  const toolBtn = (title: string, id: ToolId, by?: string | null) =>
    btn(
      title,
      () => {
        if (by !== undefined) dispatch({ type: "SET_DIST_BY", by });
        dispatch({ type: "OPEN_TOOL", id });
      },
      { tool: true },
    );
  return { dispatch, openEd, btn, opBtns, toolBtn };
}

/** W2 — column / row / cell inspector (318px). */
export function Inspector() {
  const { selection } = useAppState();
  const { columns, display } = useWorkbenchData();
  const selCols = selection.columns.filter(
    (c) =>
      columns.some((x) => x.name === c) ||
      display.cols.some((x) => x.name === c),
  );
  if (selection.cell) return <CellInspector {...selection.cell} />;
  if (selection.row !== null) return <RowInspector rid={selection.row} />;
  if (selCols.length > 1) return <MultiInspector cols={selCols} />;
  if (selCols.length === 1) return <ColumnInspector col={selCols[0]!} />;
  return <EmptyInspector />;
}

/** Common aside + scroll area; identity attrs say which frame stats come from. */
function Shell({
  children,
  identified = true,
}: {
  children: ReactNode;
  identified?: boolean;
}) {
  const { identity, profilesIdentity } = useWorkbenchData();
  // MAT-175: which frame the stats come from (profiles lag rows briefly).
  const identityAttrs = identified
    ? {
        "data-identity": profilesIdentity ?? "",
        "data-identity-current": identity.key,
      }
    : {};
  return (
    <aside
      className="inspector"
      aria-label="Inspector"
      data-owner="W2"
      {...identityAttrs}
    >
      <div className="insp-scroll">{children}</div>
    </aside>
  );
}

function Head({
  kicker,
  title,
  chips,
}: {
  kicker: ReactNode;
  title: ReactNode;
  chips: ReactNode;
}) {
  return (
    <>
      <div className="insp-kicker">{kicker}</div>
      <div className="insp-title">{title}</div>
      <div className="insp-chips">{chips}</div>
    </>
  );
}

function CellInspector({ rid, col }: { rid: number; col: string }) {
  const { rows, columns } = useWorkbenchData();
  const { openEd, btn } = useActions();
  const kind = columns.find((c) => c.name === col)?.kind ?? "text";
  const cv = rows.find((r) => r._rid === rid)?.[col];
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
    <Shell>
      <Head
        kicker={`Cell · row ${rid + 1}`}
        title={col}
        chips={<span className="insp-chip">{KIND_LABEL[kind]}</span>}
      />
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
          An edit is saved as a rule over every matching cell, not as a patch:
          it replays on test and on any new file.
        </div>
      </div>
      <OldBanner />
      <Group label="Turn into a rule">{actions}</Group>
    </Shell>
  );
}

function RowInspector({ rid }: { rid: number }) {
  const { rows, columns } = useWorkbenchData();
  const { openEd, btn } = useActions();
  const row = rows.find((r) => r._rid === rid);
  if (!row) return <EmptyInspector />;
  const fields = columns.map((c) => {
    const v = row[c.name];
    const missing = isNull(v);
    const bad = missing || (v === -999 && c.kind === "number");
    const text =
      typeof v === "string"
        ? v !== v.trim()
          ? `“${fmtPreview(v)}”`
          : fmtPreview(v)
        : fmt(v as JsonValue);
    return {
      k: c.name,
      v: text,
      bad,
      issue: bad ? `${c.name}${missing ? " missing" : " = -999"}` : null,
    };
  });
  const issues = fields.flatMap((f) => (f.issue ? [f.issue] : []));
  return (
    <Shell>
      <Head
        kicker="Row"
        title={
          <>
            #{rid + 1}
            {row.customer_id ? ` · ${String(row.customer_id)}` : ""}
          </>
        }
        chips={
          issues.length ? (
            issues.map((i) => (
              <span key={i} className="insp-chip warn">
                {i}
              </span>
            ))
          ) : (
            <span className="insp-chip ok">nothing unusual</span>
          )
        }
      />
      <div className="insp-fields">
        {fields.map((f) => (
          <div key={f.k} className="insp-field-row">
            <span>{f.k}</span>
            <span className={f.bad ? "bad-val" : "mono"}>{f.v}</span>
          </div>
        ))}
      </div>
      <OldBanner />
      <Group label="Actions">
        {btn("Drop duplicates…", () =>
          openEd("drop_duplicates", { keep: "none", sort_by: null }, "train"),
        )}
      </Group>
    </Shell>
  );
}

function MultiInspector({ cols }: { cols: string[] }) {
  const { columns } = useWorkbenchData();
  const { targetColumn } = useAppState();
  const { dispatch, btn, opBtns, toolBtn } = useActions();
  const kindOf = (name: string) => columns.find((x) => x.name === name)?.kind;
  const num = cols.filter((c) => isNumericKind(kindOf(c)));
  return (
    <Shell>
      <Head
        kicker={`${cols.length} columns`}
        title={cols.join(", ")}
        chips={<span className="insp-chip">{num.length} numeric</span>}
      />
      <OldBanner />
      <Group label="Analyse">
        {toolBtn("Compare", "compare")}
        {toolBtn("Correlation", "corr")}
        {btn(
          "Chart…",
          () =>
            openChart(
              dispatch,
              cols.map((name) => ({ name, kind: kindOf(name) ?? "text" })),
            ),
          { tool: true },
        )}
      </Group>
      <Group label="Transform">
        {opBtns([
          [
            num.length === 2,
            `Derive ${num[0]} ÷ ${num[1]}…`,
            "derive",
            { a: num[0], b: num[1], op: "ratio" },
          ],
          [true, "New feature…", "formula", { expr: "", name: "" }],
          [
            num.length,
            "Polynomial features…",
            "polynomial",
            { columns: num, degree: 2 },
          ],
          [num.length, "Power transform…", "power_transform", { columns: num }],
          [
            num.length,
            "Quantile transform…",
            "quantile_transform",
            { columns: num },
          ],
          [
            num.length,
            `Scale ${num.length}…`,
            "scale",
            { columns: num.filter((c) => kindOf(c) === "number") },
          ],
          [
            true,
            `Drop ${cols.length}…`,
            "drop_columns",
            { columns: cols.filter((c) => c !== targetColumn) },
          ],
        ])}
      </Group>
    </Shell>
  );
}

/** Stat rows for the column header; numbers show sentinels / outliers. */
function columnStats(pr: ColumnProfile | undefined, kind: ColumnKind) {
  if (!pr) return [];
  const stats: [string, string][] = [
    ["non-null", String(pr.count - pr.missing)],
    ["missing", String(pr.missing)],
    ["distinct", String(pr.distinct)],
  ];
  const top = pr.top_values?.[0];
  if (kind === "number" && pr.histogram) {
    /* mean etc. not in profile — show outliers / sentinels */
    const sent = pr.sentinel_candidates[0];
    if (sent) stats.push([String(sent.value), String(sent.count)]);
    if (pr.outliers) stats.push(["outliers", String(pr.outliers)]);
  } else if (top) {
    stats.push(["top", `${String(top.value)} (${top.count})`]);
  }
  return stats;
}

function ProfileBars({
  pr,
  kind,
}: {
  pr: ColumnProfile | undefined;
  kind: ColumnKind;
}) {
  const bars = pr ? profileBars(pr, 64, 6) : [];
  if (!pr || !bars.length) return null;
  const edges = pr.histogram?.edges ?? [];
  const num = kind === "number";
  return (
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
              background: num ? "#1d5b86" : "#a8844a",
              borderRadius: "1px 1px 0 0",
            }}
          />
        ))}
      </div>
      <div className="insp-bar-ends">
        <span>{num ? fmt(edges[0] as never) : bars[0]?.label}</span>
        <span>
          {num
            ? fmt(edges[Math.max(edges.length, 1) - 1] as never)
            : bars[bars.length - 1]?.label}
        </span>
      </div>
    </>
  );
}

/** Per-kind transform buttons for one column. */
function columnTransforms(
  col: string,
  kind: ColumnKind,
  pr: ColumnProfile | undefined,
  isTarget: boolean,
): OpButton[] {
  const text = isTextKind(kind);
  const plainText = text && !pr?.looks_like_dates;
  const cur = pr?.currency_as_text;
  const mostFrequent = { column: col, strategy: "most_frequent" };
  return [
    [text && pr?.looks_like_dates, "Parse dates…", "parse_dates", { column: col }],
    [
      text && cur,
      "Parse as number…",
      "to_numeric",
      {
        column: col,
        decimal: cur?.decimal,
        thousands: cur?.thousands,
        percent: cur?.percent,
      },
    ],
    [
      text && !cur && pr?.numbers_as_text,
      "Cast to float…",
      "cast",
      { column: col, dtype: "float" },
    ],
    [
      kind === "number",
      "Replace sentinels…",
      "replace_sentinels",
      { column: col, values: [-999] },
    ],
    [kind === "number", "Impute…", "impute", { column: col }],
    [kind === "number", "Clip…", "clip", { column: col }],
    [kind === "number", "log1p…", "log1p", { column: col }],
    [kind === "number", "Scale…", "scale", { columns: [col] }],
    [plainText, "Standardize text…", "standardize_text", { column: col }],
    [plainText, "Map a value…", "map_value", { column: col }],
    [plainText, "Impute…", "impute", mostFrequent],
    [plainText && !isTarget, "One-hot…", "onehot", { column: col }],
    [plainText && !isTarget, "Ordinal…", "ordinal", { column: col }],
    [
      (kind === "binary" || kind === "bool") && pr?.missing,
      "Impute…",
      "impute",
      mostFrequent,
    ],
    [kind === "date", "Date parts…", "datetime_parts", { column: col }],
    [true, "Formula…", "formula", { expr: col }],
    [true, "Rename…", "rename", { column: col }],
    [true, "Cast…", "cast", { column: col }],
    [!isTarget, "Drop…", "drop_columns", { columns: [col] }],
  ];
}

function ColumnInspector({ col }: { col: string }) {
  const { columns, rows, profiles } = useWorkbenchData();
  const { targetColumn } = useAppState();
  const { dispatch, btn, opBtns, toolBtn } = useActions();
  const kind = (columns.find((c) => c.name === col)?.kind ?? "text") as ColumnKind;
  const pr = profiles.get(col);
  const isTarget = col === targetColumn;
  const groups =
    isTextKind(kind) && pr?.variants
      ? buildValueGroups({
          topValues: pr.top_values,
          distinct: pr.distinct,
          rows,
          column: col,
        })
      : [];
  const names = columns.map((c) => c.name);
  const distBy =
    targetColumn && targetColumn !== col && names.includes(targetColumn)
      ? targetColumn
      : names.find((n) => n !== col) ?? null;
  return (
    <Shell>
      <Head
        kicker="Column"
        title={col}
        chips={
          <>
            <span className="insp-chip">{KIND_LABEL[kind]}</span>
            {isTarget ? <span className="insp-chip target">target</span> : null}
            {colAlerts(pr).map((a) => (
              <span key={a.text} className={`insp-chip alert-${a.tone}`}>
                {a.text}
              </span>
            ))}
          </>
        }
      />
      <div className="insp-stats">
        {columnStats(pr, kind).map(([k, v]) => (
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
      <ProfileBars pr={pr} kind={kind} />
      {groups.length ? (
        <div className="insp-groups">
          <div className="ed-label">
            Value groups{" "}
            <span className="muted">· identical once stripped + lowercased</span>
          </div>
          {groups.map((g) => (
            <div key={g.to} className="insp-group-row">
              <span className="mono">{g.to}</span>
              <span className="muted">← {g.from}</span>
            </div>
          ))}
        </div>
      ) : null}
      <OldBanner />
      <Group label="Analyse">
        {toolBtn("Distribution", "dist", null)}
        {toolBtn("Distribution by…", "dist", distBy)}
        {btn("Chart…", () => openChart(dispatch, [{ name: col, kind }]), {
          tool: true,
        })}
        {toolBtn("Outliers", "outliers")}
        {toolBtn("vs target", "target")}
        {toolBtn("Train vs test", "drift")}
      </Group>
      <Group label="Transform">
        {opBtns(columnTransforms(col, kind, pr, isTarget))}
      </Group>
    </Shell>
  );
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
    <Shell identified={false}>
      <div className="ed-serif" style={{ fontSize: 22, marginBottom: 8 }}>
        Inspector
      </div>
      <div className="ed-help" style={{ lineHeight: 1.6 }}>
        Click a <strong>column header</strong> (right-click for its menu), a{" "}
        <strong>row number</strong> or a <strong>cell</strong>. Or start a
        step from <strong>+ Step</strong> in the pipeline.
      </div>
    </Shell>
  );
}

function OldBanner() {
  const { isLatest } = useWorkbenchData();
  if (isLatest) return null;
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

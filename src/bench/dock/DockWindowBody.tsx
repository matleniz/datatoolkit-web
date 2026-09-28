import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import type { ColumnProfile, Result, WorkspaceRow } from "../../api/types";
import { EngineError } from "../../api/types";
import { useAppState } from "../../state/AppStore";
import type { ToolId } from "../../state/reducer";
import { datasetSource, targetColumnOf } from "../left/datasetSource";
import { keyParamsFromSchema } from "../left/keyParams";
import { computeStat, fmtStat } from "../left/stats";
import { toolDef } from "../toolrail/tools";
import { effectiveVersion } from "../version";
import { useWorkbenchData } from "../WorkbenchData";
import {
  SCOPEABLE_TOOLS,
  engineColumnsParam,
  isNumericKind,
  listOutlierRows,
  maxAbs,
  outliersBoundLabel,
  schemaHasColumns,
  selectedNumericColumns,
} from "./columnScope";
import { ResultView } from "./ResultView";

function pearson(
  rows: WorkspaceRow[],
  a: string,
  b: string,
): number | null {
  const pairs: [number, number][] = [];
  for (const r of rows) {
    const x = r[a];
    const y = r[b];
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      x !== -999 &&
      y !== -999
    ) {
      pairs.push([x, y]);
    }
  }
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) * (x - mx);
    dy += (y - my) * (y - my);
  }
  if (!dx || !dy) return null;
  return num / Math.sqrt(dx * dy);
}

function histBars(
  profile: ColumnProfile | undefined,
  maxH: number,
): { height: number; tip: string }[] {
  if (!profile?.histogram) return [];
  const counts = profile.histogram.counts;
  const mx = Math.max(...counts, 1);
  return counts.map((n, i) => {
    const lo = profile.histogram!.edges[i];
    const hi = profile.histogram!.edges[i + 1];
    return {
      height: Math.max(n ? 2 : 0, Math.round((n / mx) * maxH)),
      tip: `${lo} – ${hi}: ${n}`,
    };
  });
}

function topBars(
  profile: ColumnProfile | undefined,
  maxH: number,
): { height: number; tip: string }[] {
  const tops = profile?.top_values ?? [];
  const mx = Math.max(...tops.map((t) => t.count), 1);
  return tops.slice(0, 8).map((t) => ({
    height: Math.max(t.count ? 2 : 0, Math.round((t.count / mx) * maxH)),
    tip: `"${String(t.value)}": ${t.count}`,
  }));
}

/** Engine keys that declare a `columns` param (or always run unscoped). */
const ENGINE_TOOLS = new Set<ToolId>(["outliers", "target", "drift"]);
const COMPARE_STATS = ["mean", "median", "std", "min", "max"] as const;

function ScopeToggle({
  scopeAll,
  onChange,
}: {
  scopeAll: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={scopeAll ? "chip on" : "chip"}
      aria-pressed={scopeAll}
      aria-label="Widen analysis to all columns"
      data-scope-all={scopeAll ? "1" : "0"}
      onClick={() => onChange(!scopeAll)}
    >
      {scopeAll ? "All columns" : "Selection only"}
    </button>
  );
}

export function DockWindowBody({ id }: { id: ToolId }) {
  const { workspace, selection, role, viewVersion } = useAppState();
  const bench = useWorkbenchData();
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bound, setBound] = useState("");
  const [ready, setReady] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [hasColumnsParam, setHasColumnsParam] = useState(false);

  const selCols = selection.columns;
  const focus = selCols[0] ?? selection.cell?.col ?? null;
  const target = workspace ? targetColumnOf(workspace) : null;
  const def = toolDef(id);
  const selKey = selCols.join(",");
  const version = workspace
    ? effectiveVersion(workspace, viewVersion)
    : 0;
  const showScopeToggle = SCOPEABLE_TOOLS.has(id);

  useEffect(() => {
    if (!workspace?.datasets.train.x.path) {
      setMsg("Load a workspace with a train source to run this tool.");
      setProfiles([]);
      setRows([]);
      setResult(null);
      setReady(true);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setReady(false);
      setError(null);
      setMsg(null);
      setResult(null);
      try {
        if (window.__DTK_WORKSPACE_SAVED__) {
          await window.__DTK_WORKSPACE_SAVED__;
        }
        let profColumns: ColumnProfile[];
        let pageRows: WorkspaceRow[];
        const canReuse =
          !bench.loading &&
          bench.profiles.size > 0 &&
          bench.version === version;
        if (canReuse) {
          profColumns = [...bench.profiles.values()];
          pageRows = bench.rows;
        } else {
          const prof = await apiClient.columnProfiles(
            workspace,
            role,
            version,
          );
          const wr = await apiClient.workspaceRows(
            workspace,
            role,
            version,
            0,
            500,
          );
          profColumns = prof.columns;
          pageRows = wr.rows;
        }
        if (cancelled) return;
        setProfiles(profColumns);
        setRows(pageRows);

        if (id === "compare") {
          const cs = selCols.filter((c) =>
            profColumns.some((p) => p.name === c),
          );
          if (cs.length < 2) {
            setMsg(
              "Select two or more columns (shift-click headers, or right-click → Add to selection).",
            );
          } else {
            setBound(`${cs.length} columns · ${role}`);
          }
          return;
        }

        if (id === "corr") {
          const nums = profColumns
            .filter((p) => isNumericKind(p.kind))
            .map((p) => p.name);
          const selNum = selCols.filter((c) =>
            profColumns.some((p) => p.name === c && isNumericKind(p.kind)),
          );
          const useSelection = !scopeAll && selNum.length >= 2;
          const use = (useSelection ? selNum : nums).slice(0, 7);
          if (use.length < 2) {
            setMsg("Need at least two numeric columns.");
          } else {
            setBound(
              useSelection
                ? `bound to selection · ${selNum.length} columns`
                : "all numeric columns · select 2+ to narrow",
            );
          }
          return;
        }

        if (id === "dist") {
          if (!focus || !profColumns.some((p) => p.name === focus)) {
            setMsg("Select a column to see its distribution.");
          } else {
            setBound(`bound to ${focus}`);
          }
          return;
        }

        if (id === "missing") {
          const useSelection = !scopeAll && selCols.length > 0;
          setBound(
            useSelection
              ? selCols.length === 1
                ? `bound to ${selCols[0]}`
                : `bound to selection · ${selCols.length} columns`
              : `${role} · all columns`,
          );
          return;
        }

        if (id === "outliers") {
          const selNum = selectedNumericColumns(selCols, profColumns);
          if (!scopeAll) {
            if (selNum.length === 0) {
              setMsg(
                "Select a numeric column. Fences: Q1 − 1.5·IQR and Q3 + 1.5·IQR, sentinels excluded.",
              );
              return;
            }
            if (selNum.length === 1) {
              const oc = selNum[0]!;
              const p = profColumns.find((c) => c.name === oc);
              setBound(outliersBoundLabel(oc, p));
              if (!p?.outliers) {
                setMsg(`No IQR outlier in ${oc}.`);
              }
              // Native list rendered below — do not call the engine (no columns param).
              return;
            }
            setBound(`bound to selection · ${selNum.length} columns`);
            return;
          }
          setBound("all numeric columns");
          // Fall through to engine run (full Result — no front filtering).
        }

        if (id === "target") {
          if (!target) {
            setMsg(
              "No target yet: set it on the Sources screen, or right-click a column → Set as target.",
            );
            return;
          }
          if (role === "test") {
            setMsg("The test set has no label. Switch to Train.");
            return;
          }
        }

        const runEngine =
          (id === "outliers" && scopeAll) ||
          id === "target" ||
          id === "drift";
        if (runEngine && ENGINE_TOOLS.has(id)) {
          const source = datasetSource(workspace, role, role === "train");
          const available: Record<string, unknown> = { source };
          if (target) available.target = target;
          if (workspace.datasets.test) {
            available.test = datasetSource(workspace, "test", false);
          }
          const schema = await apiClient.keySchema(def.key);
          if (cancelled) return;
          const hasCols = schemaHasColumns(schema);
          setHasColumnsParam(hasCols);
          if (hasCols) {
            const cols = engineColumnsParam(selCols, scopeAll);
            if (cols) available.columns = cols;
          }
          const params = keyParamsFromSchema(schema, available);
          const r = await apiClient.runKey(def.key, params);
          if (cancelled) return;
          setResult(r);
          if (id === "outliers") {
            setBound("all numeric columns · key outliers");
          } else if (id === "target" && hasCols) {
            const cols = engineColumnsParam(selCols, scopeAll);
            setBound(
              cols
                ? cols.length === 1
                  ? `bound to ${cols[0]} · key ${def.key}`
                  : `bound to selection · ${cols.length} columns · key ${def.key}`
                : `all features · key ${def.key}`,
            );
          } else {
            setBound(`key ${def.key}`);
          }
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof EngineError ? e.message : String(e));
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    workspace,
    selCols,
    selKey,
    focus,
    role,
    version,
    id,
    target,
    def.key,
    scopeAll,
    bench.loading,
    bench.profiles,
    bench.rows,
    bench.version,
  ]);

  const profileByName = useMemo(() => {
    const m = new Map<string, ColumnProfile>();
    for (const p of profiles) m.set(p.name, p);
    return m;
  }, [profiles]);

  const scopeBar =
    showScopeToggle ? (
      <div className="dock-scope-bar">
        <ScopeToggle scopeAll={scopeAll} onChange={setScopeAll} />
      </div>
    ) : null;

  if (error) {
    return (
      <div>
        {scopeBar}
        <div className="engine-error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div>
        {scopeBar}
        <div className="dock-msg muted">Loading…</div>
      </div>
    );
  }
  if (msg) {
    const selNum =
      id === "outliers" && !scopeAll
        ? selectedNumericColumns(selCols, profiles)
        : [];
    const outliersCol = selNum.length === 1 ? selNum[0] : undefined;
    return (
      <div
        data-scope-mode={scopeAll ? "all" : "selection"}
        {...(outliersCol
          ? {
              "data-outliers-col": outliersCol,
              "data-outliers-cols": outliersCol,
            }
          : {})}
      >
        {scopeBar}
        {bound ? <div className="dock-bound muted">{bound}</div> : null}
        <div className="dock-msg">{msg}</div>
      </div>
    );
  }

  if (id === "compare") {
    const cs = selCols.filter((c) => profileByName.has(c)).slice(0, 6);
    if (cs.length < 2) {
      return (
        <div className="dock-msg">
          Select two or more columns (shift-click headers, or right-click → Add
          to selection).
        </div>
      );
    }
    return (
      <CompareNative
        cols={cs}
        profiles={profileByName}
        rows={rows}
        target={target}
        bound={bound}
      />
    );
  }

  if (id === "corr") {
    const nums = profiles
      .filter((p) => isNumericKind(p.kind))
      .map((p) => p.name);
    const selNum = selCols.filter((c) => {
      const k = profileByName.get(c)?.kind;
      return k && isNumericKind(k);
    });
    const useSelection = !scopeAll && selNum.length >= 2;
    const use = (useSelection ? selNum : nums).slice(0, 7);
    if (use.length < 2) {
      return (
        <div>
          {scopeBar}
          <div className="dock-msg">Need at least two numeric columns.</div>
        </div>
      );
    }
    return (
      <div data-scope-mode={scopeAll || !useSelection ? "all" : "selection"}>
        {scopeBar}
        <CorrNative cols={use} rows={rows} bound={bound} />
      </div>
    );
  }

  if (id === "dist" && focus && profileByName.has(focus)) {
    const p = profileByName.get(focus)!;
    const bars =
      p.kind === "number" ? histBars(p, 106) : topBars(p, 106);
    const stats =
      p.kind === "number"
        ? `n ${p.count} · missing ${p.missing} · distinct ${p.distinct}`
        : `${p.distinct} categories · ${p.missing} missing`;
    return (
      <div data-scope-mode="selection" data-dist-col={focus}>
        {scopeBar}
        <div className="dock-bound muted">{bound || `bound to ${focus}`}</div>
        <div className="muted" style={{ marginBottom: 6 }}>
          {stats}
        </div>
        <div className="hist-bars tall">
          {bars.map((b, i) => (
            <span
              key={i}
              title={b.tip}
              style={{
                flex: "1 1 0",
                minWidth: 4,
                height: b.height,
                background: p.kind === "number" ? "#1d5b86" : "#a8844a",
                borderRadius: "1px 1px 0 0",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (id === "missing") {
    const useSelection = !scopeAll && selCols.length > 0;
    const shown = useSelection
      ? profiles.filter((c) => selCols.includes(c.name))
      : profiles;
    return (
      <div
        data-scope-mode={useSelection ? "selection" : "all"}
        data-missing-cols={shown.map((c) => c.name).join(",")}
      >
        {scopeBar}
        <div className="dock-bound muted">{bound}</div>
        <div className="list-rows">
          {shown.map((c) => {
            const total = c.count + c.missing || 1;
            const p = c.missing / total;
            return (
              <div key={c.name} className="list-row" data-col={c.name}>
                <span className="list-name">{c.name}</span>
                <span className="list-bar">
                  <span
                    style={{
                      display: "block",
                      height: 8,
                      width: `${Math.round(p * 100)}%`,
                      background: "#c2410c",
                    }}
                  />
                </span>
                <span className="list-val mono">
                  {c.missing
                    ? `${c.missing} · ${Math.round(p * 100)}%`
                    : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (id === "outliers" && !scopeAll) {
    const selNum = selectedNumericColumns(selCols, profiles);
    if (selNum.length === 1) {
      const oc = selNum[0]!;
      const p = profileByName.get(oc);
      const fl = listOutlierRows(rows, oc, p);
      const mxv = maxAbs(fl.map((x) => x.value));
      return (
        <div
          data-scope-mode="selection"
          data-outliers-col={oc}
          data-outliers-cols={oc}
        >
          {scopeBar}
          <div className="dock-bound muted">{bound}</div>
          <div className="list-rows">
            {fl.map((x) => (
              <div
                key={x.rid}
                className="list-row"
                data-col={oc}
                data-outlier-row={x.rid}
              >
                <span className="list-name">row #{x.rid + 1}</span>
                <span className="list-bar">
                  <span
                    style={{
                      display: "block",
                      height: 8,
                      width: `${Math.round((Math.abs(x.value) / mxv) * 100)}%`,
                      background: "#6b52b0",
                    }}
                  />
                </span>
                <span className="list-val mono">{fmtStat(x.value)}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (selNum.length > 1) {
      return (
        <div
          data-scope-mode="selection"
          data-outliers-cols={selNum.join(",")}
        >
          {scopeBar}
          <div className="dock-bound muted">{bound}</div>
          <div className="list-rows">
            {selNum.map((name) => {
              const p = profileByName.get(name);
              const n = p?.outliers ?? 0;
              const total = (p?.count ?? 0) + (p?.missing ?? 0) || 1;
              const pct = n / total;
              return (
                <div key={name} className="list-row" data-col={name}>
                  <span className="list-name">{name}</span>
                  <span className="list-bar">
                    <span
                      style={{
                        display: "block",
                        height: 8,
                        width: `${Math.round(pct * 100)}%`,
                        background: "#6b52b0",
                      }}
                    />
                  </span>
                  <span className="list-val mono">
                    {n ? `${n} · ${Math.round(pct * 100)}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }

  if (result) {
    return (
      <div
        data-scope-mode={scopeAll ? "all" : "selection"}
        data-engine-key={def.key}
        data-has-columns-param={hasColumnsParam ? "1" : "0"}
      >
        {scopeBar}
        {bound ? <div className="dock-bound muted">{bound}</div> : null}
        <ResultView result={result} />
      </div>
    );
  }
  return (
    <div>
      {scopeBar}
      <div className="dock-msg muted">Loading…</div>
    </div>
  );
}

function CompareNative({
  cols,
  profiles,
  rows,
  target,
  bound,
}: {
  cols: string[];
  profiles: Map<string, ColumnProfile>;
  rows: WorkspaceRow[];
  target: string | null;
  bound: string;
}) {
  const rowsDef: { name: string; fn: (c: string) => string }[] = [
    { name: "type", fn: (c) => profiles.get(c)?.kind ?? "—" },
    { name: "missing", fn: (c) => String(profiles.get(c)?.missing ?? 0) },
    { name: "distinct", fn: (c) => String(profiles.get(c)?.distinct ?? 0) },
  ];
  for (const stat of COMPARE_STATS) {
    rowsDef.push({
      name: stat,
      fn: (c) => {
        const kind = profiles.get(c)?.kind;
        if (!kind || !isNumericKind(kind)) return "–";
        return fmtStat(computeStat(rows, stat, c));
      },
    });
  }
  if (target && profiles.has(target)) {
    rowsDef.push({
      name: `r with ${target}`,
      fn: (c) => {
        const r = c === target ? 1 : pearson(rows, c, target);
        return r === null ? "–" : r.toFixed(2);
      },
    });
  }

  return (
    <div data-compare-cols={cols.join(",")} data-scope-mode="selection">
      <div className="dock-bound muted">{bound}</div>
      <div className="matrix">
        <div className="matrix-head">
          <span className="matrix-corner" />
          {cols.map((n) => (
            <span key={n} className="matrix-h" title={n}>
              {n.length > 9 ? `${n.slice(0, 8)}…` : n}
            </span>
          ))}
        </div>
        {rowsDef.map((d) => (
          <div key={d.name} className="matrix-row" data-stat={d.name}>
            <span className="matrix-label" title={d.name}>
              {d.name}
            </span>
            {cols.map((c) => (
              <span
                key={c}
                className="matrix-cell"
                data-col={c}
                data-stat={d.name}
                title={`${c} · ${d.name}`}
              >
                {d.fn(c)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="multiples">
        {cols.map((c) => {
          const p = profiles.get(c);
          const bars =
            p?.kind === "number" ? histBars(p, 40) : topBars(p, 40);
          return (
            <div key={c} className="multiple">
              <div className="mono multiple-name">{c}</div>
              <div className="hist-bars short">
                {bars.map((b, i) => (
                  <span
                    key={i}
                    title={b.tip}
                    style={{
                      flex: "1 1 0",
                      minWidth: 2,
                      height: b.height,
                      background:
                        p?.kind === "number" ? "#1d5b86" : "#a8844a",
                      borderRadius: "1px 1px 0 0",
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CorrNative({
  cols,
  rows,
  bound,
}: {
  cols: string[];
  rows: WorkspaceRow[];
  bound: string;
}) {
  return (
    <div data-corr-size={cols.length}>
      <div className="dock-bound muted">{bound}</div>
      <div className="matrix" data-corr-matrix="1">
        <div className="matrix-head">
          <span className="matrix-corner" />
          {cols.map((n) => (
            <span key={n} className="matrix-h" title={n}>
              {n.length > 7 ? `${n.slice(0, 6)}…` : n}
            </span>
          ))}
        </div>
        {cols.map((a) => (
          <div key={a} className="matrix-row" data-corr-row={a}>
            <span className="matrix-label" title={a}>
              {a}
            </span>
            {cols.map((b) => {
              const r = a === b ? 1 : pearson(rows, a, b);
              const t = r === null ? "–" : r.toFixed(2);
              const m = r === null ? 0 : Math.abs(r);
              const bg =
                r === null
                  ? "#f0efea"
                  : r >= 0
                    ? `rgba(29, 91, 134, ${(0.08 + 0.85 * m).toFixed(2)})`
                    : `rgba(180, 70, 15, ${(0.08 + 0.85 * m).toFixed(2)})`;
              const fg = m > 0.55 ? "#ffffff" : "#1c1b18";
              return (
                <span
                  key={b}
                  className="matrix-cell"
                  data-corr-cell={`${a}×${b}`}
                  title={`${a} × ${b} : r = ${t}`}
                  style={{ background: bg, color: fg }}
                >
                  {t}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

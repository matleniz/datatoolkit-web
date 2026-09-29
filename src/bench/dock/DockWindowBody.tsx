import { useEffect, useMemo, useState, type ReactNode } from "react";

import { apiClient } from "../../api/client";
import type { ColumnProfile, Result, WorkspaceRow } from "../../api/types";
import { EngineError } from "../../api/types";
import {
  ensureWorkspaceSaved,
  useAppDispatch,
  useAppState,
} from "../../state/AppStore";
import type { ToolId } from "../../state/reducer";
import { identitySource, withRole } from "../dataIdentity";
import { targetColumnOf } from "../left/datasetSource";
import { keyParamsFromSchema } from "../left/keyParams";
import { toolParamsKey } from "../left/keyTunable";
import { computeStat, fmtStat } from "../left/stats";
import { stripNullParams } from "../schemaFields";
import { toolDef } from "../toolrail/tools";
import { useWorkbenchData } from "../WorkbenchData";
import {
  SCOPEABLE_TOOLS,
  engineColumnsParam,
  isNumericKind,
  outliersBoundLabel,
  schemaHasBy,
  schemaHasColumns,
  selectedNumericColumns,
} from "./columnScope";
import { EMPTY_DATA_ROWS_MSG } from "../format";
import { AnalysisResultView } from "./AnalysisResultView";
import { chartPrefillForWindow } from "./chartPrefill";
import { DockParamsPanel } from "./DockParamsPanel";
import { IdentityStrip } from "./IdentityStrip";

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

/** Tools that run through run_key and expose a Parameters panel (MAT-174). */
const ENGINE_TOOLS = new Set<ToolId>([
  "outliers",
  "missing",
  "target",
  "drift",
  "feature_selection",
  "dist",
  "corr",
]);

/** Per-column param persistence (smart defaults differ by column). */
const PER_COLUMN_PARAM_TOOLS = new Set<ToolId>(["dist", "outliers", "target"]);

const COMPARE_STATS = ["mean", "median", "std", "min", "max"] as const;
const PARAM_DEBOUNCE_MS = 300;

/** Survives dock close/reopen — keyed by version+tool+params (+ selection scope). */
type DockResultCacheEntry = {
  profiles: ColumnProfile[];
  rows: WorkspaceRow[];
  result: Result | null;
  msg: string | null;
  bound: string;
  hasColumnsParam: boolean;
  corrCols: string[];
  error: string | null;
  runParams: string | null;
};
const dockResultCache = new Map<string, DockResultCacheEntry>();

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
  const { workspace, selection, role, distBy, toolParams, toolViews } =
    useAppState();
  const dispatch = useAppDispatch();
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
  const [corrCols, setCorrCols] = useState<string[]>([]);
  /** Params of the last run_key (source pinned to the identity) — e2e / debug. */
  const [runParams, setRunParams] = useState<string | null>(null);
  /** Identity of the data currently rendered (null while loading). */
  const [shownIdentity, setShownIdentity] = useState<string | null>(null);

  const selCols = selection.columns;
  const focus = selCols[0] ?? selection.cell?.col ?? null;
  const target = workspace ? targetColumnOf(workspace) : null;
  const def = toolDef(id);
  const selKey = selCols.join(",");
  const identity = bench.identity;
  const showScopeToggle = SCOPEABLE_TOOLS.has(id);
  /** Split-by for Distribution: engine `by` (target / any column). */
  const splitBy = distBy && distBy !== focus ? distBy : null;

  const paramColumn =
    PER_COLUMN_PARAM_TOOLS.has(id) && focus ? focus : null;
  const storageKey = toolParamsKey(id, paramColumn);
  const userParams = toolParams[storageKey] ?? {};
  const paramsJson = JSON.stringify(userParams);
  const [debouncedParamsJson, setDebouncedParamsJson] = useState(paramsJson);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedParamsJson(paramsJson);
    }, PARAM_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [paramsJson]);

  const debouncedUserParams = useMemo(() => {
    try {
      return JSON.parse(debouncedParamsJson) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [debouncedParamsJson]);

  const showParamsPanel = ENGINE_TOOLS.has(id);

  const dockCacheKey = useMemo(() => {
    if (!workspace?.datasets.train.x.path) return null;
    return [
      identity.key,
      id,
      debouncedParamsJson,
      selKey,
      focus ?? "",
      role,
      scopeAll ? "1" : "0",
      splitBy ?? "",
      target ?? "",
    ].join("\0");
  }, [
    workspace,
    identity.key,
    id,
    debouncedParamsJson,
    selKey,
    focus,
    role,
    scopeAll,
    splitBy,
    target,
  ]);

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

    // Reopen with nothing changed → reuse last result (not just warm bench data).
    if (dockCacheKey) {
      const hit = dockResultCache.get(dockCacheKey);
      if (hit) {
        setProfiles(hit.profiles);
        setRows(hit.rows);
        setResult(hit.result);
        setMsg(hit.msg);
        setBound(hit.bound);
        setHasColumnsParam(hit.hasColumnsParam);
        setCorrCols(hit.corrCols);
        setError(hit.error);
        setRunParams(hit.runParams);
        setShownIdentity(identity.key);
        setReady(true);
        return;
      }
    }

    let cancelled = false;
    let cacheBound = "";
    let cacheMsg: string | null = null;
    let cacheResult: Result | null = null;
    let cacheHasColumns = false;
    let cacheCorr: string[] = [];
    let cacheProfiles: ColumnProfile[] = [];
    let cacheRows: WorkspaceRow[] = [];
    let cacheError: string | null = null;
    let cacheRunParams: string | null = null;
    const idKey = identity.key;

    (async () => {
      setReady(false);
      setError(null);
      setMsg(null);
      setResult(null);
      setRunParams(null);
      setShownIdentity(null);
      try {
        await ensureWorkspaceSaved(workspace);
        if (cancelled) return;
        let profColumns: ColumnProfile[];
        let pageRows: WorkspaceRow[];
        // Reuse the grid's frame only when it is exactly this identity
        // (same version is not enough: a step's params may have changed).
        const canReuse =
          bench.profiles.size > 0 &&
          bench.profilesIdentity === idKey &&
          bench.rowsIdentity === idKey;
        if (canReuse) {
          profColumns = [...bench.profiles.values()];
          pageRows = bench.rows;
        } else {
          const prof = await apiClient.columnProfiles(
            workspace,
            role,
            identity.version,
          );
          const wr = await apiClient.workspaceRows(
            workspace,
            role,
            identity.version,
            0,
            500,
          );
          profColumns = prof.columns;
          pageRows = wr.rows;
        }
        if (cancelled) return;
        cacheProfiles = profColumns;
        cacheRows = pageRows;
        setProfiles(profColumns);
        setRows(pageRows);

        if (id === "compare") {
          const cs = selCols.filter((c) =>
            profColumns.some((p) => p.name === c),
          );
          if (cs.length < 2) {
            cacheMsg =
              "Select two or more columns (shift-click headers, or right-click → Add to selection).";
            setMsg(cacheMsg);
          } else {
            cacheBound = `${cs.length} columns · ${role}`;
            setBound(cacheBound);
          }
          return;
        }

        if (id === "corr") {
          const nums = profColumns
            .filter((p) => isNumericKind(p.kind) && p.name !== target)
            .map((p) => p.name);
          const selNum = selCols.filter((c) =>
            profColumns.some(
              (p) =>
                p.name === c && isNumericKind(p.kind) && c !== target,
            ),
          );
          const useSelection = !scopeAll && selNum.length >= 2;
          const use = (useSelection ? selNum : nums).slice(0, 7);
          if (use.length < 2) {
            cacheMsg = "Need at least two numeric columns.";
            setMsg(cacheMsg);
            setCorrCols([]);
            return;
          }
          cacheCorr = use;
          setCorrCols(use);
          cacheBound = useSelection
            ? `bound to selection · ${selNum.length} columns · key correlations`
            : "all numeric columns · key correlations";
          setBound(cacheBound);
          // Fall through to engine run.
        }

        if (id === "dist") {
          if (!focus || !profColumns.some((p) => p.name === focus)) {
            cacheMsg = "Select a column to see its distribution.";
            setMsg(cacheMsg);
            return;
          }
          cacheBound = splitBy
            ? `bound to ${focus} · split by ${splitBy} · key column_distribution`
            : `bound to ${focus} · key column_distribution`;
          setBound(cacheBound);
          // Always run engine so bins / log / norm knobs apply (MAT-174).
        }

        if (id === "missing") {
          const useSelection = !scopeAll && selCols.length > 0;
          cacheBound = useSelection
            ? selCols.length === 1
              ? `bound to ${selCols[0]} · key missing_values`
              : `bound to selection · ${selCols.length} columns · key missing_values`
            : `${role} · all columns · key missing_values`;
          setBound(cacheBound);
        }

        if (id === "outliers") {
          const selNum = selectedNumericColumns(selCols, profColumns);
          if (!scopeAll) {
            if (selNum.length === 0) {
              cacheMsg =
                "Select a numeric column. Fences: Q1 − 1.5·IQR and Q3 + 1.5·IQR, sentinels excluded.";
              setMsg(cacheMsg);
              return;
            }
            cacheBound =
              selNum.length === 1
                ? `${outliersBoundLabel(selNum[0]!, profColumns.find((c) => c.name === selNum[0]))} · key outliers`
                : `bound to selection · ${selNum.length} columns · key outliers`;
            setBound(cacheBound);
          } else {
            cacheBound = "all numeric columns · key outliers";
            setBound(cacheBound);
          }
        }

        if (id === "target" || id === "feature_selection") {
          if (!target) {
            cacheMsg =
              "No target yet: set it on the Sources screen, or right-click a column → Set as target.";
            setMsg(cacheMsg);
            return;
          }
          if (role === "test") {
            cacheMsg = "The test set has no label. Switch to Train.";
            setMsg(cacheMsg);
            return;
          }
        }

        const runEngine = ENGINE_TOOLS.has(id);
        if (runEngine) {
          const available: Record<string, unknown> = {
            source: identitySource(identity),
            ...debouncedUserParams,
          };
          // train_test_check takes `train` + `test` (no `source`): without an
          // explicit train it silently analysed the engine's demo CSV. It
          // always compares train against test, whatever role is viewed.
          available.train = identitySource(
            withRole(workspace, identity, "train"),
            false,
          );
          // The test frame is unlabeled: a target there is a KeyParamsError.
          if (target && role === "train") available.target = target;
          if (workspace.datasets.test) {
            available.test = identitySource(
              withRole(workspace, identity, "test"),
              false,
            );
          }
          const schema = await apiClient.keySchema(def.key);
          if (cancelled) return;
          const hasCols = schemaHasColumns(schema);
          cacheHasColumns = hasCols;
          setHasColumnsParam(hasCols);
          if (hasCols) {
            if (id === "outliers") {
              const selNum = selectedNumericColumns(selCols, profColumns);
              const cols = scopeAll ? null : selNum;
              if (cols && cols.length > 0) available.columns = cols;
            } else if (id === "missing") {
              const cols = engineColumnsParam(selCols, scopeAll);
              if (cols && cols.length > 0) available.columns = cols;
            } else if (id === "dist" && focus) {
              available.columns = [focus];
            } else if (id === "corr") {
              const nums = profColumns
                .filter((p) => isNumericKind(p.kind) && p.name !== target)
                .map((p) => p.name);
              const selNum = selCols.filter((c) =>
                profColumns.some(
                  (p) =>
                    p.name === c &&
                    isNumericKind(p.kind) &&
                    c !== target,
                ),
              );
              const useSelection = !scopeAll && selNum.length >= 2;
              const use = (useSelection ? selNum : nums).slice(0, 7);
              if (use.length > 0) available.columns = use;
            } else {
              const cols = engineColumnsParam(selCols, scopeAll);
              if (cols) {
                const usable =
                  id === "feature_selection"
                    ? cols.filter((c) => {
                        const p = profColumns.find((pc) => pc.name === c);
                        return p && isNumericKind(p.kind) && c !== target;
                      })
                    : cols;
                if (usable.length > 0) available.columns = usable;
              }
            }
          }
          if (id === "dist" && splitBy && schemaHasBy(schema)) {
            available.by = splitBy;
          }
          // Structural wins over user params for columns / by / target / sources.
          const params = stripNullParams(
            keyParamsFromSchema(schema, available),
          );
          const r = await apiClient.runKey(def.key, params);
          if (cancelled) return;
          cacheRunParams = JSON.stringify(params);
          setRunParams(cacheRunParams);
          cacheResult = r;
          setResult(r);
          if (id === "outliers") {
            const selNum = selectedNumericColumns(selCols, profColumns);
            if (scopeAll) {
              cacheBound = "all numeric columns · key outliers";
            } else if (selNum.length === 1) {
              cacheBound = `${outliersBoundLabel(selNum[0]!, profColumns.find((c) => c.name === selNum[0]))} · key outliers`;
            } else {
              cacheBound = `bound to selection · ${selNum.length} columns · key outliers`;
            }
            setBound(cacheBound);
          } else if (id === "missing") {
            const useSelection = !scopeAll && selCols.length > 0;
            cacheBound = useSelection
              ? selCols.length === 1
                ? `bound to ${selCols[0]} · key missing_values`
                : `bound to selection · ${selCols.length} columns · key missing_values`
              : `all columns · key missing_values`;
            setBound(cacheBound);
          } else if (id === "dist" && focus) {
            cacheBound = splitBy
              ? `bound to ${focus} · split by ${splitBy} · key column_distribution`
              : `bound to ${focus} · key column_distribution`;
            setBound(cacheBound);
          } else if (id === "corr") {
            cacheBound = `key correlations · ${(available.columns as string[] | undefined)?.length ?? 0} columns`;
            setBound(cacheBound);
          } else if (
            (id === "target" || id === "feature_selection") &&
            hasCols
          ) {
            const cols = engineColumnsParam(selCols, scopeAll);
            cacheBound = cols
              ? cols.length === 1
                ? `bound to ${cols[0]} · key ${def.key}`
                : `bound to selection · ${cols.length} columns · key ${def.key}`
              : `all features · key ${def.key}`;
            setBound(cacheBound);
          } else {
            cacheBound = `key ${def.key}`;
            setBound(cacheBound);
          }
        }
      } catch (e) {
        if (cancelled) return;
        cacheError = e instanceof EngineError ? e.message : String(e);
        setError(cacheError);
      } finally {
        if (!cancelled) {
          setReady(true);
          setShownIdentity(idKey);
          if (dockCacheKey) {
            dockResultCache.set(dockCacheKey, {
              profiles: cacheProfiles,
              rows: cacheRows,
              result: cacheResult,
              msg: cacheMsg,
              bound: cacheBound,
              hasColumnsParam: cacheHasColumns,
              corrCols: cacheCorr,
              error: cacheError,
              runParams: cacheRunParams,
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    workspace,
    identity,
    selCols,
    selKey,
    focus,
    role,
    id,
    target,
    def.key,
    scopeAll,
    splitBy,
    debouncedParamsJson,
    debouncedUserParams,
    dockCacheKey,
    bench.profiles,
    bench.rows,
    bench.profilesIdentity,
    bench.rowsIdentity,
  ]);

  const profileByName = useMemo(() => {
    const m = new Map<string, ColumnProfile>();
    for (const p of profiles) m.set(p.name, p);
    return m;
  }, [profiles]);

  const focusProfile = focus ? profileByName.get(focus) : undefined;
  const columnKinds = useMemo(
    () => profiles.map((p) => ({ name: p.name, kind: p.kind })),
    [profiles],
  );
  const columnNames = useMemo(() => profiles.map((p) => p.name), [profiles]);

  /**
   * Click-through (MAT-235): a column clicked in a figure becomes the grid
   * selection, so the other windows follow. A window showing all columns
   * keeps showing them (widens its scope) instead of narrowing to the click.
   */
  const onColumnsClick = (cols: string[], add: boolean) => {
    const scopedToSelection =
      id === "corr"
        ? selCols.filter((c) => {
            const k = profileByName.get(c)?.kind;
            return !!k && isNumericKind(k) && c !== target;
          }).length >= 2
        : selCols.length > 0;
    if (SCOPEABLE_TOOLS.has(id) && !scopedToSelection) setScopeAll(true);
    if (!add) dispatch({ type: "CLEAR_SELECTION" });
    for (const name of cols) {
      if (!add || !selCols.includes(name)) {
        dispatch({ type: "PICK_COL", name, add: true });
      }
    }
  };

  /** Open in Chart (MAT-235): the columns / split the key actually ran on. */
  const openInChart = () => {
    let params: Record<string, unknown> = {};
    try {
      params = runParams ? (JSON.parse(runParams) as Record<string, unknown>) : {};
    } catch {
      /* no run params: fall back to the selection */
    }
    let names = Array.isArray(params.columns)
      ? params.columns.filter((c): c is string => typeof c === "string")
      : scopeAll
        ? []
        : [...selCols];
    if (id === "target" && typeof params.target === "string") {
      const feature = names.find((n) => n !== params.target);
      names = feature ? [feature, params.target] : [params.target];
    }
    const by = typeof params.by === "string" ? params.by : null;
    const cols = names.map((name) => ({
      name,
      kind: profileByName.get(name)?.kind ?? "text",
    }));
    dispatch({ type: "SET_CHART_DRAFT", draft: chartPrefillForWindow(cols, by) });
    dispatch({ type: "OPEN_TOOL", id: "chart" });
  };

  const paramsPanel =
    showParamsPanel && workspace?.datasets.train.x.path ? (
      <DockParamsPanel
        keyId={def.key}
        storageKey={storageKey}
        params={userParams}
        columns={columnKinds}
        profile={focusProfile}
        open={toolViews[id]?.params === true}
        onToggle={() =>
          dispatch({
            type: "PATCH_TOOL_VIEW",
            key: id,
            patch: { params: toolViews[id]?.params !== true },
          })
        }
      />
    ) : null;

  const splitByBar =
    id === "dist" ? (
      <div className="dock-split-by">
        <label htmlFor="dock-split-by">
          Split by
          <select
            id="dock-split-by"
            aria-label="Split by"
            value={splitBy ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              dispatch({ type: "SET_DIST_BY", by: v || null });
            }}
          >
            <option value="">(none)</option>
            {profiles
              .map((p) => p.name)
              .filter((name) => name !== focus)
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                  {name === target ? " (target)" : ""}
                </option>
              ))}
          </select>
        </label>
      </div>
    ) : null;

  const subchrome = (
    <div className="dock-subchrome">
      <IdentityStrip
        identity={identity}
        shownIdentity={shownIdentity}
        editing={!!bench.pendingStep}
      />
      {showScopeToggle ? (
        <ScopeToggle scopeAll={scopeAll} onChange={setScopeAll} />
      ) : null}
      {splitByBar}
      {paramsPanel}
      {bound ? (
        <span className="dock-bound muted" title={bound}>
          {bound}
        </span>
      ) : null}
    </div>
  );

  // Every branch carries the identity it shows (MAT-175): `data-identity`
  // is the frame the rendered numbers come from; the strip says which
  // version that is, and flags a live edit that is not applied yet.
  const wrap = (node: ReactNode) => (
    <div
      className="dock-identity-wrap"
      data-identity={shownIdentity ?? ""}
      data-identity-current={identity.key}
      data-run-params={runParams ?? undefined}
    >
      {node}
    </div>
  );

  if (error) {
    return wrap(
      <div>
        {subchrome}
        <div className="engine-error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (!ready) {
    return wrap(
      <div>
        {subchrome}
        <div className="dock-msg muted">Loading…</div>
      </div>
    );
  }
  // Header-only / empty frame: no blank axes in Distribution etc. (MAT-154 #2).
  if (
    bench.total === 0 &&
    (profiles.length > 0 ||
      bench.columns.length > 0 ||
      bench.display.cols.length > 0)
  ) {
    return wrap(
      <div data-empty-rows="1">
        {subchrome}
        <div className="dock-empty-state" role="status">
          {EMPTY_DATA_ROWS_MSG}
        </div>
      </div>
    );
  }
  if (msg) {
    const selNum =
      id === "outliers" && !scopeAll
        ? selectedNumericColumns(selCols, profiles)
        : [];
    const outliersCol = selNum.length === 1 ? selNum[0] : undefined;
    return wrap(
      <div
        data-scope-mode={scopeAll ? "all" : "selection"}
        {...(outliersCol
          ? {
              "data-outliers-col": outliersCol,
              "data-outliers-cols": outliersCol,
            }
          : {})}
        {...(id === "dist"
          ? {
              "data-dist-col": focus ?? undefined,
              "data-dist-by": splitBy ?? "",
            }
          : {})}
      >
        {subchrome}
        <div className="dock-msg">{msg}</div>
      </div>
    );
  }

  if (id === "compare") {
    const cs = selCols.filter((c) => profileByName.has(c)).slice(0, 6);
    if (cs.length < 2) {
      return wrap(
        <div>
          {subchrome}
          <div className="dock-msg">
            Select two or more columns (shift-click headers, or right-click → Add
            to selection).
          </div>
        </div>
      );
    }
    return wrap(
      <div>
        {subchrome}
        <CompareNative
          cols={cs}
          profiles={profileByName}
          rows={rows}
          target={target}
          bound=""
        />
      </div>
    );
  }

  if (id === "missing" && !result) {
    const useSelection = !scopeAll && selCols.length > 0;
    return wrap(
      <div
        data-scope-mode={useSelection ? "selection" : "all"}
        data-missing-cols={
          useSelection
            ? selCols.join(",")
            : profiles.map((c) => c.name).join(",")
        }
      >
        {subchrome}
        <div className="dock-msg muted">Loading…</div>
      </div>
    );
  }

  if (result) {
    const selNum =
      id === "outliers" && !scopeAll
        ? selectedNumericColumns(selCols, profiles)
        : [];
    const outliersCol = selNum.length === 1 ? selNum[0] : undefined;
    const missingCols =
      id === "missing" && !scopeAll && selCols.length > 0 ? selCols : null;
    return wrap(
      <div
        className="dock-result"
        data-scope-mode={scopeAll ? "all" : "selection"}
        data-engine-key={def.key}
        data-has-columns-param={hasColumnsParam ? "1" : "0"}
        {...(id === "outliers"
          ? {
              ...(outliersCol
                ? {
                    "data-outliers-col": outliersCol,
                    "data-outliers-cols": outliersCol,
                  }
                : selNum.length > 1
                  ? { "data-outliers-cols": selNum.join(",") }
                  : {}),
            }
          : {})}
        {...(id === "missing"
          ? {
              "data-missing-cols":
                missingCols?.join(",") ??
                profiles.map((c) => c.name).join(","),
            }
          : {})}
        {...(id === "dist"
          ? {
              "data-dist-col": focus ?? undefined,
              "data-dist-by": splitBy ?? "",
              "data-dist-bins":
                debouncedUserParams.bins !== undefined
                  ? String(debouncedUserParams.bins)
                  : undefined,
            }
          : {})}
        {...(id === "corr"
          ? {
              "data-corr-size": String(
                corrCols.length ||
                  ((debouncedUserParams.columns as string[] | undefined)
                    ?.length ?? 0),
              ),
            }
          : {})}
        {...(id === "outliers" &&
        debouncedUserParams.contamination !== undefined
          ? {
              "data-outliers-contamination": String(
                debouncedUserParams.contamination,
              ),
            }
          : {})}
      >
        {subchrome}
        <AnalysisResultView
          result={result}
          viewKey={id}
          columns={columnNames}
          onColumnsClick={onColumnsClick}
          onOpenChart={openInChart}
        />
      </div>
    );
  }
  return wrap(
    <div>
      {subchrome}
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

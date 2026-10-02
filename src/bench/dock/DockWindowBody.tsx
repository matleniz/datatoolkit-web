import { useMemo, useState, type ReactNode } from "react";

import { apiClient } from "../../api/client";
import type { ColumnProfile, Result, WorkspaceRow } from "../../api/types";
import {
  ensureWorkspaceSaved,
  useAppDispatch,
  useAppState,
} from "../../state/AppStore";
import type { ToolId } from "../../state/reducer";
import { identitySource, withRole } from "../dataIdentity";
import { targetColumnOf } from "../left/datasetSource";
import { keyParamsFromSchema } from "../left/keyParams";
import { PER_COLUMN_PARAM_TOOLS, toolParamsKey } from "../left/keyTunable";
import { fmtStat } from "../left/stats";
import { stripNullParams } from "../schemaFields";
import { toolDef } from "../toolrail/tools";
import { useDebounced, useKeyedAsync } from "../../hooks";
import { useWorkbenchData } from "../WorkbenchData";
import {
  SCOPEABLE_TOOLS,
  isNumericKind,
  schemaHasBy,
  schemaHasColumns,
} from "./columnScope";
import {
  chartColumnsOf,
  corrRanColumns,
  corrSelectedCount,
  toolDataAttrs,
  toolPlan,
  type PlanCtx,
} from "./dockToolPlan";
import { EMPTY_DATA_ROWS_MSG } from "../format";
import { AnalysisResultView } from "./AnalysisResultView";
import { chartPrefillForWindow } from "./chartPrefill";
import { compareStatsPlan, useCompareStats } from "./compareStats";
import { DockParamsPanel } from "./DockParamsPanel";
import { IdentityStrip } from "./IdentityStrip";

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
  "dataset_overview",
  "duplicates",
  "inconsistencies",
  "preprocessing_advisor",
]);

const COMPARE_STATS = ["mean", "median", "std", "min", "max"] as const;
const PARAM_DEBOUNCE_MS = 300;

/** One run of a dock window; also the entry cached across dock close/reopen. */
interface DockRun {
  profiles: ColumnProfile[];
  rows: WorkspaceRow[];
  result: Result | null;
  msg: string | null;
  bound: string;
  hasColumnsParam: boolean;
  corrCols: string[];
  /** Params of the last run_key (source pinned to the identity) — e2e / debug. */
  runParams: string | null;
}
const EMPTY_RUN: DockRun = {
  profiles: [],
  rows: [],
  result: null,
  msg: null,
  bound: "",
  hasColumnsParam: false,
  corrCols: [],
  runParams: null,
};
const NO_WORKSPACE_RUN: DockRun = {
  ...EMPTY_RUN,
  msg: "Load a workspace with a train source to run this tool.",
};

/** Keyed by version+tool+params (+ selection scope). */
const dockResultCache = new Map<string, DockRun>();

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
      className={scopeAll ? "chip dock-scope-chip on" : "chip dock-scope-chip"}
      aria-pressed={scopeAll}
      aria-label={
        scopeAll
          ? "Restrict analysis to selected columns"
          : "Widen analysis to all columns"
      }
      data-scope-all={scopeAll ? "1" : "0"}
      title={
        scopeAll
          ? "Scope: all columns (click to switch to selection)"
          : "Scope: selection only (click to switch to all columns)"
      }
      onClick={() => onChange(!scopeAll)}
    >
      <span className="dock-scope-label">{scopeAll ? "All cols" : "Selection"}</span>
    </button>
  );
}

function SplitByBar({
  splitBy,
  names,
  target,
  onChange,
}: {
  splitBy: string | null;
  names: string[];
  target: string | null;
  onChange: (by: string | null) => void;
}) {
  return (
    <div className="dock-split-by" title="Split by column">
      <label htmlFor="dock-split-by">
        <span className="dock-split-label">By</span>
        <select
          id="dock-split-by"
          aria-label="Split by"
          value={splitBy ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">(none)</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
              {name === target ? " (target)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** What to render for a key: cached entry > settled run > placeholder. */
function resolveRun(
  key: string | null,
  cached: DockRun | undefined,
  run: { value: DockRun | undefined; error: string | null; ready: boolean },
) {
  if (!key) return { shown: NO_WORKSPACE_RUN, error: null, ready: true };
  if (cached) return { shown: cached, error: null, ready: true };
  return { shown: run.value ?? EMPTY_RUN, error: run.error, ready: run.ready };
}

export function DockWindowBody({ id }: { id: ToolId }) {
  const { workspace, selection, role, distBy, toolParams, toolViews } =
    useAppState();
  const dispatch = useAppDispatch();
  const bench = useWorkbenchData();
  const [scopeAll, setScopeAll] = useState(false);

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
  const debouncedParamsJson = useDebounced(paramsJson, PARAM_DEBOUNCE_MS);

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

  const planCtx = (profiles: ColumnProfile[]): PlanCtx => ({
    id,
    key: def.key,
    role,
    selCols,
    scopeAll,
    target,
    focus,
    splitBy,
    profiles,
  });

  /** The grid's frame when it is exactly this identity, else fetched. */
  const loadFrame = async () => {
    // Same version is not enough: a step's params may have changed.
    if (
      bench.profiles.size > 0 &&
      bench.profilesIdentity === identity.key &&
      bench.rowsIdentity === identity.key
    ) {
      return { profiles: [...bench.profiles.values()], rows: bench.rows };
    }
    const prof = await apiClient.columnProfiles(workspace!, role, identity.version);
    const wr = await apiClient.workspaceRows(workspace!, role, identity.version, 0, 500);
    return { profiles: prof.columns, rows: wr.rows };
  };

  const runEngine = async (
    plan: ReturnType<typeof toolPlan>,
    ctx: PlanCtx,
    alive: () => boolean,
  ): Promise<Partial<DockRun>> => {
    const available: Record<string, unknown> = {
      source: identitySource(identity),
      ...debouncedUserParams,
    };
    // train_test_check takes `train` + `test` (no `source`): without an
    // explicit train it silently analysed the engine's demo CSV. It
    // always compares train against test, whatever role is viewed.
    available.train = identitySource(
      withRole(workspace!, identity, "train"),
      false,
    );
    // The test frame is unlabeled: a target there is a KeyParamsError.
    if (target && role === "train") available.target = target;
    if (workspace!.datasets.test) {
      available.test = identitySource(
        withRole(workspace!, identity, "test"),
        false,
      );
    }
    const schema = await apiClient.keySchema(def.key);
    if (!alive()) return {};
    const hasCols = schemaHasColumns(schema);
    const cols = hasCols ? plan.columns?.(ctx) : null;
    if (cols && cols.length > 0) available.columns = cols;
    if (id === "dist" && splitBy && schemaHasBy(schema)) {
      available.by = splitBy;
    }
    // Structural wins over user params for columns / by / target / sources.
    const params = stripNullParams(keyParamsFromSchema(schema, available));
    const result = await apiClient.runKey(def.key, params);
    const ran = id === "corr" ? corrRanColumns(result, cols) : [];
    return {
      result,
      hasColumnsParam: hasCols,
      corrCols: ran,
      runParams: JSON.stringify(params),
      bound: plan.bound(ctx, {
        hasCols,
        sent: available.columns as string[] | undefined,
        ran,
      }),
    };
  };

  // Reopen with nothing changed reuses the last result (not just warm bench data).
  const cached = dockCacheKey ? dockResultCache.get(dockCacheKey) : undefined;
  const run = useKeyedAsync<DockRun>(
    dockCacheKey,
    async (alive) => {
      await ensureWorkspaceSaved(workspace!);
      const frame = await loadFrame();
      const base = { ...EMPTY_RUN, ...frame };
      if (!alive()) return base;
      const plan = toolPlan(id);
      const ctx = planCtx(frame.profiles);
      const msg = plan.guard?.(ctx) ?? null;
      const out: DockRun = msg
        ? { ...base, msg }
        : plan.engine
          ? { ...base, ...(await runEngine(plan, ctx, alive)) }
          : { ...base, bound: plan.bound(ctx, { hasCols: false, sent: undefined }) };
      if (alive()) dockResultCache.set(dockCacheKey!, out);
      return out;
    },
    !cached,
  );
  const { shown, error, ready } = resolveRun(dockCacheKey, cached, run);
  const { profiles, result, msg, bound, hasColumnsParam, corrCols, runParams } =
    shown;
  /** Identity of the data currently rendered (null while loading). */
  const shownIdentity = dockCacheKey && ready ? identity.key : null;

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
        ? corrSelectedCount(planCtx(profiles)) >= 2
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
    const { names, by } = chartColumnsOf(id, runParams, scopeAll, selCols, corrCols);
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

  const subchrome = (
    <div className="dock-subchrome">
      <IdentityStrip
        identity={identity}
        shownIdentity={shownIdentity}
        editing={!!bench.pendingStep}
        compact
      />
      {showScopeToggle ? (
        <ScopeToggle scopeAll={scopeAll} onChange={setScopeAll} />
      ) : null}
      {id === "dist" ? (
        <SplitByBar
          splitBy={splitBy}
          names={columnNames.filter((name) => name !== focus)}
          target={target}
          onChange={(by) => dispatch({ type: "SET_DIST_BY", by })}
        />
      ) : null}
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
  const attrs = (full: boolean) =>
    toolDataAttrs(planCtx(profiles), {
      full,
      params: debouncedUserParams,
      corrCols,
    });
  const scopeMode = scopeAll ? "all" : "selection";

  if (msg) {
    return wrap(
      <div data-scope-mode={scopeMode} {...attrs(false)}>
        {subchrome}
        <div className="dock-msg">{msg}</div>
      </div>
    );
  }

  if (id === "compare") {
    return wrap(
      <div>
        {subchrome}
        <CompareNative
          cols={selCols.filter((c) => profileByName.has(c)).slice(0, 6)}
          profiles={profileByName}
          source={identitySource(identity)}
          statsKey={shownIdentity}
          target={target}
          bound=""
        />
      </div>
    );
  }

  if (result) {
    return wrap(
      <div
        className="dock-result"
        data-scope-mode={scopeMode}
        data-engine-key={def.key}
        data-has-columns-param={hasColumnsParam ? "1" : "0"}
        {...attrs(true)}
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
  source,
  statsKey,
  target,
  bound,
}: {
  cols: string[];
  profiles: Map<string, ColumnProfile>;
  /** The grid's dataset identity: stats run on the whole frame (#75). */
  source: ReturnType<typeof identitySource>;
  statsKey: string | null;
  target: string | null;
  bound: string;
}) {
  const kinds = useMemo(
    () => new Map([...profiles].map(([n, p]) => [n, p.kind])),
    [profiles],
  );
  const plan = useMemo(
    () => compareStatsPlan(cols, kinds, target),
    [cols, kinds, target],
  );
  const full = useCompareStats(statsKey, source, plan, target);
  const pending = plan.numeric.length > 0 && !full.ready;
  const cell = (v: string) => (pending ? "…" : v);
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
        return cell(fmtStat(full.value?.stats[c]?.[stat] ?? null));
      },
    });
  }
  if (target && profiles.has(target)) {
    rowsDef.push({
      name: `r with ${target}`,
      fn: (c) => {
        if (!isNumericKind(profiles.get(c)?.kind ?? "")) return "–";
        const r = full.value?.corr[c] ?? null;
        return cell(r === null ? "–" : r.toFixed(2));
      },
    });
  }

  return (
    <div data-compare-cols={cols.join(",")} data-scope-mode="selection">
      <div className="dock-bound muted">{bound}</div>
      {full.error && (
        <div className="dock-msg" role="alert">
          Could not compute the statistics on the full frame: {full.error}
        </div>
      )}
      <div className="matrix" data-stats-state={full.error ? "error" : pending ? "loading" : "ready"}>
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

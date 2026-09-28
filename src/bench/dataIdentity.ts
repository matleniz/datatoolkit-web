import type { DatasetSource, Role, Workspace } from "../api/types";

/**
 * Refresh-identity contract (MAT-175).
 *
 * One "data identity" names the exact frame a consumer shows: workspace name,
 * role, effective version, and a hash of everything that feeds that frame
 * (sources, label join, merges, and the first `version` steps with their
 * params). Every consumer that shows data — grid, profiles, inspector, dock
 * windows, suggestions, variables — keys its fetches / caches on `key` and
 * runs analysis keys with a source built from the same identity
 * (`identitySource`), so it can never show another version's numbers.
 *
 * Steps after `version` are excluded on purpose: editing or removing a later
 * step does not change what an older version looks like.
 */
export interface DataIdentity {
  workspace: string;
  role: Role;
  /** Effective version: number of replayed steps (0 = sources). */
  version: number;
  /** Hash of sources + label + merges + steps[0:version] (params included). */
  stepsHash: string;
  /** Stable string for deps / cache keys / DOM `data-identity`. */
  key: string;
}

/** FNV-1a 32-bit, hex — cheap and stable; collisions only cost a refetch miss. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function clampVersion(ws: Workspace, version: number | null): number {
  const last = ws.steps.length;
  if (version === null || version > last) return last;
  if (version < 0) return 0;
  return version;
}

/** Hash of the inputs that determine the frame at `version`. */
export function stepsHash(ws: Workspace, version: number | null): string {
  const v = clampVersion(ws, version);
  return fnv1a(
    JSON.stringify({
      datasets: ws.datasets,
      label: ws.label,
      merges: ws.merges ?? [],
      steps: ws.steps.slice(0, v).map((s) => ({
        op: s.op,
        target: s.target,
        params: s.params,
      })),
    }),
  );
}

/**
 * Identity of `role` at `version` (null = latest). A null workspace yields an
 * empty identity so consumers can still depend on `.key`.
 */
export function dataIdentity(
  ws: Workspace | null,
  role: Role,
  version: number | null,
): DataIdentity {
  if (!ws) {
    return { workspace: "", role, version: 0, stepsHash: "", key: `|${role}|v0|` };
  }
  const v = clampVersion(ws, version);
  const hash = stepsHash(ws, v);
  return {
    workspace: ws.name,
    role,
    version: v,
    stepsHash: hash,
    key: `${ws.name}|${role}|v${v}|${hash}`,
  };
}

/** Same identity for another role (e.g. the test side of a drift check). */
export function withRole(
  ws: Workspace | null,
  id: DataIdentity,
  role: Role,
): DataIdentity {
  return role === id.role ? id : dataIdentity(ws, role, id.version);
}

/** "train · v2" / "test · sources" — the frame a window or tab is bound to. */
export function identityLabel(id: DataIdentity): string {
  return `${id.role} · ${id.version === 0 ? "sources" : `v${id.version}`}`;
}

/**
 * `dataset` SourceSpec pinned to an identity: always carries the explicit
 * version so the engine replays exactly the steps the consumer is showing.
 */
export function identitySource(
  id: DataIdentity,
  labeled: boolean = id.role === "train",
): DatasetSource {
  return {
    kind: "dataset",
    workspace: id.workspace,
    role: id.role,
    labeled,
    version: id.version,
  };
}

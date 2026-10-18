import { apiClient } from "./api/client";
import { errorText, isCorruptEntry, type Workspace } from "./api/types";

const FILES = [
  "churn_train.csv",
  "churn_labels.csv",
  "churn_test.csv",
  "customers_extra.csv",
] as const;

const LAST_WORKSPACE_KEY = "dtk.lastWorkspace";

export function rememberWorkspaceName(name: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, name);
  } catch {
    /* private mode / SSR */
  }
}

export function forgetWorkspaceName(name?: string): void {
  try {
    if (name == null || localStorage.getItem(LAST_WORKSPACE_KEY) === name) {
      localStorage.removeItem(LAST_WORKSPACE_KEY);
    }
  } catch {
    /* private mode / SSR */
  }
}

function rememberedWorkspaceName(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

async function createChurnWorkspace(): Promise<Workspace> {
  const paths: Record<string, string> = {};
  for (const name of FILES) {
    const res = await fetch(`/fixtures/${name}`);
    if (!res.ok) {
      throw new Error(`Cannot load fixture ${name}`);
    }
    const body = await res.arrayBuffer();
    const up = await apiClient.upload(name, body);
    paths[name] = up.path;
  }

  const ws: Workspace = {
    name: "churn",
    datasets: {
      train: {
        x: { kind: "csv", path: paths["churn_train.csv"]! },
        y: { kind: "csv", path: paths["churn_labels.csv"]! },
      },
      test: {
        x: {
          kind: "csv",
          path: paths["churn_test.csv"]!,
          decimal: ",",
        },
      },
    },
    label: { mode: "order" },
    merges: [
      {
        source: { kind: "csv", path: paths["customers_extra.csv"]! },
        key: "customer_id",
        apply_to: "both",
      },
    ],
    variables: [],
    steps: [],
  };
  const saved = await apiClient.saveWorkspace(ws);
  rememberWorkspaceName(saved.name);
  return saved;
}

export interface SkippedWorkspace {
  name: string;
  reason: string;
}

export interface InitialLoad {
  workspace: Workspace;
  /** Set when the remembered workspace could not be opened and was forgotten. */
  skipped: SkippedWorkspace | null;
}

/**
 * Open the remembered workspace only if GET /workspaces lists it.
 * Otherwise seed the demo "churn" workspace without probing a missing name
 * (avoids GET /workspaces/churn → 404 on a fresh DTK_HOME).
 *
 * If opening the remembered workspace fails (HTTP error, invalid schema,
 * deleted concurrently), forget it and fall back once to `churn`, then to the
 * other valid entries, in list order. Each candidate is tried at most once;
 * when all fail the last error is thrown.
 */
export async function loadInitialWorkspace(): Promise<InitialLoad> {
  const list = await apiClient.listWorkspaces();
  // A corrupt entry is listed but cannot be opened: never auto-open it.
  const valid = list.filter((w) => !isCorruptEntry(w)).map((w) => w.name);
  const names = new Set(valid);
  const remembered = rememberedWorkspaceName();

  let skipped: SkippedWorkspace | null = null;
  if (remembered && names.has(remembered)) {
    try {
      return { workspace: await apiClient.getWorkspace(remembered), skipped };
    } catch (e) {
      forgetWorkspaceName(remembered);
      skipped = { name: remembered, reason: errorText(e) };
      names.delete(remembered);
    }
  }

  const candidates = [
    ...(names.has("churn") ? ["churn"] : []),
    // Only walk the other entries after a failure; a plain fresh start seeds churn.
    ...(skipped ? valid.filter((n) => n !== "churn" && names.has(n)) : []),
  ];
  let lastError: unknown = null;
  for (const name of candidates) {
    try {
      return { workspace: await apiClient.getWorkspace(name), skipped };
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  // Fresh store: create demo churn via upload + PUT (no GET 404).
  return { workspace: await createChurnWorkspace(), skipped };
}

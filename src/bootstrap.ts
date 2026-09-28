import { apiClient, serializeWorkspace } from "./api/client";
import type { Workspace } from "./api/types";

const FILES = [
  "churn_train.csv",
  "churn_labels.csv",
  "churn_test.csv",
  "customers_extra.csv",
] as const;

export const LAST_WORKSPACE_KEY = "dtk.lastWorkspace";

export function rememberWorkspaceName(name: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, name);
  } catch {
    /* private mode / SSR */
  }
}

export function rememberedWorkspaceName(): string | null {
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

/**
 * Open the remembered workspace only if GET /workspaces lists it.
 * Otherwise seed the demo "churn" workspace without probing a missing name
 * (avoids GET /workspaces/churn → 404 on a fresh DTK_HOME).
 */
export async function loadInitialWorkspace(): Promise<Workspace | null> {
  const list = await apiClient.listWorkspaces();
  const names = new Set(list.map((w) => w.name));
  const remembered = rememberedWorkspaceName();
  if (remembered && names.has(remembered)) {
    return apiClient.getWorkspace(remembered);
  }
  if (names.has("churn")) {
    return apiClient.getWorkspace("churn");
  }
  // Fresh store: create demo churn via upload + PUT (no GET 404).
  return createChurnWorkspace();
}

/** @deprecated Prefer loadInitialWorkspace — kept for callers that need churn. */
export async function ensureChurnWorkspace(): Promise<Workspace> {
  const list = await apiClient.listWorkspaces();
  if (list.some((w) => w.name === "churn")) {
    return apiClient.getWorkspace("churn");
  }
  return createChurnWorkspace();
}

export { serializeWorkspace };

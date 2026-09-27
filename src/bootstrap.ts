import { apiClient } from "./api/client";
import type { Workspace } from "./api/types";

const FILES = [
  "churn_train.csv",
  "churn_labels.csv",
  "churn_test.csv",
  "customers_extra.csv",
] as const;

/**
 * Ensure the demo "churn" workspace exists: upload public fixtures to dtk-api
 * and PUT the workspace. Used until W1 Sources owns workspace creation.
 */
export async function ensureChurnWorkspace(): Promise<Workspace> {
  try {
    return await apiClient.getWorkspace("churn");
  } catch {
    /* create below */
  }

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
  return apiClient.saveWorkspace(ws);
}

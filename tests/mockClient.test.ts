import { describe, expect, it } from "vitest";

import { MockApiClient, CHURN_FIXTURES } from "../src/api/mockClient";

describe("MockApiClient", () => {
  it("loads churn fixtures", () => {
    expect(CHURN_FIXTURES.train.columns[0]).toBe("customer_id");
    expect(CHURN_FIXTURES.train.rows).toHaveLength(20);
    expect(CHURN_FIXTURES.test.rows[0]?.[5]).toBe("41,0");
    expect(CHURN_FIXTURES.extra.columns).toEqual(["customer_id", "region"]);
  });

  it("lists and returns the seeded workspace", async () => {
    const client = new MockApiClient();
    const list = await client.listWorkspaces();
    expect(list.map((w) => w.name)).toContain("churn");
    const ws = await client.getWorkspace("churn");
    expect(ws.merges).toHaveLength(1);
    const rows = await client.workspaceRows(ws, "train", 0, 0, 5);
    expect(rows.rows).toHaveLength(5);
    expect(rows.rows[0]?._rid).toBe(0);
  });

  it("summaries, duplicate, rename, and delete (MAT-171)", async () => {
    const client = new MockApiClient();
    const summaries = await client.listWorkspaceSummaries();
    expect(summaries[0]?.name).toBe("churn");
    expect(summaries[0]?.train.file).toMatch(/churn_train/);
    expect(summaries[0]?.step_count).toBe(0);

    const dup = await client.duplicateWorkspace("churn", "churn-copy");
    expect(dup.name).toBe("churn-copy");
    expect(dup.datasets.train.x.path).toBe(
      (await client.getWorkspace("churn")).datasets.train.x.path,
    );

    const renamed = await client.renameWorkspace("churn-copy", "churn-renamed");
    expect(renamed.name).toBe("churn-renamed");
    await expect(client.getWorkspace("churn-copy")).rejects.toMatchObject({
      type: "WorkspaceNotFoundError",
    });

    await client.deleteWorkspace("churn-renamed");
    const names = (await client.listWorkspaceSummaries()).map((s) => s.name);
    expect(names).toEqual(["churn"]);
  });
});

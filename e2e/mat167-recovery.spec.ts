import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_DATA_ROWS_MSG,
} from "../src/bench/format";
import { fixturesDir, waitForGridReady } from "./helpers";

const STORED_FAIL = /Stored train source failed to parse/;
const EMPTY_MSG =
  /This train file has no columns \(empty or unreadable\)/;

async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({
    timeout: 15_000,
  });
}

async function uploadRaw(
  request: APIRequestContext,
  fixtureName: string,
): Promise<string> {
  const body = readFileSync(join(fixturesDir, fixtureName));
  const res = await request.put(`/api/uploads/${encodeURIComponent(fixtureName)}`, {
    data: body,
    headers: { "Content-Type": "application/octet-stream" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const json = (await res.json()) as { path: string };
  expect(json.path).toBeTruthy();
  return json.path;
}

async function putLegacyWorkspace(
  request: APIRequestContext,
  name: string,
  path: string,
): Promise<void> {
  const ws = {
    name,
    datasets: {
      train: {
        x: {
          kind: "csv",
          path,
          sep: ",",
          encoding: "utf-8",
          decimal: ".",
          header: 0,
          on_bad_lines: "error",
          keep_leading_zeros: true,
        },
        y: null,
        target_column: null,
      },
      test: null,
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };
  const res = await request.put(`/api/workspaces/${encodeURIComponent(name)}`, {
    data: ws,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function selectWorkspace(page: Page, name: string): Promise<void> {
  await page
    .locator(".ws-item")
    .filter({ has: page.locator(".ws-item-name", { hasText: new RegExp(`^${name}$`) }) })
    .click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * MAT-167 (1): legacy parquet-as-csv workspace quotes the engine error and
 * offers Re-inspect / Replace file (distinct from truly empty train).
 */
test("MAT-167: unreadable parquet train offers Re-inspect and quotes engine error", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const name = "mat167_legacy_parquet";
  await createWorkspace(page, name);
  const path = await uploadRaw(request, "events.parquet");
  await putLegacyWorkspace(request, name, path);

  await selectWorkspace(page, name);

  await expect(page.getByText(STORED_FAIL).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(EMPTY_MSG)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Re-inspect" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace file" })).toBeVisible();

  const benchBtn = page.getByRole("button", { name: "Open workbench" });
  await expect(benchBtn).toBeDisabled();

  await page.getByRole("button", { name: "Re-inspect" }).click();
  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList).toContainText(/parquet/, { timeout: 30_000 });
  await expect(page.locator('[data-train-parse-error="1"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByText(STORED_FAIL)).toHaveCount(0);
  await expect(benchBtn).toBeEnabled({ timeout: 30_000 });

  await benchBtn.click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: "user_id" })).toBeVisible({
    timeout: 30_000,
  });
});

/**
 * MAT-167 (2): group_agg Aggs preselects mean; clearing it highlights the field.
 */
test("MAT-167: group_agg Aggs defaults to mean and highlights when cleared", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );
  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "SET_WORKSPACE",
      workspace: {
        name: "mat167_group_agg",
        datasets: {
          train: {
            x: {
              kind: "csv",
              path: "/home/matleniz/wt-datatoolkit-web/fix-mat167/e2e/fixtures/churn_train.csv",
            },
          },
        },
        label: { mode: "order" },
        merges: [],
        variables: [],
        steps: [],
      },
    });
    d({ type: "SET_SCREEN", screen: "bench" });
  });
  await waitForGridReady(page);

  await page.locator(".grid-th", { hasText: "city" }).click();
  await page.getByRole("button", { name: "+ Step" }).click();
  await page.getByRole("button", { name: "Group aggregate" }).click();

  const editor = page.getByLabel("Step editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });

  const aggs = editor.locator('[data-ed-field="aggs"]');
  await expect(aggs).toBeVisible({ timeout: 15_000 });
  await expect(aggs.getByRole("button", { name: "mean" })).toHaveClass(/on/);
  await expect(aggs).not.toHaveAttribute("data-ed-missing", "1");

  // Pick value so only Aggs can be the missing required field after clear.
  const valueField = editor.locator('[data-ed-field="value"]');
  if (await valueField.count()) {
    const age = valueField.getByRole("button", { name: "age" });
    if (await age.count()) await age.click();
  }

  await aggs.getByRole("button", { name: "mean" }).click(); // toggle off
  await expect(aggs).toHaveAttribute("data-ed-missing", "1", { timeout: 10_000 });
  await expect(
    editor.locator('[data-ed-disabled-reason]'),
  ).toHaveText(/Pick at least one for Aggs/);
});

/**
 * MAT-167 (3): legacy employees.json-as-csv — Sources recovery via Re-inspect,
 * and workbench never hangs (shows engine error / empty state, or rows after fix).
 */
test("MAT-167: legacy employees-json recovers via Re-inspect and grid loads", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const name = "mat167_legacy_employees";
  await createWorkspace(page, name);
  const path = await uploadRaw(request, "employees.json");
  await putLegacyWorkspace(request, name, path);

  await selectWorkspace(page, name);
  await expect(page.getByText(STORED_FAIL).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Open workbench" })).toBeDisabled();

  await page.getByRole("button", { name: "Re-inspect" }).click();
  await expect(page.getByText(/record_path "employees"/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(STORED_FAIL)).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: "Open workbench" }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: "name" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".grid-row").first()).toBeVisible();
});

test("MAT-167: opening legacy employees-json in workbench shows error, never hangs", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );
  await page.evaluate((employeesPath) => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "SET_WORKSPACE",
      workspace: {
        name: "mat167_emp_bench",
        datasets: {
          train: {
            x: {
              kind: "csv",
              path: employeesPath,
              sep: ",",
              encoding: "utf-8",
              decimal: ".",
              header: 0,
              on_bad_lines: "error",
              keep_leading_zeros: true,
            },
          },
        },
        label: { mode: "order" },
        merges: [],
        variables: [],
        steps: [],
      },
    });
    d({ type: "SET_SCREEN", screen: "bench" });
  }, join(fixturesDir, "employees.json"));

  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Data grid")).toBeVisible({ timeout: 30_000 });
  // Must leave the loading state quickly (no 45s hang).
  await expect(
    page.locator(".grid-more", { hasText: /Loading rows/ }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".grid-inline-loading")).toHaveCount(0, {
    timeout: 15_000,
  });

  // Either the kind-mismatch banner or the empty-state copy — never silent hang.
  const banner = page.locator(".error-banner");
  const empty = page.getByLabel(EMPTY_DATA_ROWS_MSG);
  await expect
    .poll(
      async () =>
        (await banner.count()) > 0 || (await empty.count()) > 0,
      { timeout: 20_000 },
    )
    .toBe(true);
  if ((await banner.count()) > 0) {
    await expect(banner.first()).toContainText(STORED_FAIL);
  }
});

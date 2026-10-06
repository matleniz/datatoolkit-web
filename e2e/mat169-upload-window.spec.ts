import { expect, test } from "@playwright/test";
import { join } from "node:path";

import type { Workspace } from "../src/api/types";
import { fixturesDir, sourceFileInput, waitForGridReady } from "./helpers";

const EMPTY_MSG =
  /This train file has no columns \(empty or unreadable\)/;
const BAD_FIELDS = /5 fields,\s*expected 4|fields.*expected/i;

/**
 * MAT-169 (1): fresh upload of a CSV with one bad row must surface the engine
 * SourceError (not the empty-train copy), offer Options (on_bad_lines) /
 * Replace file, and open the workbench after on_bad_lines=skip.
 */
test("MAT-169: bad CSV row shows SourceError; on_bad_lines=skip opens workbench", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill("mat169_bad_csv");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Sources of “mat169_bad_csv”")).toBeVisible({
    timeout: 15_000,
  });

  const badPath = join(fixturesDir, "bad_csv_row.csv");
  await sourceFileInput(page).setInputFiles(badPath);

  const filesList = page.getByRole("region", { name: "Files list" });
  await expect(filesList.getByText("bad_csv_row.csv")).toBeVisible({
    timeout: 30_000,
  });

  const row = filesList.locator(".files-table-row", {
    hasText: "bad_csv_row.csv",
  });
  await row.getByRole("button", { name: /Train X/ }).click();
  await expect(
    row.getByRole("button", { name: /Train X/ }),
  ).toHaveAttribute("aria-pressed", "true");

  const parseBox = page.locator('[data-train-parse-error="1"]');
  await expect(parseBox).toBeVisible({ timeout: 30_000 });
  await expect(parseBox).toContainText(BAD_FIELDS);
  await expect(page.getByText(EMPTY_MSG)).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: "Options (on_bad_lines)" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace file" })).toBeVisible();

  const benchBtn = page.getByRole("button", { name: "Open workbench" });
  await expect(benchBtn).toBeDisabled();

  // Options opens on CSV upload; ensure on_bad_lines is reachable.
  await page.getByRole("button", { name: "Options (on_bad_lines)" }).click();
  const onBad = page.getByLabel("on_bad_lines");
  await expect(onBad).toBeVisible({ timeout: 10_000 });
  await onBad.selectOption("skip");

  await expect(parseBox).toHaveCount(0, { timeout: 60_000 });
  await expect(benchBtn).toBeEnabled({ timeout: 60_000 });

  await benchBtn.click();
  await expect(page.getByLabel("Workbench")).toBeVisible({ timeout: 30_000 });
  await waitForGridReady(page);
  await expect(page.locator(".grid-th", { hasText: "country" })).toBeVisible({
    timeout: 30_000,
  });
});

/**
 * MAT-169 (2): a 13-column file at 1440×900 must mount every header (no
 * column windowing below WIDE_COL_THRESHOLD).
 */
test("MAT-169: 13-column file at 1440x900 renders all headers", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const ws: Workspace = {
    name: "mat169_13cols",
    datasets: {
      train: {
        x: {
          kind: "csv",
          path: join(fixturesDir, "cleaning_data_practice.csv"),
        },
      },
    },
    label: { mode: "order" },
    merges: [],
    variables: [],
    steps: [],
  };

  await page.goto("/");
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.__DTK_DISPATCH__ === "function",
  );
  await page.evaluate((workspace) => {
    const d = window.__DTK_DISPATCH__!;
    d({ type: "SET_WORKSPACE", workspace });
    d({ type: "SET_SCREEN", screen: "bench" });
    d({ type: "CLEAR_SELECTION" });
  }, ws);
  await waitForGridReady(page);

  const grid = page.getByLabel("Data grid");
  await expect(grid).toHaveAttribute("data-col-window", "0:13/13", {
    timeout: 30_000,
  });
  await expect(page.locator(".grid-th")).toHaveCount(13);
  await expect(
    page.locator(".grid-th", { hasText: "$transaction_total" }),
  ).toBeVisible();
});

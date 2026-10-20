import { expect, test, type Page, type Route } from "@playwright/test";
import { join } from "node:path";
import { expectNoA11yViolations } from "./a11y";
import { fixturesDir, openWorkbench, sourceFileInput } from "./helpers";

/**
 * datatoolkit-issues#246 / #247: a failed load is always explained next to the
 * source, and a slow one shows a busy state (with Cancel) that goes away.
 */
const CSV = join(fixturesDir, "churn_train.csv");

async function newWorkspace(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "+ New workspace" }).click();
  await page.getByPlaceholder("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(`Sources of “${name}”`)).toBeVisible({ timeout: 15_000 });
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test("issue 246: engine 500 on the source preview is shown", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await newWorkspace(page, "e2e_246_500");
  await page.route(/\/api\/(source\/columns|workspace\/preview)$/, (r) =>
    json(r, 500, { type: "SourceError", message: "engine blew up (e2e)" }),
  );
  await sourceFileInput(page).setInputFiles(CSV);
  await expect(page.getByText(/engine blew up \(e2e\)/).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => errors.some((e) => e.includes("[engine]"))).toBe(true);
  await expectNoA11yViolations(page, "source load error (#246)");
});

test("issue 246: malformed JSON on the source preview is shown", async ({ page }) => {
  test.setTimeout(90_000);
  await newWorkspace(page, "e2e_246_json");
  await page.route(/\/api\/source\/columns$/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "{not json" }),
  );
  await sourceFileInput(page).setInputFiles(CSV);
  await expect(page.getByText(/not JSON/).first()).toBeVisible({ timeout: 30_000 });
});

test("issue 247: a slow load shows a busy state, then it goes", async ({ page }) => {
  test.setTimeout(90_000);
  await newWorkspace(page, "e2e_247_slow");
  await page.route(/\/api\/uploads\//, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await sourceFileInput(page).setInputFiles(CSV);
  const busy = page.locator('[data-busy="source"]');
  await expect(busy).toBeVisible({ timeout: 10_000 });
  await expect(busy).toContainText("Loading the dataset");
  await expect(page.locator("main.sources-main")).toHaveAttribute("aria-busy", "true");
  await expectNoA11yViolations(page, "source busy state (#247)");
  await expect(busy).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("main.sources-main")).toHaveAttribute("aria-busy", "false");
});

test("issue 247: Cancel aborts a slow load and says so", async ({ page }) => {
  test.setTimeout(90_000);
  await newWorkspace(page, "e2e_247_cancel");
  await page.route(/\/api\/uploads\//, () => {
    /* never answers */
  });
  await sourceFileInput(page).setInputFiles(CSV);
  const busy = page.locator('[data-busy="source"]');
  await expect(busy).toBeVisible({ timeout: 10_000 });
  await busy.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Load cancelled/).first()).toBeVisible();
  await expect(busy).toHaveCount(0);
});

test("issue 247: a slow step run shows the busy state on the step list and the grid", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await page.route(/\/api\/workspace\/(rows|profiles)$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: { op: "drop_columns", target: "both", params: { columns: ["signup_date"] } },
    }),
  );
  const busy = page.locator('[data-busy="frame"]');
  await expect(busy.first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("section.pipeline-bar")).toHaveAttribute("aria-busy", "true");
  await expectNoA11yViolations(page, "workbench busy state (#247)");
  await expect(busy).toHaveCount(0, { timeout: 30_000 });
});

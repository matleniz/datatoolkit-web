import { expect, test, type Page } from "@playwright/test";
import { clearFlowScreenshots, openWorkbench, waitForGridReady } from "./helpers";

const steps = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.()?.workspace?.steps ?? []);

const viewVersion = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.()?.viewVersion);

/** `age` of customer C006 (missing in the source) at the latest version. */
const c006Age = (page: Page) =>
  page.evaluate(async () => {
    const ws = window.__DTK_STATE__!()!.workspace!;
    const res = await fetch("/api/workspace/rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: {
          name: ws.name,
          datasets: ws.datasets,
          label: ws.label,
          merges: ws.merges,
          variables: ws.variables,
          steps: ws.steps.map(({ op, params, target }) => ({ op, params, target })),
        },
        role: "train",
        version: null,
        offset: 0,
        limit: 50,
      }),
    });
    const payload = (await res.json()) as {
      rows: Array<{ customer_id: string; age: unknown }>;
    };
    return payload.rows.find((r) => r.customer_id === "C006")?.age;
  });

/**
 * datatoolkit-issues#10: right-click a pipeline node → Edit step opens the
 * editor pre-filled; Apply replaces the step at its index (later steps kept)
 * and replays; the edit is undoable; Discard changes nothing.
 */
test("issue 10: edit an applied step from the pipeline", async ({ page }) => {
  test.setTimeout(180_000);
  clearFlowScreenshots("issue10-edit-step");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, true);

  await page.evaluate(() => {
    const d = window.__DTK_DISPATCH__!;
    d({
      type: "ADD_STEP",
      step: {
        op: "impute",
        target: "both",
        params: { columns: ["age"], strategy: "median", add_indicator: false },
      },
    });
    d({
      type: "ADD_STEP",
      step: { op: "scale", target: "both", params: { columns: ["monthly_spend"] } },
    });
  });
  const imputeNode = page.locator(".pipeline-node", { hasText: "Impute" });
  await expect(page.locator(".pipeline-node", { hasText: "Scale" })).toHaveCount(1);
  await waitForGridReady(page);
  const medianAge = await c006Age(page);
  expect(typeof medianAge).toBe("number");

  // Context menu → Edit step: pre-filled, view pinned to the step's input.
  await imputeNode.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Step menu" });
  await expect(menu).toContainText("v1 · ");
  await menu.getByRole("menuitem", { name: "Edit step" }).click();
  const editor = page.getByLabel("Step editor");
  await expect(editor.locator("[data-ed-edit-index]")).toHaveText(/Edit step v1/);
  await expect(editor.getByRole("button", { name: "median", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(editor.getByRole("button", { name: "Columns: age" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(editor.getByRole("button", { name: "Train + test" })).toHaveClass(/\bon\b/);
  await expect(page.locator("[data-edit-banner]")).toContainText("v1 · impute");
  expect(await viewVersion(page)).toBe(0);
  // Unchanged: Apply waits for a real edit; no pipeline edit buttons meanwhile.
  await expect(editor.getByRole("button", { name: "Apply step" })).toBeDisabled();
  await expect(editor).toContainText("No change yet");
  await expect(page.getByRole("button", { name: "Edit this step" })).toHaveCount(0);

  // Edit: constant 0, previewed against the steps before it, then Apply.
  await editor.getByRole("button", { name: "constant", exact: true }).click();
  await editor.locator('[data-ed-field="fill_value"]').getByRole("textbox").fill("0");
  await expect(
    page.getByRole("status").filter({ hasText: /Live preview/i }),
  ).toBeVisible({ timeout: 30_000 });
  const apply = editor.getByRole("button", { name: "Apply step" });
  await expect(apply).toBeEnabled({ timeout: 30_000 });
  await apply.click();
  await expect(editor).toHaveCount(0);

  await expect.poll(async () => (await steps(page)).map((s) => s.op)).toEqual([
    "impute",
    "scale",
  ]);
  const after = await steps(page);
  expect(after[0]!.params).toEqual({
    columns: ["age"],
    strategy: "constant",
    fill_value: 0,
    add_indicator: false,
  });
  expect(after[1]!.params).toEqual({ columns: ["monthly_spend"] });
  expect(await viewVersion(page)).toBeNull();
  await expect.poll(() => c006Age(page)).toBe(0);

  // The edit is one undoable change.
  await page.getByRole("button", { name: "Undo pipeline change" }).click();
  await expect.poll(async () => (await steps(page))[0]!.params.strategy).toBe("median");
  await expect.poll(() => c006Age(page)).toBe(medianAge);
  await page.getByRole("button", { name: "Redo pipeline change" }).click();
  await expect.poll(async () => (await steps(page))[0]!.params.strategy).toBe("constant");

  // Pencil → Discard: nothing changes, back to the latest version.
  await page
    .locator(".pipeline-node-rel", { has: page.locator(".pipeline-title", { hasText: /^Scale/ }) })
    .getByRole("button", { name: "Edit this step" })
    .click();
  await expect(editor.locator("[data-ed-edit-index]")).toHaveText(/Edit step v2/);
  expect(await viewVersion(page)).toBe(1);
  const before = await steps(page);
  await editor.getByRole("button", { name: "Discard" }).click();
  await expect(editor).toHaveCount(0);
  expect(await steps(page)).toEqual(before);
  expect(await viewVersion(page)).toBeNull();
});

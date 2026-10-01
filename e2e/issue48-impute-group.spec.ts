import { expect, test } from "@playwright/test";
import {
  clearFlowScreenshots,
  openWorkspaceBench,
  patientsVisitsWorkspace,
  waitForGridReady,
} from "./helpers";

/**
 * datatoolkit-issues#48: the editor honours the schema's `x-dtk-when` (shown
 * params follow the strategy) and prefills the `x-dtk-semantic` param `by`
 * with the frame's only `group_id` column.
 */
test.describe("issue #48 impute group strategies", () => {
  test("group_interp shows by (prefilled) + order, then fills per patient", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    clearFlowScreenshots("issue48-impute-group");
    await page.setViewportSize({ width: 1440, height: 900 });

    await openWorkspaceBench(page, patientsVisitsWorkspace(), "bmi");
    await page.getByRole("button", { name: /^bmi, / }).click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Impute/ }).click();

    const editor = page.getByLabel("Step editor");
    const field = (key: string) => editor.locator(`[data-ed-field="${key}"]`);
    await expect(editor.getByText("Strategy", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Default median: none of the conditional params.
    for (const key of ["fill_value", "by", "order", "fallback"]) {
      await expect(field(key)).toHaveCount(0);
    }
    await expect(editor.locator("[data-formula-editor]")).toHaveCount(0);

    // formula → expr only.
    await editor.getByRole("button", { name: "formula", exact: true }).click();
    await expect(editor.locator("[data-formula-editor]")).toBeVisible();
    await expect(field("by")).toHaveCount(0);
    await expect(field("fill_value")).toHaveCount(0);

    // group_interp → by (prefilled from the group_id column) + order + fallback.
    await editor
      .getByRole("button", { name: "group_interp", exact: true })
      .click();
    await expect(editor.locator("[data-formula-editor]")).toHaveCount(0);
    await expect(field("fill_value")).toHaveCount(0);
    await expect(field("fallback")).toBeVisible();
    await expect(
      field("by").getByRole("button", { name: "By: patient_id" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(field("order")).toBeVisible();
    await field("order").getByRole("button", { name: "Order: visit" }).click();

    const apply = editor.getByRole("button", { name: "Apply step" });
    await expect(apply).toBeEnabled({ timeout: 30_000 });
    await apply.click();
    await expect(page.getByLabel("Step editor")).toHaveCount(0, {
      timeout: 60_000,
    });
    await expect(
      page.locator(".pipeline-node", { hasText: "Impute" }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await waitForGridReady(page);

    const step = await page.evaluate(() => {
      const steps = window.__DTK_STATE__?.()?.workspace?.steps ?? [];
      return steps[steps.length - 1] ?? null;
    });
    // Hidden params are not sent.
    expect(step?.params).toEqual({
      columns: ["bmi"],
      strategy: "group_interp",
      by: "patient_id",
      order: "visit",
      add_indicator: false,
    });

    const filled = await page.evaluate(async () => {
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
          limit: 500,
        }),
      });
      const payload = (await res.json()) as {
        rows: Array<{ patient_id: string; visit: number; bmi: number | null }>;
      };
      return {
        nulls: payload.rows.filter((r) => r.bmi === null).length,
        // P004 misses visit 2: midway between 24.5 (visit 1) and 25.5 (visit 3).
        p004: payload.rows.find((r) => r.patient_id === "P004" && r.visit === 2)?.bmi,
      };
    });
    expect(filled).toEqual({ nulls: 0, p004: 25 });
  });
});

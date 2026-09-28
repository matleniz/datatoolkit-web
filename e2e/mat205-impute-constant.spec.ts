import { expect, test } from "@playwright/test";
import {
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

/**
 * MAT-205: impute strategy=constant on a numeric column must send a real
 * number (not a numeric string). Engine rejects `string fill on numeric column`.
 */
test.describe("MAT-205 impute numeric constant", () => {
  test("constant 0 on age lands as a number in params and grid cells", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    clearFlowScreenshots("mat205-impute-constant");
    await page.setViewportSize({ width: 1440, height: 900 });

    await openWorkbench(page, true);
    await waitForGridReady(page);

    const ageHeader = page.getByRole("button", { name: "age, number" });
    await ageHeader.click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Column menu" })).toBeVisible();
    await page.getByRole("menuitem", { name: /^Impute/ }).click();

    const editor = page.getByLabel("Step editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByText("Strategy", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await editor.getByRole("button", { name: "constant", exact: true }).click();
    const fillField = editor.locator('[data-ed-field="fill_value"]');
    await expect(fillField).toBeVisible();
    await expect(fillField).toHaveAttribute("data-ed-fill-numeric", "1");

    const fillInput = fillField.getByRole("textbox", {
      name: /Constant value|Fill Value/i,
    });
    await fillInput.fill("0");

    // Live preview must succeed (string "0" would error on numeric age).
    await expect(
      page.getByRole("status").filter({ hasText: /Live preview/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ed-learned")).toContainText(/age/i, {
      timeout: 20_000,
    });

    const apply = page
      .getByRole("status")
      .filter({ hasText: /Live preview/i })
      .getByRole("button", { name: "Apply step" });
    await expect(apply).toBeEnabled({ timeout: 30_000 });
    await apply.click();

    await expect(page.getByLabel("Step editor")).toHaveCount(0, {
      timeout: 60_000,
    });
    const imputeNode = page
      .locator(".pipeline-node", { hasText: "Impute" })
      .first();
    await expect(imputeNode).toBeVisible({ timeout: 20_000 });
    await waitForGridReady(page);

    // Step params: fill_value must be a JSON number, not "0".
    const fillType = await page.evaluate(() => {
      const steps = window.__DTK_STATE__?.()?.workspace?.steps ?? [];
      const last = steps[steps.length - 1];
      if (!last || last.op !== "impute") return null;
      const fv = last.params.fill_value;
      return { type: typeof fv, value: fv };
    });
    expect(fillType).toEqual({ type: "number", value: 0 });

    // Grid / engine rows: previously-missing age cells are numeric 0.
    const cellCheck = await page.evaluate(async () => {
      const ws = window.__DTK_STATE__?.()?.workspace;
      if (!ws) return { ok: false, reason: "no workspace" };
      // Mirror sanitizeWorkspace (strip charts + Step.align).
      const clean = {
        name: ws.name,
        datasets: ws.datasets,
        label: ws.label,
        merges: ws.merges,
        variables: ws.variables,
        steps: ws.steps.map(({ op, params, target }) => ({
          op,
          params,
          target,
        })),
      };
      const res = await fetch("/api/workspace/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: clean,
          role: "train",
          version: null,
          offset: 0,
          limit: 50,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, reason: `rows ${res.status}: ${body.slice(0, 300)}` };
      }
      const payload = (await res.json()) as {
        rows: Array<Record<string, unknown>>;
      };
      const ages = payload.rows.map((r) => r.age);
      const zeros = ages.filter((v) => v === 0);
      const stringZeros = ages.filter((v) => v === "0");
      const nulls = ages.filter((v) => v === null || v === undefined);
      return {
        ok: true,
        zeroCount: zeros.length,
        stringZeroCount: stringZeros.length,
        nullCount: nulls.length,
        sampleTypes: ages.slice(0, 8).map((v) => typeof v),
        sampleAges: ages.slice(0, 8),
      };
    });
    expect(cellCheck, JSON.stringify(cellCheck)).toMatchObject({ ok: true });
    expect(cellCheck.stringZeroCount).toBe(0);
    expect(cellCheck.nullCount).toBe(0);
    // churn_train has at least one missing age (C006) → filled with 0.
    expect(cellCheck.zeroCount).toBeGreaterThanOrEqual(1);
    expect(cellCheck.sampleTypes?.every((t) => t === "number")).toBe(true);
  });
});

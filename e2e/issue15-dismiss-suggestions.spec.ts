import { expect, test, type Page } from "@playwright/test";
import { openWorkbench } from "./helpers";

const sugCount = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.()?.sugCount ?? -1);

/** Wait until the cards were computed for the viewed version `version`. */
async function waitForSuggestionsAt(page: Page, version: number) {
  const ident = page.locator(".sug-identity");
  await expect(ident).toHaveAttribute("data-identity-version", String(version));
  await expect
    .poll(
      () =>
        ident.evaluate(
          (e) =>
            e.getAttribute("data-identity") ===
            e.getAttribute("data-identity-current"),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(page.locator("[data-sug-rechecking]")).toHaveCount(0);
}

/**
 * datatoolkit-issues#15: a suggestion can be dismissed. Browser-local, per
 * workspace; the id comes from (key, suggested params, finding), so the same
 * finding stays hidden after an unrelated step and after a reload; a
 * "Show dismissed" toggle lists it again with a Restore action.
 */
test("issue 15: dismiss / restore a suggestion", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await waitForSuggestionsAt(page, 0);

  const card = page.locator(".sug-card", { hasText: "age: impute" });
  await expect(card).toHaveCount(1);
  const dismissId = (await card.getAttribute("data-sug-dismiss-id"))!;
  expect(dismissId).toBeTruthy();
  const byId = page.locator(`.sug-card[data-sug-dismiss-id="${dismissId}"]`);
  const before = await sugCount(page);
  const toggle = page.getByLabel(/Show dismissed/);
  await expect(toggle).toHaveCount(0);

  // Dismiss: hidden, badge down by one, toggle offered.
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(byId).toHaveCount(0);
  await expect.poll(() => sugCount(page)).toBe(before - 1);
  await expect(page.getByText("Show dismissed (1)")).toBeVisible();

  // An unrelated step (its position in the list shifts): still hidden.
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: {
        op: "drop_columns",
        target: "both",
        params: { columns: ["signup_date"] },
      },
    }),
  );
  await waitForSuggestionsAt(page, 1);
  await expect(byId).toHaveCount(0);
  await expect(page.getByText("Show dismissed (1)")).toBeVisible();

  // Survives a reload (browser storage, per workspace).
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForSuggestionsAt(page, 1);
  await expect(byId).toHaveCount(0);
  const stored = await page.evaluate(() =>
    localStorage.getItem("dtk.dismissedSuggestions.churn"),
  );
  expect(JSON.parse(stored ?? "[]")).toEqual([dismissId]);

  // Show dismissed: listed, flagged, no apply action; Restore brings it back.
  await toggle.check();
  await expect(byId).toHaveAttribute("data-sug-dismissed", "1");
  await expect(byId.getByRole("button", { name: /Open/ })).toHaveCount(0);
  await byId.getByRole("button", { name: "Restore" }).click();
  await expect(byId).not.toHaveAttribute("data-sug-dismissed", "1");
  await expect(byId.getByRole("button", { name: "Open in editor →" })).toBeVisible();
  // Unticking hides the toggle itself (nothing dismissed any more).
  await toggle.click();
  await expect(toggle).toHaveCount(0);
  await expect(byId).toHaveCount(1);
});

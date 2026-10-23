import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
  openWorkspaceBench,
  waitForGridReady,
} from "./helpers";

/** Profile request bodies (`sample_rows` or null) seen by the page. */
function recordProfileRequests(page: import("@playwright/test").Page): (number | null)[] {
  const seen: (number | null)[] = [];
  page.on("request", (req) => {
    if (!req.url().endsWith("/workspace/profiles")) return;
    const body = JSON.parse(req.postData() ?? "{}") as { sample_rows?: number };
    seen.push(body.sample_rows ?? null);
  });
  return seen;
}

/**
 * datatoolkit-issues#318 — the quality bars use the engine's sample_rows
 * profile on large files and say so; small files keep the full profile.
 */
test.describe("issue 318 sampled profile", () => {
  test("a 250k-row CSV is profiled on a sample and the grid discloses it", async ({ page }) => {
    test.setTimeout(240_000);
    clearFlowScreenshots("318-sampled-profile");
    const path = join(mkdtempSync(join(tmpdir(), "dtk-318-")), "orders_250k.csv");
    const rows = ["order_id,city,plan,amount,qty"];
    const cities = ["Paris", "Lyon", "Lille", "Nice"];
    for (let i = 1; i <= 250_000; i++) {
      const amount = i % 10 === 0 ? "" : ((i * 37) % 1000) / 10;
      rows.push(`${i},${cities[i % 4]},${i % 3 ? "pro" : "basic"},${amount},${i % 7}`);
    }
    writeFileSync(path, `${rows.join("\n")}\n`);

    const requests = recordProfileRequests(page);
    await openWorkspaceBench(
      page,
      {
        name: "orders-250k",
        datasets: { train: { x: { kind: "csv", path } } },
        label: { mode: "order" },
        merges: [],
        variables: [],
        groups: [],
        steps: [],
      },
      "amount",
    );

    const banner = page.locator("[data-profile-sample]");
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText("150,000 not profiled");
    await expect(banner).toContainText("100,000 of 250,000 rows");
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r === 100_000)).toBe(true);
    // The quality bar of a column with 10% missing is filled from the sample.
    const amount = page.locator(".grid-th", { hasText: "amount" }).first();
    await expect(amount.locator(".miss-bar")).toHaveAttribute("title", /Missing 10%/);
    await captureFlowScreenshot(page, "318-sampled-profile", "01-large-sampled.png");
  });

  test("a small CSV keeps the full profile and no sample notice", async ({ page }) => {
    test.setTimeout(180_000);
    const requests = recordProfileRequests(page);
    await openWorkbench(page, true);
    await waitForGridReady(page);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r === null)).toBe(true);
    await expect(page.locator("[data-profile-sample]")).toHaveCount(0);
    await captureFlowScreenshot(page, "318-sampled-profile", "02-small-full.png");
  });
});

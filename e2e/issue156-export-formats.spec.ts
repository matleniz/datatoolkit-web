import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#156 — format picker in the Export panel: the picked
 * formats go to `POST /workspaces/{name}/export` and the files land on disk
 * (notebook with the step notes, script, CSV); parquet stays the default.
 */
test("issue 156: export as CSV + notebook + script from the format picker", async ({ page }) => {
  test.setTimeout(120_000);
  await openWorkbench(page, true);
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({
      type: "ADD_STEP",
      step: {
        op: "impute", target: "both", params: { columns: ["age"], strategy: "median" },
        note: "median: age is skewed",
      },
    }),
  );
  await waitForGridReady(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const panel = page.getByLabel("Export", { exact: true });
  const formats = panel.getByRole("group", { name: "Formats" });
  await expect(formats.getByRole("checkbox", { name: "Parquet" })).toBeChecked();
  await expect(panel.getByRole("button", { name: "Export parquet + manifest" })).toBeVisible();

  // No format = nothing to export.
  await formats.getByRole("checkbox", { name: "Parquet" }).uncheck();
  await expect(panel.getByRole("button", { name: "Pick a format" })).toBeDisabled();

  for (const name of ["CSV", "Notebook (.ipynb)", "Python script (.py)"]) {
    await formats.getByRole("checkbox", { name }).check();
  }
  const outDir = join(tmpdir(), `dtk-e2e-export-formats-${Date.now()}`);
  try {
    await page.getByLabel("Output directory").fill(outDir);
    await panel.getByRole("button", { name: "Export CSV + notebook + script + manifest" }).click();
    const manifest = page.getByLabel("Export manifest");
    await expect(manifest).toBeVisible({ timeout: 60_000 });
    await expect(manifest).toContainText("notebook: code/pipeline.ipynb");
    await expect(manifest).toContainText("script: code/pipeline.py");

    expect(existsSync(join(outDir, "processed", "train.csv"))).toBe(true);
    expect(existsSync(join(outDir, "processed", "test.csv"))).toBe(true);
    expect(existsSync(join(outDir, "processed", "train.parquet"))).toBe(false);
    const nb = JSON.parse(readFileSync(join(outDir, "code", "pipeline.ipynb"), "utf8")) as {
      cells: { source: string | string[] }[];
    };
    const text = nb.cells.map((c) => (Array.isArray(c.source) ? c.source.join("") : c.source)).join("\n");
    expect(text).toContain("median: age is skewed");
    expect(readFileSync(join(outDir, "code", "pipeline.py"), "utf8")).toContain("impute");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

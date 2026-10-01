import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureFlowScreenshot,
  clearFlowScreenshots,
  openWorkbench,
  waitForGridReady,
} from "./helpers";

test("Flow 6: export (manifest shown, files exist on disk)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  clearFlowScreenshots("6-export");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open workbench
  await openWorkbench(page, true);

  // 2. Open Export panel
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportPanel = page.getByLabel("Export", { exact: true });
  await expect(exportPanel).toBeVisible();

  // Verify workspace JSON is rendered
  await expect(page.locator(".export-code")).toContainText('"name": "churn"');

  // 3. Set output directory
  const outDir = join(tmpdir(), `dtk-e2e-export-${Date.now()}`);
  try {
    const outDirInput = page.getByLabel("Output directory");
    await outDirInput.fill(outDir);

    // 4. Run export
    await page.getByRole("button", { name: "Export parquet + manifest" }).click();

    // (b) Assert manifest is displayed in the Export panel
    const manifestRegion = page.locator('[aria-label="Export manifest"]');
    await expect(manifestRegion).toBeVisible({ timeout: 30_000 });

    const manifestJsonText = await manifestRegion
      .locator(".export-manifest-json")
      .innerText();
    expect(manifestJsonText).toContain("outputs");
    expect(manifestJsonText).toContain("manifest_version");

    // FX-B shows out_dir (input) plus engine export paths under that directory:
    // processed/train.parquet, processed/test.parquet (manifest.outputs), and
    // manifest.json (see dtk_engine/workspace/export.py).
    await expect(outDirInput).toHaveValue(outDir);
    const manifestPanelText = await manifestRegion.innerText();
    expect(manifestPanelText).toContain("processed/train.parquet");
    expect(manifestPanelText).toContain("processed/test.parquet");
    const exportPanelText = await exportPanel.innerText();
    expect(exportPanelText).toContain("manifest.json");

    // (b) Assert files exist on disk
    const manifestFile = join(outDir, "manifest.json");
    const trainParquet = join(outDir, "processed", "train.parquet");
    const testParquet = join(outDir, "processed", "test.parquet");

    expect(existsSync(manifestFile), "manifest.json exists").toBe(true);
    expect(existsSync(trainParquet), "train.parquet exists").toBe(true);
    expect(existsSync(testParquet), "test.parquet exists").toBe(true);

    // Verify manifest JSON on disk
    const diskManifest = JSON.parse(readFileSync(manifestFile, "utf-8"));
    expect(diskManifest).toHaveProperty("outputs");
    expect(diskManifest.workspace).toBe("churn");

    // Capture screenshot with the manifest clearly visible
    await waitForGridReady(page);
    await captureFlowScreenshot(page, "6-export", "01-export-manifest.png");
  } finally {
    if (process.env.DTK_E2E_KEEP !== "1") {
      rmSync(outDir, { recursive: true, force: true });
    }
  }
});

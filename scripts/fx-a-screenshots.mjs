/**
 * FX-A screenshot helper: Sources screen for churn + parkinson at 1440×900.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../docs/screenshots/fx-a");
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.getByLabel("Sources screen").waitFor({ timeout: 30_000 });

  // --- churn ---
  await page.getByRole("button", { name: /churn/i }).first().click();
  await page.locator(".sources-title").filter({ hasText: "churn" }).waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: join(OUT, "sources-churn.png"),
    fullPage: false,
  });
  console.log("wrote sources-churn.png");
  const churnFiles = await page
    .getByLabel("Files list")
    .locator(".file-name")
    .allTextContents();
  console.log("churn files:", churnFiles);

  // --- parkinson ---
  await page.getByRole("button", { name: /parkinson/i }).first().click();
  await page.locator(".sources-title").filter({ hasText: "parkinson" }).waitFor();
  // Wait until churn files are gone and Parkinson files (or enrich) appear
  await page.waitForFunction(
    () => {
      const names = [...document.querySelectorAll(".file-name")].map(
        (el) => el.textContent || "",
      );
      if (names.some((n) => /churn/i.test(n))) return false;
      const detected = [...document.querySelectorAll(".file-detected")].map(
        (el) => el.textContent || "",
      );
      return (
        names.length > 0 &&
        detected.some((t) => /55603|header 0/.test(t))
      );
    },
    { timeout: 90_000 },
  );
  await page.waitForTimeout(800);

  const parkFiles = await page
    .getByLabel("Files list")
    .locator(".file-name")
    .allTextContents();
  const detected = await page
    .getByLabel("Files list")
    .locator(".file-detected")
    .allTextContents();
  const chips = await page
    .getByLabel("Result schema")
    .locator(".res-col-chip")
    .allTextContents();
  console.log("parkinson files:", parkFiles);
  console.log("detected:", detected);
  console.log("result chips:", chips);

  await page.screenshot({
    path: join(OUT, "sources-parkinson.png"),
    fullPage: false,
  });
  console.log("wrote sources-parkinson.png");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

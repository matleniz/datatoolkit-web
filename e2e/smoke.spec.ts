import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const smokeDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "screenshots/smoke",
);
const docsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../docs/screenshots/w0-scaffold",
);

test("shell smoke — loads header and captures screenshot", async ({
  page,
}) => {
  mkdirSync(smokeDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });

  await page.goto("/");
  // Bootstrap may show loading then the shell (or an engine warning).
  await expect(page.getByLabel("datatoolkit Studio")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("navigation", { name: "Screens" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sources/ })).toBeVisible();

  await page.getByRole("button", { name: /Workbench/ }).click();
  await expect(page.getByLabel("Workbench")).toBeVisible();
  await expect(page.getByLabel("Pipeline")).toBeVisible();
  await expect(
    page.getByLabel("Variables, suggestions and recipe"),
  ).toBeVisible();
  // Inspector or step editor
  await expect(
    page.getByLabel("Inspector").or(page.getByLabel("Step editor")),
  ).toBeVisible();
  await expect(page.getByLabel("Analysis tools")).toBeVisible();

  const smokePath = join(smokeDir, "shell.png");
  const docsPath = join(docsDir, "shell.png");
  await page.screenshot({ path: smokePath, fullPage: true });
  await page.screenshot({ path: docsPath, fullPage: true });
});

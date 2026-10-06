import { expect, test, type Page } from "@playwright/test";
import { openWorkbench, waitForGridReady } from "./helpers";

/** datatoolkit-issues#182 — the column menu stays inside a small window. */
test.use({ viewport: { width: 1024, height: 600 } });

async function expectMenuInside(page: Page) {
  const menu = page.getByRole("menu", { name: "Column menu" });
  await expect(menu).toBeVisible();
  // Placement runs in a layout effect; poll until the box is inside.
  await expect
    .poll(async () => {
      const b = (await menu.boundingBox())!;
      const vp = page.viewportSize()!;
      return b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
    })
    .toBe(true);
}

test("issue 182: column menu fits the viewport at the right and bottom edges", async ({ page }) => {
  await openWorkbench(page, true);
  await waitForGridReady(page);

  // A header right-clicked at the window's right edge (pointer coordinates).
  await page
    .getByRole("button", { name: "age, number" })
    .evaluate((el) =>
      el.dispatchEvent(
        new MouseEvent("contextmenu", { clientX: 1020, clientY: 300, bubbles: true, cancelable: true }),
      ),
    );
  await expectMenuInside(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Column menu" })).toHaveCount(0);

  // Cells have no menu: open it at the bottom-right corner through the store.
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "OPEN_CTX", col: "age", x: 900, y: 590 }),
  );
  await expectMenuInside(page);
});

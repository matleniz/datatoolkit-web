/**
 * datatoolkit-issues#161 — drag a grid header to reorder columns: creates a
 * `reorder_columns` step, consecutive drags fold into it, the order survives a
 * reload and the test split gets the same order.
 */
import { expect, test, type Page } from "@playwright/test";

import {
  adultAlignWorkspace,
  parkinsonLikeWorkspace,
  openWorkspaceBench,
  waitForGridReady,
} from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

const order = (page: Page) =>
  page.locator(".grid-th .th-name").allTextContents();
const steps = (page: Page) =>
  page.evaluate(() => window.__DTK_STATE__?.().workspace?.steps ?? []);

async function drag(
  page: Page,
  col: string,
  onto: string,
  side: "before" | "after",
) {
  const th = (name: string) =>
    page.locator(".grid-th").filter({
      has: page.locator(".th-name", { hasText: new RegExp(`^${name}$`) }),
    });
  const src = th(col).first();
  const dst = th(onto).first();
  const box = (await dst.boundingBox())!;
  await src.dragTo(dst, {
    targetPosition: { x: side === "before" ? 6 : box.width - 6, y: 40 },
  });
  await waitForGridReady(page);
}

test("#161: header drag creates, folds and persists a reorder_columns step", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, adultAlignWorkspace(), "age");
  expect(await order(page)).toEqual([
    "age",
    "workclass",
    "education",
    "income",
  ]);

  // 1. One drag = one step.
  await drag(page, "income", "age", "before");
  await expect
    .poll(() => order(page))
    .toEqual(["income", "age", "workclass", "education"]);
  let s = await steps(page);
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({
    op: "reorder_columns",
    target: "both",
    params: { columns: ["income"], position: "first", missing_ok: true },
  });

  // 2. A second drag folds into the same step.
  await drag(page, "income", "age", "after");
  await expect
    .poll(() => order(page))
    .toEqual(["age", "income", "workclass", "education"]);
  s = await steps(page);
  expect(s).toHaveLength(1);
  expect(s[0]!.params).toEqual({
    columns: ["income"],
    position: "after",
    anchor: "age",
    missing_ok: true,
  });

  // 3. Dragging back to the original order removes the step.
  await drag(page, "income", "education", "after");
  await expect
    .poll(() => order(page))
    .toEqual(["age", "workclass", "education", "income"]);
  expect(await steps(page)).toHaveLength(0);

  // 4. A move that no single step expresses piles a second step.
  await drag(page, "income", "age", "before");
  await expect
    .poll(() => order(page))
    .toEqual(["income", "age", "workclass", "education"]);
  await drag(page, "education", "workclass", "before");
  await expect
    .poll(() => order(page))
    .toEqual(["income", "age", "education", "workclass"]);
  expect(await steps(page)).toHaveLength(2);
  await drag(page, "income", "workclass", "after");
  await expect
    .poll(() => order(page))
    .toEqual(["age", "education", "workclass", "income"]);
  expect(await steps(page)).toHaveLength(2); // folded into the last step only
  const final = ["age", "education", "workclass", "income"];

  // 5. Same order on the test split.
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_ROLE", role: "test" }),
  );
  await waitForGridReady(page);
  await expect.poll(() => order(page)).toEqual(final);
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_ROLE", role: "train" }),
  );
  await waitForGridReady(page);

  // 6. Reload keeps the order.
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Workbench/ }).click();
  await waitForGridReady(page);
  await expect.poll(() => order(page)).toEqual(final);
  expect(await steps(page)).toHaveLength(2);
});

test("#161: header drag is ignored on an older version", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, adultAlignWorkspace(), "age");
  await drag(page, "income", "age", "before");
  await expect.poll(() => steps(page).then((s) => s.length)).toBe(1);
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_VIEW_VERSION", version: 0 }),
  );
  await waitForGridReady(page);
  await expect(page.locator(".grid-th").first()).toHaveAttribute(
    "draggable",
    "false",
  );
  await drag(page, "income", "age", "before");
  expect(await steps(page)).toHaveLength(1);
});

test("#177: dragging the label column replays on train and test", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, parkinsonLikeWorkspace(), "patient_id");
  const cols = await order(page);
  // The y file's label lands last, and the test split has no such column.
  expect(cols.at(-1)).toBe("target");
  const rest = cols.filter((c) => c !== "target");
  const before = rest.at(-2)!;

  // One drag = one step that tolerates the split without the target.
  await drag(page, "target", before, "before");
  await expect
    .poll(() => order(page).then((o) => o.indexOf("target")))
    .toBe(cols.length - 3);
  const s = await steps(page);
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({
    op: "reorder_columns",
    target: "both",
    params: { columns: ["target"], missing_ok: true },
  });
  expect(
    await page.evaluate(() => window.__DTK_STATE__?.().benchError),
  ).toBeNull();

  // The test frame has no target: the step still replays.
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_ROLE", role: "test" }),
  );
  await waitForGridReady(page);
  expect(await order(page)).toEqual(rest);
  expect(
    await page.evaluate(() => window.__DTK_STATE__?.().benchError),
  ).toBeNull();
  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_ROLE", role: "train" }),
  );
  await waitForGridReady(page);

  // A second drag folds into the same step and stays replayable.
  await drag(page, "target", rest.at(-3)!, "before");
  await expect
    .poll(() => order(page).then((o) => o.indexOf("target")))
    .toBe(cols.length - 4);
  const folded = await steps(page);
  expect(folded).toHaveLength(1);
  expect(folded[0]!.params).toMatchObject({
    columns: ["target"],
    missing_ok: true,
  });
});

/**
 * datatoolkit-issues#91 — agent command `set_grid_view`: commands go straight
 * to the engine's `POST /api/ui/commands`; the grid view changes, the pipeline
 * and the data identity do not, and Undo restores the previous view.
 */
import { expect, test, type Page } from "@playwright/test";

import { openWorkspaceBench, titanicWorkspace } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

const session = (page: Page) =>
  page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);

test("#91: set_grid_view filters / sorts the grid view only; Undo restores it", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await openWorkspaceBench(page, titanicWorkspace(), "Age");
  const grid = page.getByLabel("Data grid");
  const identity = await grid.getAttribute("data-identity");
  const steps = () =>
    page.evaluate(() => JSON.stringify(window.__DTK_STATE__?.().workspace?.steps));
  const steps0 = await steps();
  const sid = await session(page);

  const send = async (cmd: Record<string, unknown>) => {
    const res = await request.post(`${API}/commands`, {
      headers: AUTH,
      data: { ...cmd, type: "set_grid_view", session: sid, timeout: 30 },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()) as { ok: boolean; error?: string; identity?: string };
  };
  const published = async () => {
    const res = await request.get(`${API}/context`, { headers: AUTH, params: { session: sid } });
    return res.ok() ? (await res.json()).grid : null;
  };

  const filter = { conditions: [{ column: "Age", op: "gt", value: 60 }], combine: "and" };
  const ack = await send({ filter, sort: [{ column: "Age", desc: true }] });
  expect(ack).toMatchObject({ ok: true, identity });
  // #110: read right after the ack, the context pairs the new view with its
  // own row count (the count the view bar shows), never the unfiltered 41.
  const right = await published();
  expect(right).toMatchObject({ filter, sort: [{ column: "Age", desc: true }] });
  expect(right.total).toBeLessThan(41);

  const bar = page.locator("[data-grid-view]");
  await expect(bar).toContainText("View only");
  await expect(bar.locator("[data-view-count]")).toHaveText(`${right.total} of 41 rows`);
  await expect
    .poll(async () => {
      const t = await page
        .locator(".grid-row")
        .first()
        .locator('[title^="Age = "]')
        .first()
        .getAttribute("title");
      return Number(t?.match(/Age = ([\d.]+)/)?.[1] ?? 0);
    })
    .toBe(70);
  expect(await grid.getAttribute("data-identity")).toBe(identity);
  expect(await steps()).toBe(steps0);

  // The agent reads what the user sees (the total follows once the filtered frame loads).
  await expect
    .poll(async () => {
      const g = await published();
      const filtered = typeof g?.total === "number" && g.total < 41;
      return g && JSON.stringify({ f: g.filter, s: g.sort, filtered });
    }, { timeout: 15_000 })
    .toBe(JSON.stringify({ f: filter, s: [{ column: "Age", desc: true }], filtered: true }));

  // Omitted keeps, null clears.
  expect((await send({ sort: null })).ok).toBe(true);
  await expect(bar.locator("[data-view-count]")).toHaveText(/^\d+ of 41 rows$/);
  expect((await send({ filter: null })).ok).toBe(true);
  expect(await published()).toMatchObject({ filter: null, total: 41 });
  await expect(bar).toHaveCount(0);

  const bad = await send({ sort: [{ column: "Ghost", desc: false }] });
  expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("bad_command") });

  // Undo (toast) restores the previous view: re-apply, then undo.
  await send({ filter });
  await expect(bar).toContainText("View only");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(bar).toHaveCount(0);
  expect(await grid.getAttribute("data-identity")).toBe(identity);
  expect(await steps()).toBe(steps0);
});

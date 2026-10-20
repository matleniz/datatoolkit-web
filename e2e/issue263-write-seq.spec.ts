import { expect, test, type APIRequestContext, type Route } from "@playwright/test";

import type { Workspace } from "../src/api/types";
import { openWorkbench } from "./helpers";

/**
 * datatoolkit-issues#263 — an older workspace PUT that reaches the engine after
 * a newer one (the unload flush does not wait for the PUT already on the wire)
 * is refused with 409 `stale_write` and must not overwrite the newer content;
 * Studio drops it silently.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api`;

async function stored(request: APIRequestContext): Promise<Workspace> {
  return (await (await request.get(`${API}/workspaces/churn`)).json()) as Workspace;
}

test("issue 263: a late older PUT is refused (409) and the newer content stays on disk", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const debugs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "debug") debugs.push(m.text());
  });
  await openWorkbench(page, true);

  const puts: Array<{ seq: string; note: string | undefined }> = [];
  let first: Route | null = null;
  let firstSeen!: () => void;
  const firstArrived = new Promise<void>((r) => (firstSeen = r));
  const answers: Array<{ status: number; body: string }> = [];
  await page.route(/\/api\/workspaces\/churn$/, async (route) => {
    const req = route.request();
    if (req.method() !== "PUT") return route.continue();
    const body = JSON.parse(req.postData() ?? "{}") as Workspace;
    puts.push({
      seq: req.headers()["x-dtk-write-seq"] ?? "",
      note: body.notes?.workspace ?? undefined,
    });
    if (!first) {
      first = route; // older PUT: held on the wire
      firstSeen();
      return;
    }
    const res = await route.fetch();
    answers.push({ status: res.status(), body: await res.text() });
    await route.fulfill({ response: res });
  });

  await page.evaluate(() =>
    window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE_NOTE", text: "OLD note" }),
  );
  await firstArrived; // autosave PUT #1 is on the wire
  await page.evaluate(() => {
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;
    window.__DTK_DISPATCH__!({ type: "SET_WORKSPACE_NOTE", text: "NEWER note" });
  });
  // The page goes away: the keepalive flush overtakes PUT #1.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => answers.length, { timeout: 15_000 }).toBe(1);
  expect(answers[0]!.status).toBe(200);
  expect((await stored(request)).notes?.workspace).toBe("NEWER note");

  // Release the older PUT: the engine refuses it, nothing is written.
  const held = first as Route | null;
  const res = await held!.fetch();
  const staleStatus = res.status();
  const staleBody = await res.text();
  await held!.fulfill({ response: res });
  expect(staleStatus).toBe(409);
  expect(JSON.parse(staleBody)).toMatchObject({
    type: "StaleWriteError",
    detail: { rule: "stale_write" },
  });

  await expect.poll(() => debugs.some((d) => d.includes("stale save of churn dropped"))).toBe(true);
  expect((await stored(request)).notes?.workspace).toBe("NEWER note");
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Chromium itself logs every 4xx fetch; the app must add no error of its own.
  expect(errors.filter((e) => !e.startsWith("Failed to load resource"))).toEqual([]);
  expect(BigInt(puts[1]!.seq)).toBeGreaterThan(BigInt(puts[0]!.seq));
  console.log(
    `DEMO puts=${JSON.stringify(puts)} newer=${answers[0]!.status} stale=${staleStatus} ${staleBody}`,
  );
});

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Step } from "../src/api/types";
import { openWorkbench, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#187 — a `propose_steps` step carries an optional `note`:
 * it is stored as the step's `note` (the field `set_note` writes), shown on
 * the step card, and shown in the review of a destructive proposal.
 */
const API = `http://127.0.0.1:${process.env.DTK_E2E_API_PORT ?? "8766"}/api/ui`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

type Ack = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const steps = (page: Page) =>
  page.evaluate(() => (window.__DTK_STATE__?.()?.workspace?.steps ?? []) as Step[]);

async function send(request: APIRequestContext, page: Page, cmd: Record<string, unknown>): Promise<Ack> {
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);
  const res = await request.post(`${API}/commands`, {
    headers: AUTH,
    data: { ...cmd, session: sid, timeout: 30 },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Ack;
}

test("issue 187: a proposed step note lands on the step and shows in the review", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openWorkbench(page, true);
  await waitForGridReady(page);
  const identity = async () =>
    (await page.getByLabel("Data grid").getAttribute("data-identity-current"))!;

  // A non-destructive add applies at once and keeps the note.
  const added = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: await identity(),
    ops: [{
      add: {
        step: {
          op: "impute", target: "both", params: { columns: ["age"], strategy: "median" },
          note: "median: age is skewed",
        },
      },
    }],
  });
  expect(added.ok).toBe(true);
  await expect.poll(async () => (await steps(page))[0]?.note).toBe("median: age is skewed");
  await waitForGridReady(page);
  await expect(page.getByRole("button", { name: /^Note on step 1 / }))
    .toHaveAttribute("data-has-note", "1");

  // A destructive one shows the note in the review, then on the step.
  const dropped = await send(request, page, {
    type: "propose_steps", workspace: "churn", base_identity: await identity(),
    ops: [{
      add: {
        step: {
          op: "drop_columns", target: "both", params: { columns: ["support_calls"] },
          note: "constant in every cohort",
        },
      },
    }],
  });
  expect(dropped.pending).toBe("review");
  const review = page.getByLabel("Agent proposal");
  await expect(review).toContainText("drop_columns (support_calls)");
  await expect(review).toContainText("note: constant in every cohort");
  expect((await steps(page)).length).toBe(1);
  await review.getByRole("button", { name: "Apply" }).click();
  await expect.poll(async () => (await steps(page)).map((s) => s.note)).toEqual([
    "median: age is skewed", "constant in every cohort",
  ]);
  await waitForGridReady(page);
  await expect(page.getByRole("button", { name: /^Note on step 2 / }))
    .toHaveAttribute("data-has-note", "1");
});

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Workspace } from "../src/api/types";
import { churnWorkspace, waitForGridReady } from "./helpers";

/**
 * datatoolkit-issues#178 — workspace documents: the Documents section of the
 * Sources card (upload, open, note, remove, kept across a reload and the
 * Sources save), the agent's `keep_attachment` (toast + Undo) and the chat
 * chip's "keep" button; the engine serves the stored file and its text.
 */
const PORT = process.env.DTK_E2E_API_PORT ?? "8766";
const API = `http://127.0.0.1:${PORT}/api`;
const AUTH = { Authorization: `Bearer ${process.env.DTK_UI_TOKEN}` };

const ENGINE = process.env.DTK_ENGINE_DIR ?? "";

/** The stub pack drives the real dtk MCP tools against this dtk-api (`mcp_stub_driver.py`, #100). */
function runTools(script: { tool: string; args: Record<string, unknown> }[]) {
  const stdout = execFileSync(join(ENGINE, ".venv/bin/python"), [join(process.cwd(), "e2e", "mcp_stub_driver.py")], {
    input: JSON.stringify(script),
    env: { ...process.env, DTK_HOME: process.env.DTK_E2E_HOME },
  });
  return (JSON.parse(stdout.toString()) as { results: { tool: string; is_error: boolean; result: unknown }[] })
    .results;
}

const DICTIONARY = "# Data dictionary\n\n- age: years since birth\n- churn: 1 = left within 90 days\n";

const documents = (page: Page) =>
  page.evaluate(() => (window.__DTK_STATE__?.()?.workspace as Workspace | undefined)?.documents ?? []);

async function stored(request: APIRequestContext, name = "churn"): Promise<Workspace> {
  return (await (await request.get(`${API}/workspaces/${name}`)).json()) as Workspace;
}

async function saved(page: Page) {
  await page.waitForFunction(async () => {
    const p = window.__DTK_WORKSPACE_SAVED__;
    if (!p) return false;
    await p;
    return true;
  });
}

/** A clean churn workspace in the store, then the Sources screen. */
async function openSources(page: Page, request: APIRequestContext) {
  // A fresh workspace: the engine never reuses a document id (#180), so ids of earlier tests would carry over.
  await request.delete(`${API}/workspaces/churn`);
  const put = await request.put(`${API}/workspaces/churn`, { data: churnWorkspace() });
  expect(put.ok()).toBe(true);
  await page.goto("/");
  await expect(page.getByLabel("Sources screen")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Sources of “churn”")).toBeVisible();
  return page.getByRole("region", { name: "Documents" });
}

test.beforeEach(async ({ request }) => {
  const res = await request.post(`${API}/documents/describe`, { data: { path: "/nope" } });
  test.skip(res.status() === 404 || res.status() === 405, "engine without workspace documents (#178)");
});

test("issue 178: Documents section of the Sources card: upload, open, note, remove, reload", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  const section = await openSources(page, request);
  await expect(section.getByRole("listitem")).toHaveCount(0);

  await section.locator('input[type="file"]').setInputFiles([
    { name: "dictionary.md", mimeType: "text/markdown", buffer: Buffer.from(DICTIONARY) },
  ]);
  const row = section.locator('[data-document-id="d1"]');
  await expect(row).toContainText("dictionary.md");
  await expect(row).toContainText("text ·");
  expect(await documents(page)).toMatchObject([{ id: "d1", name: "dictionary.md", kind: "text", mime: "text/markdown" }]);

  // Note through the shared note popover.
  await row.getByRole("button", { name: "Note on document dictionary.md" }).click();
  const pop = page.getByRole("dialog", { name: "Note on document dictionary.md" });
  await pop.getByLabel("Note text").fill("codebook from the study team");
  await pop.getByRole("button", { name: "Save" }).click();
  await saved(page);
  const ws = await stored(request);
  expect(ws.documents).toMatchObject([{ id: "d1", name: "dictionary.md", note: "codebook from the study team" }]);

  // Open = the engine serves the stored file; the agent's text route reads it.
  const href = await row.getByRole("link", { name: "dictionary.md", exact: true }).getAttribute("href");
  expect(href).toBe("/api/workspaces/churn/documents/d1/file");
  const file = await page.request.get(href!);
  expect(file.ok()).toBe(true);
  expect(await file.text()).toBe(DICTIONARY);
  const text = (await (await request.get(`${API}/workspaces/churn/documents/d1/text`)).json()) as { text: string };
  expect(text.text).toContain("age: years since birth");

  // The Sources save ("Open workbench") keeps the documents.
  await page.getByRole("button", { name: "Open workbench" }).click();
  await waitForGridReady(page);
  await saved(page);
  expect((await stored(request)).documents).toMatchObject([{ id: "d1" }]);

  // Back after a reload, then removed (Undo in the workbench brings it back).
  await page.reload();
  await expect(page.getByText("Loading workspace…")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByLabel("Sources screen")).toBeVisible();
  await expect(row).toContainText("dictionary.md");
  await row.getByRole("button", { name: "Remove dictionary.md" }).click();
  await expect(row).toHaveCount(0);
  await saved(page);
  expect((await stored(request)).documents ?? []).toEqual([]);
  await page.evaluate(() => window.__DTK_DISPATCH__!({ type: "UNDO_STEPS" }));
  await expect(row).toContainText("dictionary.md");

  // Drop several files at once: ids follow each other.
  const drop = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["protocol"], "protocol.txt", { type: "text/plain" }));
    dt.items.add(new File(["a,b\n1,2\n"], "codes.csv", { type: "text/csv" }));
    return dt;
  });
  await section.dispatchEvent("drop", { dataTransfer: drop });
  await expect.poll(async () => (await documents(page)).map((d) => [d.id, d.name, d.kind])).toEqual([
    ["d1", "dictionary.md", "text"],
    ["d2", "protocol.txt", "text"],
    ["d3", "codes.csv", "table"],
  ]);
});

test("issue 178: keep_attachment from the bridge and the chip's keep button, Undo", async ({
  page, request,
}) => {
  test.setTimeout(180_000);
  await openSources(page, request);
  await page.getByRole("button", { name: "Open workbench" }).click();
  await waitForGridReady(page);
  await saved(page);
  const sid = await page.evaluate(() => window.sessionStorage.getItem("dtk-ui-session")!);

  // Two files attached to this session's chat.
  const attach = async (name: string, body: string) => {
    const up = (await (await request.put(`${API}/uploads/${name}`, { data: Buffer.from(body) })).json()) as {
      path: string;
    };
    const res = await request.post(`${API}/ui/agent/attachments`, {
      headers: AUTH,
      data: { session: sid, path: up.path },
    });
    expect(res.ok()).toBe(true);
    return ((await res.json()) as { id: string }).id;
  };
  const a1 = await attach("dictionary.md", DICTIONARY);
  const a2 = await attach("protocol.txt", "visit schedule");

  const send = async (cmd: Record<string, unknown>) => {
    const res = await request.post(`${API}/ui/commands`, {
      headers: AUTH,
      data: { type: "keep_attachment", workspace: "churn", ...cmd, session: sid, timeout: 30 },
    });
    expect(res.ok()).toBe(true);
    return (await res.json()) as Record<string, unknown>;
  };
  expect(await send({ attachment_id: a1, note: "the codebook" })).toMatchObject({ ok: true, document_id: "d1" });
  expect(await documents(page)).toMatchObject([{ id: "d1", name: "dictionary.md", note: "the codebook" }]);
  // The same attachment again: the existing document, nothing added.
  expect(await send({ attachment_id: a1 })).toMatchObject({ ok: true, document_id: "d1" });
  expect(await send({ attachment_id: "nope" })).toMatchObject({ ok: false, error: "bad_command: unknown attachment" });

  const toast = page.getByRole("status").filter({ hasText: "Agent: kept dictionary.md in the workspace documents" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await documents(page)).length).toBe(0);

  // Studio side: the chip's keep button on the panel's session attachments.
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Agent" });
  const chip = panel.locator(`[data-session-attachment="${a2}"]`);
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.getByRole("button", { name: "Keep protocol.txt in the workspace" }).click();
  await expect(chip.getByText("kept")).toBeVisible();
  await saved(page);
  expect((await stored(request)).documents).toMatchObject([{ id: "d1", name: "protocol.txt" }]);
});

test("issue 178: the agent (stub pack, real MCP tools) lists and reads a document added in Studio", async ({
  page, request,
}) => {
  test.skip(!ENGINE, "set DTK_ENGINE_DIR to an engine checkout with a synced .venv (extra agent)");
  test.setTimeout(180_000);
  const section = await openSources(page, request);
  await section.locator('input[type="file"]').setInputFiles([
    { name: "dictionary.md", mimeType: "text/markdown", buffer: Buffer.from(DICTIONARY) },
  ]);
  await expect(section.locator('[data-document-id="d1"]')).toBeVisible();
  await saved(page);

  const [list, read, missing] = runTools([
    { tool: "list_documents", args: { workspace: "churn" } },
    { tool: "read_document", args: { workspace: "churn", id: "d1" } },
    { tool: "read_document", args: { workspace: "churn", id: "d9" } },
  ]);
  expect(list!.is_error).toBe(false);
  expect(JSON.stringify(list!.result)).toContain("dictionary.md");
  expect(read!.is_error).toBe(false);
  expect(JSON.stringify(read!.result)).toContain("age: years since birth");
  expect(missing!.is_error).toBe(true);
});

// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "../src/api/client";
import { EngineError, type Workspace } from "../src/api/types";
import { Bootstrap } from "../src/BootstrapGate";
import { SaveFailureBanner } from "../src/SaveFailureBanner";
import { AppProvider } from "../src/state/AppStore";
import {
  resetWorkspaceSaveGateForTests,
  ensureWorkspaceSaved,
  setCommittedWorkspace,
} from "../src/state/workspaceSaveGate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ws(name: string, path = "/tmp/a.csv"): Workspace {
  return {
    name,
    datasets: { train: { x: { kind: "csv", path } } },
    label: { mode: "order" },
    merges: [],
    variables: [],
    groups: [],
    steps: [],
  };
}

const store = new Map<string, string>();
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetWorkspaceSaveGateForTests();
});

async function render(el: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(el);
  });
}

describe("startup error screen keeps the skipped workspace across Retry (#262)", () => {
  it("names the corrupt workspace on the error screen and after Retry", async () => {
    store.set("dtk.lastWorkspace", "bad");
    vi.spyOn(apiClient, "listWorkspaces").mockResolvedValue([
      { name: "bad", corrupt: true, error: "invalid JSON" } as never,
      ws("churn"),
    ]);
    const get = vi
      .spyOn(apiClient, "getWorkspace")
      .mockRejectedValue(new EngineError("Boom", "cannot read churn", 500));

    await render(
      createElement(AppProvider, null, createElement(Bootstrap, null, createElement("p", null, "app"))),
    );
    const notice = () => host.querySelector("[data-workspace-skipped]");
    expect(host.textContent).toContain("Cannot reach the engine");
    expect(notice()?.getAttribute("data-workspace-skipped")).toBe("bad");
    expect(notice()?.textContent).toContain("invalid JSON");

    // Retry: the remembered name is gone from localStorage, the notice stays.
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    await act(async () => {
      retry.click();
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Cannot reach the engine");
    expect(notice()?.getAttribute("data-workspace-skipped")).toBe("bad");

    // The engine recovers: the app opens and the notice is still there.
    get.mockImplementation(async (n) => ws(n));
    const retry2 = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    await act(async () => {
      retry2.click();
    });
    expect(host.textContent).toContain("app");
    expect(notice()?.getAttribute("data-workspace-skipped")).toBe("bad");
  });
});

describe("SaveFailureBanner lists every orphaned workspace (#243)", () => {
  it("shows one alert per lost workspace, dismissed one by one", async () => {
    vi.spyOn(apiClient, "saveWorkspace").mockRejectedValue(new Error("503"));
    const a = ws("a243");
    const b = ws("b243", "/tmp/b.csv");
    await render(createElement(SaveFailureBanner));
    await act(async () => {
      setCommittedWorkspace(a);
      await ensureWorkspaceSaved(a).catch(() => undefined);
      setCommittedWorkspace(b);
      await ensureWorkspaceSaved(b).catch(() => undefined);
      setCommittedWorkspace(ws("c243", "/tmp/c.csv"));
    });
    const lost = () =>
      [...host.querySelectorAll("[data-save-failed=orphaned]")].map((e) =>
        e.getAttribute("data-workspace"),
      );
    expect(lost()).toEqual(["a243", "b243"]);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-workspace=a243] button")!.click();
    });
    expect(lost()).toEqual(["b243"]);
  });
});

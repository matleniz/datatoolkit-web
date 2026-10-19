// @vitest-environment jsdom
import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../src/ErrorBoundary";
import type { Workspace } from "../src/api/types";
import {
  resetWorkspaceSaveGateForTests,
  setCommittedWorkspace,
} from "../src/state/workspaceSaveGate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): ReactElement {
  throw new Error("kaboom (test)");
}

const WS: Workspace = {
  name: "demo",
  datasets: { train: { x: { kind: "csv", path: "/tmp/t.csv" } } },
  label: { mode: "order" },
  merges: [],
  variables: [],
  groups: [],
  steps: [],
};

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  resetWorkspaceSaveGateForTests();
});

function mountBroken(): void {
  act(() => root.render(createElement(ErrorBoundary, null, createElement(Boom))));
}

describe("ErrorBoundary (#221)", () => {
  it("renders the fallback with the message and logs the component stack", () => {
    mountBroken();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("kaboom (test)");
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Reload", "Export workspace JSON"]);
    const logged = vi.mocked(console.error).mock.calls.find((c) => c[0] === "[ui] render error");
    expect(logged?.[1]).toBeInstanceOf(Error);
    expect(String(logged?.[2])).toContain("Boom");
  });

  it("Export downloads the in-memory workspace as valid JSON", async () => {
    setCommittedWorkspace(WS);
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mountBroken();
    const exportBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Export"));
    act(() => exportBtn!.click());
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blob!);
    });
    expect(JSON.parse(text)).toEqual(WS);
  });

  it("Export does not throw without a workspace and says so", () => {
    mountBroken();
    const exportBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Export"));
    act(() => exportBtn!.click());
    expect(host.querySelector("[role=status]")?.textContent).toContain("No workspace");
  });

  it("Export survives an unserializable workspace", () => {
    const bad = { ...WS } as Record<string, unknown>;
    bad.self = bad;
    setCommittedWorkspace(bad as unknown as Workspace);
    mountBroken();
    const exportBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Export"));
    act(() => exportBtn!.click());
    expect(host.querySelector("[role=status]")).not.toBeNull();
  });
});

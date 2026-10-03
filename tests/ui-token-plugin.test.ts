import { describe, expect, it } from "vitest";
import config from "../vite.config";
import e2eConfig from "../e2e/vite.e2e.config";
import { resolveUiToken } from "../scripts/uiToken";

describe("dtk-ui-token-meta plugin", () => {
  it.each([
    ["vite.config", config],
    ["vite.e2e.config", e2eConfig],
  ])("%s injects the token on the dev server only", (_name, cfg) => {
    const plugin = (cfg.plugins ?? [])
      .flat()
      .find(
        (p: unknown) =>
          p && (p as { name?: string }).name === "dtk-ui-token-meta",
      ) as { apply?: string } | undefined;
    expect(plugin?.apply).toBe("serve");
  });
});

describe("resolveUiToken", () => {
  const target = "http://127.0.0.1:8765";
  const file = (o: object) => () => JSON.stringify(o);
  const live = {
    url: "http://127.0.0.1:8765",
    token: "from-file",
    pid: 1,
    started: "x",
  };

  it("env wins over the runtime file", () => {
    expect(
      resolveUiToken(target, { DTK_UI_TOKEN: "from-env" }, file(live)),
    ).toBe("from-env");
  });

  it("uses the runtime file when its url matches the proxy target", () => {
    expect(resolveUiToken(target, {}, file(live))).toBe("from-file");
    expect(
      resolveUiToken(
        target,
        {},
        file({ ...live, url: "http://localhost:8765" }),
      ),
    ).toBe("from-file");
  });

  it("ignores the file on a port or host mismatch", () => {
    expect(
      resolveUiToken(
        target,
        {},
        file({ ...live, url: "http://127.0.0.1:9999" }),
      ),
    ).toBeUndefined();
    expect(
      resolveUiToken(
        target,
        {},
        file({ ...live, url: "http://10.0.0.2:8765" }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a missing, garbage or tokenless file", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(resolveUiToken(target, {}, missing)).toBeUndefined();
    expect(resolveUiToken(target, {}, () => "not json")).toBeUndefined();
    expect(resolveUiToken(target, {}, file({ url: live.url }))).toBeUndefined();
  });

  it("reads $DTK_HOME/agent/runtime.json", () => {
    let seen = "";
    resolveUiToken(target, { DTK_HOME: "/tmp/h" }, (p) => {
      seen = p;
      return "{}";
    });
    expect(seen).toBe("/tmp/h/agent/runtime.json");
  });
});

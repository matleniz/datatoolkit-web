import { describe, expect, it } from "vitest";
import config from "../vite.config";
import e2eConfig from "../e2e/vite.e2e.config";

describe("dtk-ui-token-meta plugin", () => {
  it.each([
    ["vite.config", config],
    ["vite.e2e.config", e2eConfig],
  ])("%s injects the token on the dev server only", (_name, cfg) => {
    const plugin = (cfg.plugins ?? [])
      .flat()
      .find((p: unknown) => p && (p as { name?: string }).name === "dtk-ui-token-meta") as
      | { apply?: string }
      | undefined;
    expect(plugin?.apply).toBe("serve");
  });
});

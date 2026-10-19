import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BootstrapError } from "../src/BootstrapError";
import { ENGINE_UNREACHABLE_LIST, engineDownHint } from "../src/bootstrapError";

describe("engineDownHint", () => {
  it("dev names dtk-api on 8765, not Docker", () => {
    const h = engineDownHint(true);
    expect(h).toContain("8765");
    expect(h).not.toContain("docker compose");
  });
  it("built app names docker compose logs engine, not 8765", () => {
    const h = engineDownHint(false);
    expect(h).toContain("docker compose logs engine");
    expect(h).not.toContain("8765");
  });
});

describe("BootstrapError", () => {
  it("shows the real error in an alert with a Retry button", () => {
    const html = renderToStaticMarkup(
      createElement(BootstrapError, { error: "HTTP 500 boom", onRetry: () => {} }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("HTTP 500 boom");
    expect(html).toContain(">Retry<");
  });
});

it("list-unreachable text is not the empty-state text", () => {
  expect(ENGINE_UNREACHABLE_LIST).not.toContain("No workspaces yet");
});

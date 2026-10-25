# e2e tests (Playwright)

Back to the [README](../README.md); the other checks are in
[Development](development.md#scripts).

- Chromium only (`playwright.config.ts`); first run needs
  `npx playwright install chromium`.
- `npm run e2e` starts its own servers, never reusing running ones: `dtk-api`
  on **8766** (`DTK_E2E_API_PORT`) and Vite with `e2e/vite.e2e.config.ts` on
  **5175** (`DTK_E2E_WEB_PORT`), so it does not clash with a dev server on
  8765 / 5173.
- `dtk-api` resolution: `DTK_API_CMD` (full command), else
  `DTK_API_BIN --port <port>`, else `~/datatoolkit/.venv/bin/dtk-api`, else
  `uv run --project ~/datatoolkit --extra api dtk-api`.
- Engine checkout: `DTK_ENGINE_DIR`, else `~/datatoolkit` (`e2e/engine.ts`,
  used by the config and by the specs that drive the real MCP tools:
  `issue100-mcp-tools`, `issue178-documents`, `issue179-agent-memory`). Without
  a synced `.venv` there those specs **fail** with a message naming
  `DTK_ENGINE_DIR`; `DTK_E2E_SKIP_ENGINE=1` is the explicit opt-out that skips
  them.
- The engine runs with `DTK_HOME` = `DTK_E2E_HOME` or a fresh temp dir,
  deleted after the run unless `DTK_E2E_KEEP=1` (`e2e/global-teardown.ts`).
- One worker, not fully parallel; retries only on CI.
- `playwright.config.ts` makes a random `DTK_UI_TOKEN` per run (unless set) for
  the engine, the page and `e2e/issue63-agent-bridge.spec.ts` (which posts
  commands to `POST /api/ui/commands`), and adds the web origin to the
  engine's `DTK_CORS_ORIGINS`.
- `e2e/vite.e2e.config.ts` pre-bundles all deps (`optimizeDeps.include`), so a
  cold `node_modules/.vite` does not reload the page mid-spec. Add a dep there
  when you import a new one lazily.
- Specs wait on readiness signals, not fixed timeouts, so they pass alone, in
  any order and under load (datatoolkit-issues#13): `waitForAlignReady`
  (`.align-layout[data-align-state="ready"]`: the report matches the current
  fixes), `waitForSuggestionsReady` (`.sug-identity` `data-identity` caught up
  with `data-identity-current`), `applyEditorStep` (editor closed, grid
  ready, the step's pipeline node shows its shape) and `waitForGridReady`.
- Screenshots always go to `e2e/screenshots/<flow>/` (gitignored). The
  committed copies under `docs/screenshots/t1-e2e/` are only rewritten with
  `DTK_E2E_SCREENSHOTS=1 npm run e2e`, so a plain run leaves the tree clean.

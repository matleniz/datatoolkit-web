# datatoolkit Studio (`datatoolkit-web`)

Web front for the datatoolkit engine. Talks only to the HTTP API (`dtk-api`);
never imports `dtk_engine`. Specs live in the docs hub (`FRONT-WEB.md`,
`ARCHITECTURE.md`, `TRANSFORMS.md`). Original behaviour reference:
`docs/prototype.dc.html` (2026-09-27; it predates later UX changes such as the
Suggestions-only left panel and the grid dock, so `FRONT-WEB.md` and the code
are the reference where they differ).

## Requirements

- Node **22+** (`engines.node` is `>=22`; the Docker build uses `node:22-alpine`)
- Engine API from `~/datatoolkit` (optional for unit tests; required for live data)

## Run

```bash
# terminal 1 — engine HTTP API
cd ~/datatoolkit
uv run --extra api dtk-api --port 8765

# terminal 2 — Vite front (proxies /api → :8765)
cd /path/to/datatoolkit-web
npm install
npm run dev
```

Open http://localhost:5173 (Vite's default host and port). Override the API
base with `VITE_API_URL` (default `/api`, see `.env.example`).

On start, Studio reopens the last workspace (`localStorage["dtk.lastWorkspace"]`)
or `churn` if the engine store has it; on an empty store it uploads the demo
churn CSVs from `public/fixtures/` and saves a `churn` workspace
(`src/bootstrap.ts`).

## Run with Docker

Engine + Studio in one command (images from GHCR):

```bash
curl -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/compose.yml -o datatoolkit.yml && docker compose -f datatoolkit.yml up -d
```

PowerShell: `curl.exe -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/compose.yml -o datatoolkit.yml; docker compose -f datatoolkit.yml up -d`

Then open http://localhost:8080 (bound to localhost only; change with
`DTK_PORT`). Update with `docker compose -f datatoolkit.yml pull && docker
compose -f datatoolkit.yml up -d`. Workspaces, uploads and exports live in
`./datatoolkit-data` (override with `DTK_DATA`). Sources given as host absolute
paths are not visible inside the container: use upload instead.

From a checkout, `docker compose up -d --build` builds both images locally.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server + `/api` proxy |
| `npm run build` | `tsc --noEmit` then `vite build` into `dist/` |
| `npm run preview` | Serve `dist/` (same `/api` proxy as dev) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unit): `tests/**/*.test.ts`, `src/**/*.test.ts` |
| `npx knip@6 --exclude types` | Unused files / exports / dependencies (fetched by npx, not a dependency) |
| `npm run e2e` | Playwright e2e suite with headless `dtk-api` + Vite |

`fleet gate` runs `npm run lint`, `npm run typecheck`, `npm test` and
`npx knip@6 --exclude types` (one command per line in `GATE_CMDS` of the
project's fleet config, outside this repo); the e2e suite is run separately.
`.github/workflows/ci.yml` runs the same checks; e2e stays local.

`eslint-plugin-sonarjs` enforces one rule, `sonarjs/cognitive-complexity` at 25
(`error`): extract pure helpers rather than raising the ceiling.

### e2e (Playwright)

- Chromium only (`playwright.config.ts`); first run needs
  `npx playwright install chromium`.
- `npm run e2e` starts its own servers, never reusing running ones: `dtk-api`
  on **8766** (`DTK_E2E_API_PORT`) and Vite with `e2e/vite.e2e.config.ts` on
  **5175** (`DTK_E2E_WEB_PORT`), so it does not clash with a dev server on
  8765 / 5173.
- `dtk-api` resolution: `DTK_API_CMD` (full command), else
  `DTK_API_BIN --port <port>`, else `~/datatoolkit/.venv/bin/dtk-api`, else
  `uv run --project ~/datatoolkit --extra api dtk-api`.
- The engine runs with `DTK_HOME` = `DTK_E2E_HOME` or a fresh temp dir,
  deleted after the run unless `DTK_E2E_KEEP=1` (`e2e/global-teardown.ts`).
- One worker, not fully parallel; retries only on CI.
- Screenshots always go to `e2e/screenshots/<flow>/` (gitignored). The
  committed copies under `docs/screenshots/t1-e2e/` are only rewritten with
  `DTK_E2E_SCREENSHOTS=1 npm run e2e`, so a plain run leaves the tree clean.

## Styling

Design tokens: `src/theme/tokens.css` (prototype palette + IBM Plex /
Instrument Serif). Features use either one plain global stylesheet or CSS
modules — see `src/theme/README.md`. No CSS framework.

## Layout

| Path | Contents |
|---|---|
| `src/api/` | `client.ts` (the only module calling `dtk-api`), request dedupe, contract types |
| `src/state/` | `AppStore` (React context + reducer), browser storage (dock, panels, charts, dismissed suggestions), workspace save gate |
| `src/screens/sources/`, `src/screens/align/` | Sources and train / test alignment screens |
| `src/bench/` | Workbench: `pipeline`, `grid`, `inspector`, `editor`, `contextmenu`, `left` (Suggestions), `dock` (analysis windows + Chart), `toolrail`, `export` |
| `src/theme/` | Design tokens |
| `tests/` | Vitest unit tests and their JSON fixtures |
| `e2e/` | Playwright specs, `helpers.ts`, data fixtures |
| `docker/`, `Dockerfile`, `compose.yml` | nginx image and the engine + Studio stack |

Suggestions can be dismissed (datatoolkit-issues#15): browser-local, per
workspace (`localStorage["dtk.dismissedSuggestions.<workspace>"]`). The id
hashes the key, the suggested step (op / target / params) and the finding
(column, title, detail), so a finding stays hidden after an unrelated step
and shows again once its content changes; "Show dismissed" lists the hidden
ones with a Restore action. No key-specific logic.

Step editor fields come from the transform schema (`src/bench/schemaFields.ts`),
with two generic hints (datatoolkit-issues#48), no op-specific code:
`x-dtk-when` (`{sibling: value or list of values}`) shows, validates and sends
a param only while every listed sibling has one of those values (e.g. impute's
`by` / `order` / `fallback` / `expr` / `fill_value` follow `strategy`); an
empty `x-dtk-semantic` param (e.g. `impute.by`, `ffill.by` = `group_id`) is
prefilled when the editor opens with the frame's column whose `workspace_rows`
`semantic` matches, only when exactly one column does. The formula palette and
autocomplete also offer `group_mean` / `group_prev` / `group_interp`.

No router: the three screens (Sources, Alignment, Workbench) are reducer
state (`SET_SCREEN`); nginx serves `index.html` for any path.

Workbench layout (prototype sizes, `src/theme/tokens.css`): pipeline
**96px**, left **280px**, inspector **318px**, tool rail **56px**.

Pipeline undo / redo (datatoolkit-issues#16): the pipeline bar's ↶ / ↷
buttons, Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or Ctrl+Y) undo / redo changes to
the workspace's steps (add, remove, alignment steps) and replay at the latest
version. History is in memory (`AppState.stepHistory`, 100 levels,
`src/state/stepHistory.ts`), reset when another workspace is loaded; disabled
while a step is being edited, and the shortcuts leave text fields alone.
Variables, charts and the target are not part of it.

## Fixtures

Prototype churn CSVs (dirty on purpose) live in `e2e/fixtures/`:
`churn_train.csv`, `churn_labels.csv`, `churn_test.csv` (comma decimals like
`41,0`), `customers_extra.csv`, next to the other e2e datasets. Identical
copies in `public/fixtures/` seed the demo `churn` workspace (see Run).

## Screenshots

`docs/screenshots/t1-e2e/` holds the committed e2e captures (see e2e above).
`docs/screenshots/fx-*/` are one-off captures from the 2026-09-27/28 fix PRs
(MAT-139 / 142 / 144): no spec writes them, and they show the UI before the
2026-09-29 UX rework (left panel tabs, dock layout, Variables). Likewise
`t1-e2e/4-variables-formula/01-variable-created.png` is no longer captured
(Studio no longer creates variables, MAT-231).

## Issues

Tracked in `matleniz/datatoolkit-issues` (private). Older references use
Linear ids `MAT-<n>` (read-only history; Studio epic MAT-126).

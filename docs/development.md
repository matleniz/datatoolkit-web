# Development

Run Studio from a checkout, the checks, and where things live. Back to the
[README](../README.md).

## Requirements

- Node **22+** (`engines.node` is `>=22`; the Docker build uses Node 22)
- [uv](https://docs.astral.sh/uv/) and the engine repo (optional for unit
  tests; required for live data)

## Run from a checkout

From zero, for development (the engine is expected at `~/datatoolkit`, the
default of `e2e/engine.ts`; set `DTK_ENGINE_DIR` for e2e if it lives elsewhere):

```bash
git clone https://github.com/matleniz/datatoolkit ~/datatoolkit
git clone https://github.com/matleniz/datatoolkit-web && cd datatoolkit-web
npm install

# terminal 1 — engine HTTP API (uv creates the venv on first run)
(cd ~/datatoolkit && uv run --extra api dtk-api --port 8765)

# terminal 2 — Vite front (proxies /api → :8765)
npm run dev
```

No clone needed to just use Studio: the one-line launchers in the
[README](../README.md#run-it) (Docker or uv).

Open http://localhost:5173 (Vite's default host and port). `dtk-api` on another
port: start it with `--port <n>` and run Vite with `DTK_API_PORT=<n> npm run
dev` (also read by `npm run preview`; it changes the proxy target
`http://127.0.0.1:<n>`; unset = 8765). `VITE_API_URL` (default `/api`, see
`.env.example`) only changes the URL prefix the app calls. `npm run e2e` has
its own `DTK_E2E_API_PORT`.

On start, Studio reopens the last workspace (`localStorage["dtk.lastWorkspace"]`)
or `churn` if the engine store has it; on an empty store it uploads the demo
churn CSVs from `public/fixtures/` and saves a `churn` workspace
(`src/bootstrap.ts`).

If the engine is unreachable (or `GET /api/workspaces` fails) at startup, Studio
shows an error screen with the engine's message, a hint for how it is served
(dev: start `dtk-api` on 8765, or on `DTK_API_PORT`; built app: `docker compose logs engine` or the
`dtk-studio` terminal) and a Retry button; the app is mounted only once a
workspace has loaded. Run mode is `import.meta.env.DEV`.

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
project's fleet config, outside this repo); the e2e suite is run separately ([e2e](e2e.md)).
`.github/workflows/ci.yml` runs the same checks; e2e stays local.

The project CHECK (all of the above plus the full e2e) is `bash scripts/fleet-check.sh`.

`eslint-plugin-sonarjs` enforces one rule, `sonarjs/cognitive-complexity` at 25
(`error`): extract pure helpers rather than raising the ceiling.

## Styling

Design tokens: `src/theme/tokens.css` (prototype palette + IBM Plex /
Instrument Serif). Features use either one plain global stylesheet or CSS
modules — see [src/theme/README.md](../src/theme/README.md). No CSS framework.

## Layout

| Path | Contents |
|---|---|
| `src/api/` | `client.ts` (the only module calling `dtk-api`), request dedupe, contract types |
| `src/state/` | `AppStore` (React context + reducer), browser storage (dock, panels, dismissed suggestions), workspace save gate |
| `src/screens/sources/`, `src/screens/align/` | Sources and train / test alignment screens |
| `src/bench/` | Workbench: `pipeline`, `grid`, `inspector`, `editor`, `contextmenu`, `left` (Suggestions), `dock` (analysis windows + Chart), `toolrail`, `export` |
| `src/theme/` | Design tokens |
| `tests/` | Vitest unit tests and their JSON fixtures |
| `e2e/` | Playwright specs, `helpers.ts`, data fixtures |
| `docker/`, `Dockerfile`, `compose.yml` | nginx image and the engine + Studio stack |

Behaviour notes (saved charts, workspace saves, suggestions, step editor,
undo / redo): [Studio behaviour](behaviour.md).

## Fixtures

Prototype churn CSVs (dirty on purpose) live in `e2e/fixtures/`:
`churn_train.csv`, `churn_labels.csv`, `churn_test.csv` (comma decimals like
`41,0`), `customers_extra.csv`, next to the other e2e datasets. Identical
copies in `public/fixtures/` seed the demo `churn` workspace (see [Run from a checkout](#run-from-a-checkout)).

## Screenshots

`docs/screenshots/t1-e2e/` holds the committed e2e captures (see [e2e](e2e.md)).
`docs/screenshots/fx-*/` are one-off captures from the 2026-09-27/28 fix PRs
(MAT-139 / 142 / 144): no spec writes them, and they show the UI before the
2026-09-29 UX rework (left panel tabs, dock layout, Variables). Likewise
`t1-e2e/4-variables-formula/01-variable-created.png` is no longer captured
(Studio no longer creates variables, MAT-231).

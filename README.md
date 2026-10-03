# datatoolkit Studio (`datatoolkit-web`)

Web front for the datatoolkit engine. Talks only to the HTTP API (`dtk-api`);
never imports `dtk_engine`. Specs live in the docs hub (`FRONT-WEB.md`,
`ARCHITECTURE.md`, `TRANSFORMS.md`). Original behaviour reference:
`docs/prototype.dc.html` (2026-09-27; it predates later UX changes such as the
Suggestions-only left panel and the grid dock, so `FRONT-WEB.md` and the code
are the reference where they differ).

## Share it / run it anywhere

One line starts the engine + Studio, waits until they answer and opens
http://localhost:8080. Needs nothing installed: it uses
[Docker](https://docs.docker.com/get-started/get-docker/) when Docker is
installed and running, else it runs without Docker (uv mode, below).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1 | iex
```

**Docker mode** (default when Docker is usable). Other commands: `stop`,
`update` (latest images), `uninstall` (keeps your data; add `--purge` /
`-Purge` to delete it). Piped, pass them as
`curl -fsSL …/datatoolkit.sh | sh -s -- stop` or
`& ([scriptblock]::Create((irm …/datatoolkit.ps1))) stop`. Files live in
`~/datatoolkit` (`%USERPROFILE%\datatoolkit`): `compose.yml`, `.env` and the
data dir `datatoolkit-data`. Env: `DTK_PORT` (8080), `DTK_DATA`,
`DTK_INSTALL_DIR` (install dir), `DTK_NO_OPEN=1` (no browser), `DTK_TIMEOUT`
(seconds, 300). Running it again is safe: it just makes sure the app is up.
More in [Run with Docker](#run-with-docker).

**uv mode** (no Docker: used automatically, with a one-line notice, when
Docker is missing or not running; force it with `--uv` / `-Uv`, e.g.
`curl -fsSL …/datatoolkit.sh | sh -s -- --uv`). The script installs
[uv](https://docs.astral.sh/uv/) with Astral's official installer if it is
missing (user directory, no sudo), then runs the `dtk-studio` launcher
(`launcher/`) from this repo with `uv tool run`: one local process serving
Studio and the engine API on `127.0.0.1`, in the foreground — Ctrl+C or
closing the window stops it (`stop` / `uninstall` are Docker-only). The first
launch takes about a minute (uv fetches Python, the engine and its
dependencies); later ones start in seconds. Data (workspaces, uploads, the
cached Studio build) lives in the engine's data home `~/.datatoolkit`
(`$DTK_HOME`). `update --uv` (`update -Uv`) refreshes the launcher, the engine
and the Studio build, i.e. `uv tool run --refresh --from … dtk-studio --refresh`.
More in [Run without Docker](#run-without-docker-uv).

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

### Agent bridge (dev)

Studio publishes its view (workspace, role, version, identity, selection, open
windows, editor) to the engine's `/api/ui` and runs the commands it relays
(`propose_steps`, `open_window`, `select_columns`, `set_view`), all through the
reducer (undoable). Agent step edits apply at once with an "Undo" notice;
destructive ones (a removed step, `drop_columns`, `filter_rows`,
`drop_low_variance`, `drop_correlated`) wait for Apply / Dismiss: Studio acks
them `pending: "review"` at once (the agent's call returns, the final ack is in
`GET /api/ui/commands/{id}` once the user decides), view commands keep running
while the banner is open, and another `propose_steps` answers `busy`. The page gets
the engine's per-run token from `<meta name="dtk-ui-token">` (never stored).
`dtk-studio` fills it in; with `npm run dev`, pass the same token to both sides:

```bash
export DTK_UI_TOKEN=$(openssl rand -hex 24)          # any random string
DTK_CORS_ORIGINS=http://localhost:5173 uv run --extra api dtk-api --port 8765
npm run dev                                           # same env: Vite injects the meta
```

Without `DTK_UI_TOKEN` the page has no meta and the bridge stays off, silently.
`npm run e2e` generates a token per run.

### Agent panel

The rail's last icon (**Agent**) opens a chat panel next to the tool rail
(datatoolkit-issues#67). It talks to the engine's agent pack over the same
bridge: `event: agent` on `/api/ui/events` (`user_message`, `assistant_delta`,
`tool_call`, `tool_result`, `permission_request`, `usage`, `done`, `error`),
and `GET /api/ui/agent`, `POST /api/ui/agent/send|cancel|permission`. Each tool
call shows as a chip; a click opens the window or highlights the step it
touched. Step edits apply at once with the bridge's Undo toast; destructive
ones wait in the review banner: the chip says "waiting for your review in
Studio", then follows the command status (`applied after your review` /
`dismissed in Studio`), and the UI context lists the open reviews (`reviews:
[{command, summary}]`) so the agent can see what awaits the user. The footer shows the session's cumulative
tokens and a Stop button while a turn runs. With no pack the panel says why.

The engine picks the pack from `DTK_AGENT_PACK` (`agent-sdk`, `stub`, unset =
off): `dtk-studio --agent` (pack `agent-sdk`, needs the engine extra
`agent-sdk`), or `DTK_AGENT_PACK=agent-sdk uv run --extra api --extra agent-sdk
dtk-api` next to `npm run dev`. `npm run e2e` runs the engine with the
scripted `stub` pack.

## Run with Docker

The launchers above wrap this. `scripts/datatoolkit.sh` / `.ps1` check Docker,
install `compose.yml` into `~/datatoolkit` (`DTK_COMPOSE_SRC` overrides the
source: URL or local path), persist `DTK_PORT` / `DTK_DATA` in its `.env`, run
`docker compose -p datatoolkit pull` + `up -d --no-build`, wait for `/` and
`/api/keys` (logs tail on timeout), then open the browser. They refuse an
install dir that is a git checkout (set `DTK_INSTALL_DIR`). The `launcher` job in
`.github/workflows/docker.yml` runs both on ubuntu against the `latest` images.

Engine + Studio by hand (images from GHCR):

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

## Run without Docker (uv)

`launcher/` is a small Python package (`dtk-studio`, hatchling) whose only
dependency is the engine with its `api` extra, straight from GitHub
(`dtk-engine[api] @ git+https://github.com/matleniz/datatoolkit`; nothing is on
PyPI). With [uv](https://docs.astral.sh/uv/) installed:

```bash
uvx --from "git+https://github.com/matleniz/datatoolkit-web#subdirectory=launcher" dtk-studio
```

`dtk-studio [--port 8080] [--no-open] [--refresh]`:

- Studio's build comes from the rolling GitHub release `studio-latest`
  (`studio-dist.zip` + `studio-dist.zip.sha256`, republished on every push to
  `main` by `.github/workflows/studio-release.yml`). It is downloaded once,
  checked against its sha256 and unpacked into `$DTK_HOME/studio/<sha256>/`
  (`~/.datatoolkit`); `--refresh` checks for a newer build. Offline with a
  cache, the cache is used. `DTK_STUDIO_URL` overrides where the two assets
  are fetched from (any URL, `file://` included).
- One ASGI app: the engine's `create_app()` answers `/api/...`, every other
  path is the static build with an SPA fallback to `index.html`. Studio still
  only talks HTTP to `/api` (same origin), as behind nginx.
- Binds `127.0.0.1` only. Port taken → the next free one (it says which);
  default `$DTK_PORT` or 8080. Once `/api/keys` answers it prints the URL and
  the data dir and opens the browser.

From a checkout: `npm run build`, `python3 scripts/pack-studio-dist.py dist
/tmp/rel` (same zip as the release), then
`DTK_STUDIO_URL=file:///tmp/rel uvx --from ./launcher dtk-studio --no-open`.
The build runs on other machines, so it must not embed a path of the build
machine: `node scripts/check-dist-paths.mjs dist` fails on one (run by the
`ci` and `studio-release` workflows and the Docker build).
The sh / ps1 scripts take the launcher from `DTK_LAUNCHER_SRC` (default this
repo's `main`, `launcher/`). The `uv-launcher` workflow runs all of it on
ubuntu, macOS and Windows (`scripts/smoke-uv-launcher.py`): `uvx --from
./launcher`, the sh one-liner falling back to uv (and installing it), and the
ps1 one-liner with `-Uv`.

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

## Styling

Design tokens: `src/theme/tokens.css` (prototype palette + IBM Plex /
Instrument Serif). Features use either one plain global stylesheet or CSS
modules — see `src/theme/README.md`. No CSS framework.

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

Saved charts (datatoolkit-issues#11) live on the engine workspace
(`Workspace.charts`, `{name, params}`): **Save chart** PUTs the workspace with
the new chart through the save gate's ordered chain (`saveWorkspaceNow`) and
only then updates the store, so the engine's error is shown in the chart bar;
a name already saved gets the engine's 422 `duplicate chart name '<name>'`
with a **Replace** action. Charts come back with the workspace on load /
reload, ride along on any later PUT (the Sources rebuild carries them like
steps), and are left out of frame / analysis request bodies and of the data
identity, so a chart save never refetches data. Charts saved by older builds
in `localStorage["dtk.charts.<workspace>"]` are adopted once when the engine
workspace has none, and the key is removed after the next successful save.

Workspace saves (`src/state/workspaceSaveGate.ts`): every autosave and
explicit gate save runs on one ordered chain. A workspace read from the engine
(bootstrap, selecting it on Sources) is marked as saved, so it is not PUT
straight back. Deleting workspaces tombstones their names (no queued or
debounced save runs for them; other workspaces keep saving) and waits for the
PUT already on the wire before the DELETE: an aborted fetch could still be
applied by the engine after the delete (datatoolkit-issues#13). A PUT that
lands for a tombstoned name is deleted again, and the sidebar treats a 404 on
DELETE as already deleted.

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
autocomplete also offer `group_mean` / `group_prev` / `group_interp`. An engine error on the formula
(`formula` and `impute(strategy=formula)`) is shown right under the Expr field,
which gets a red outline, not at the bottom of the panel.

No router: the three screens (Sources, Alignment, Workbench) are reducer
state (`SET_SCREEN`); nginx serves `index.html` for any path.

Workbench layout (prototype sizes, `src/theme/tokens.css`): pipeline
**96px**, left **280px**, inspector **318px**, tool rail **56px**.

Pipeline undo / redo (datatoolkit-issues#16): the pipeline bar's ↶ / ↷
buttons, Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or Ctrl+Y) undo / redo changes to
the workspace's steps (add, edit, remove, alignment steps) and replay at the latest
version. History is in memory (`AppState.stepHistory`, 100 levels,
`src/state/stepHistory.ts`), reset when another workspace is loaded; disabled
while a step is being edited, and the shortcuts leave text fields alone.
Variables, charts and the target are not part of it.

Edit an applied step (datatoolkit-issues#10): a pipeline step node's ✎ button,
or right-click → **Edit step**, opens the step editor pre-filled with the
step's op, target and params (`EDIT_STEP`; the params are the step's own over
the schema defaults, no Studio preset or prefill). While editing, the view is
pinned to the step's input version, the live preview runs on the steps before
it, and Apply stays disabled until something changed; Apply replaces the step
at its index (`REPLACE_STEP`, alignment flag kept, later steps kept) and the
pipeline replays at the latest version, as one undoable change. Discard goes
back to the latest version.

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

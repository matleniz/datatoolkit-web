# datatoolkit Studio (`datatoolkit-web`)

Web front for the datatoolkit engine. Talks only to the HTTP API (`dtk-api`);
never imports `dtk_engine`. Specs live in the docs hub (`FRONT-WEB.md`,
`ARCHITECTURE.md`, `TRANSFORMS.md`). Behaviour reference:
`docs/prototype.dc.html`.

## Requirements

- Node **22** (fnm)
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

Open http://127.0.0.1:5173. Override the API base with `VITE_API_URL`
(default `/api`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server + `/api` proxy |
| `npm run build` | Production build |
| `npm run preview` | Preview the build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (unit) |
| `npm run e2e` | Playwright (starts `dtk-api` if on PATH, else Vite only) |

`fleet gate` = lint + typecheck + test.

## Styling

Design tokens: `src/theme/tokens.css` (prototype palette + IBM Plex /
Instrument Serif). Features use either one plain global stylesheet or CSS
modules — see `src/theme/README.md`. No CSS framework.

## Folder ownership (parallel streams)

| Stream | Owns | Notes |
|---|---|---|
| **W0** (this) | scaffold, `src/api/`, `src/state/`, `src/theme/`, `App` shell, test harness | Done first |
| **W1** | `src/screens/sources/`, `src/screens/align/` | Sources + train/test alignment |
| **W2** | `src/bench/pipeline`, `grid`, `inspector`, `editor`, `contextmenu` | Workbench core |
| **W3** | `src/bench/left`, `dock`, `export`, `toolrail` | Side panels + tools |

Workbench layout (prototype sizes): pipeline **96px**, left **280px**,
inspector **318px**, tool rail **56px**.

## Fixtures

Prototype churn CSVs (dirty on purpose) live in `e2e/fixtures/`:
`churn_train.csv`, `churn_labels.csv`, `churn_test.csv` (comma decimals like
`41,0`), `customers_extra.csv`. The in-memory `MockApiClient` reads them for
unit tests.

## Epic

Linear **MAT-126** (Studio). This scaffold is **MAT-131** (W0).

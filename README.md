# datatoolkit Studio (`datatoolkit-web`)

Studio is the web front of the datatoolkit engine. You load train and test
sources, align them, and build a cleaning and feature pipeline in the Workbench,
with suggestions, analysis windows, charts and export. An optional agent chat
can propose steps. Studio talks to the engine only through its HTTP API
(`dtk-api`) and never imports `dtk_engine`.

## Run it

One command starts the engine and Studio and opens http://localhost:8080. It
uses Docker when Docker is running; otherwise it runs without Docker through
[uv](https://docs.astral.sh/uv/), which it installs if needed.

```bash
curl -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.sh | sh
```

On Windows (PowerShell):
`irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1 | iex`.
It installs one pinned version of the engine and Studio, the same in both
modes; `DTK_COMPOSE_SRC`, `DTK_LAUNCHER_SRC` or `DTK_STUDIO_URL` pick another
source. Stop, update and uninstall commands, plus the Docker and uv details, are in
[docs/running.md](docs/running.md); moving the pin is in [docs/release.md](docs/release.md).

## Example: develop against a local engine

Requires Node 22+ (`engines.node` is `>=22`; the Docker build uses Node 22),
uv and the engine checkout in `~/datatoolkit`.

```bash
(cd ~/datatoolkit && uv run --extra api dtk-api --port 8765) &   # engine API
npm ci && npm run dev                                             # http://localhost:5173
```

The checks are `npm run lint`, `npm run typecheck`, `npm test` and
`npm run e2e`. The full project CHECK is `bash scripts/fleet-check.sh`.

## Docs

In this repo:

- [docs/running.md](docs/running.md): one-line launchers, Docker, uv launcher (`dtk-studio`), pinned version
- [docs/release.md](docs/release.md): the release step that pins the installers
- [docs/development.md](docs/development.md): run from a checkout, scripts and checks, layout, fixtures, screenshots
- [docs/e2e.md](docs/e2e.md): the Playwright e2e suite
- [docs/agent.md](docs/agent.md): agent bridge, agent panel, agent packs, agent chat in Docker
- [docs/placeholders.md](docs/placeholders.md): skeletons and spinner for pending data, no layout shift
- [docs/behaviour.md](docs/behaviour.md): behaviour notes (saved charts, workspace saves, suggestions, step editor, undo / redo)
- `docs/prototype.dc.html`: the original behaviour reference (2026-09-27). It
  predates later UX changes such as the Suggestions-only left panel and the
  grid dock, so where they differ `FRONT-WEB.md` and the code win.

The specs live in the docs hub, a local-only repo with no remote, so they are
cited by path:

- `~/datatoolkit-web-hub/FRONT-WEB.md`: the Studio spec
- `~/datatoolkit-web-hub/ARCHITECTURE.md`: the architecture
- `TRANSFORMS.md`, in the same hub: the transform ops

Issues are tracked in `matleniz/datatoolkit-issues` (private). Older
references use Linear ids `MAT-<n>` (read-only history; the Studio epic is
MAT-126).

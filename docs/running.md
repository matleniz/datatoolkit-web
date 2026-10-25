# Running Studio

How the one-line launchers, the Docker stack and the uv launcher work.
Back to the [README](../README.md).

## The one-line launchers

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

The in-Studio agent chat in Docker is opt-in: see [Agent chat in Docker](agent.md#agent-chat-in-docker-opt-in).

## Run without Docker (uv)

`launcher/` is a small Python package (`dtk-studio`, hatchling) whose only
dependency is the engine with its `api` and `pdf` extras (`pdf` = pypdf, so PDF
workspace documents have their text extracted), straight from GitHub
(`dtk-engine[api,pdf] @ git+https://github.com/matleniz/datatoolkit`; nothing is on
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

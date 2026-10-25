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
`update` (re-fetch the pinned compose file and images), `uninstall` (keeps your data; add `--purge` /
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
`.github/workflows/docker.yml` runs both on ubuntu against the pinned images.

Engine + Studio by hand (images from GHCR):

```bash
curl -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/76c9d356227d0924ac839436bf1d114132876997/compose.yml -o datatoolkit.yml && docker compose -f datatoolkit.yml up -d
```

PowerShell: `curl.exe -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/76c9d356227d0924ac839436bf1d114132876997/compose.yml -o datatoolkit.yml; docker compose -f datatoolkit.yml up -d`

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
(`dtk-engine[api,pdf] @ git+https://github.com/matleniz/datatoolkit@<pinned commit>`;
nothing is on PyPI). With [uv](https://docs.astral.sh/uv/) installed:

```bash
uvx --from "git+https://github.com/matleniz/datatoolkit-web@76c9d356227d0924ac839436bf1d114132876997#subdirectory=launcher" dtk-studio
```

`dtk-studio [--port 8080] [--no-open] [--refresh]`:

- Studio's build comes from the pinned GitHub release `studio-<sha7>`
  (`studio-dist.zip` + `studio-dist.zip.sha256`, published once per push to
  `main` by `.github/workflows/studio-release.yml`, never replaced; the same
  workflow also keeps a rolling `studio-latest`, used only if you point
  `DTK_STUDIO_URL` at it). It is downloaded once, checked against its sha256
  and unpacked into `$DTK_HOME/studio/<sha256>/` (`~/.datatoolkit`); a build
  cached from another source is replaced, `--refresh` checks the source
  again. Offline with a cache, the cache is used. `DTK_STUDIO_URL` overrides
  where the two assets are fetched from (any URL, `file://` included).
- At start it prints the engine version and commit and the Studio build's
  sha256 (`Engine: dtk-engine 0.1.0 (git 43ea5ad); Studio build: sha256 …`).
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
The sh / ps1 scripts take the launcher from `DTK_LAUNCHER_SRC` (default
`launcher/` at the pinned commit, see [Pinned version](#pinned-version)). The `uv-launcher` workflow runs all of it on
ubuntu, macOS and Windows (`scripts/smoke-uv-launcher.py`): `uvx --from
./launcher`, the sh one-liner falling back to uv (and installing it), and the
ps1 one-liner with `-Uv`.

## Pinned version

By default the launchers install one version, set by the release step
([release.md](release.md)), never by hand:

- `scripts/datatoolkit.sh` / `.ps1` fetch `compose.yml` and `launcher/` from
  one commit of this repo (not `main`);
- `compose.yml` names both images by commit (`datatoolkit-engine:sha-<7>`,
  `datatoolkit-web:sha-<7>`, no `latest`) and builds the engine from that same
  engine commit;
- the uv launcher depends on that same engine commit and downloads the Studio
  build of that same web commit (`studio-<7>`, not `studio-latest`).

To run something else, override the source:

| Env | Mode | Example |
| --- | --- | --- |
| `DTK_COMPOSE_SRC` | Docker | another `compose.yml` (URL or path), e.g. one with `:latest` images |
| `DTK_LAUNCHER_SRC` | uv | `git+https://github.com/matleniz/datatoolkit-web@main#subdirectory=launcher`, or `./launcher` |
| `DTK_STUDIO_URL` | uv | `https://github.com/matleniz/datatoolkit-web/releases/download/studio-latest` |
| `UV_OVERRIDE` | uv | file with `dtk-engine[api,pdf] @ git+https://github.com/matleniz/datatoolkit@<ref>` (uv's own override) |

The one-line command itself is fetched from `main`; to install exactly an older
release, fetch the script from that release's commit instead of `main`.

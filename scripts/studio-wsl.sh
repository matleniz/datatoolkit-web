#!/usr/bin/env bash
# Studio + engine from the local checkouts, memory-capped. Used by the Windows
# shortcut (studio-shortcut.ps1 -Wsl, via wsl.exe) and by the Linux .desktop file.
#
#   scripts/studio-wsl.sh [--no-open] [--port N] [--print]
#
# Engine: $DTK_ENGINE_DIR (~/datatoolkit, else the engine pinned by the launcher); Studio: this checkout, built with
# `npm run build` when dist/ is missing or older than src/. They are served by
# the dtk-studio launcher (launcher/), in the foreground: closing the window or
# Ctrl+C stops it. The server runs under `systemd-run --user --scope -p
# MemoryMax=$DTK_MEM_MAX` (3G) so a runaway engine cannot take WSL down;
# DTK_MEM_MAX=none skips the cap (no user systemd). --print shows the commands.
set -euo pipefail

web="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
engine="${DTK_ENGINE_DIR:-$HOME/datatoolkit}"
mem="${DTK_MEM_MAX:-3G}"
rel="${DTK_STUDIO_REL:-${TMPDIR:-/tmp}/dtk-studio-rel}"

print=0
args=()
for a in "$@"; do
  if [ "$a" = "--print" ]; then print=1; else args+=("$a"); fi
done

# The engine checkout when there is one, else the engine the launcher pins.
if [ -f "$engine/pyproject.toml" ]; then
  run=(uv run --project "$engine" --extra api --with "$web/launcher" dtk-studio ${args[@]+"${args[@]}"})
else
  run=(uv tool run --from "$web/launcher" dtk-studio ${args[@]+"${args[@]}"})
fi
cmd=("${run[@]}")
if [ "$mem" != none ]; then
  cmd=(systemd-run --user --scope --quiet -p "MemoryMax=$mem" "${run[@]}")
fi

if [ "$print" = 1 ]; then
  printf '%q ' env "DTK_STUDIO_URL=file://$rel" "${cmd[@]}"
  echo
  exit 0
fi

die() { echo "datatoolkit: $1" >&2; read -r -t 30 -p "Press Enter to close." _ || true; exit 1; }
[ -f "$engine/pyproject.toml" ] || echo "No engine checkout at $engine (DTK_ENGINE_DIR): using the pinned engine."
command -v uv >/dev/null || die "uv is not installed (https://docs.astral.sh/uv/)"

cd "$web"
if [ ! -f dist/index.html ] || [ -n "$(find src index.html package.json -newer dist/index.html -print -quit)" ]; then
  echo "Building Studio..."
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npm run build
fi
rm -rf "$rel" && mkdir -p "$rel"
python3 scripts/pack-studio-dist.py dist "$rel" >/dev/null

# Under WSL the Windows default browser is opened through explorer.exe.
if [ -n "${WSL_DISTRO_NAME:-}" ] && [ -z "${BROWSER:-}" ]; then
  if command -v wslview >/dev/null; then export BROWSER=wslview; else export BROWSER=explorer.exe; fi
fi
DTK_STUDIO_URL="file://$rel" exec "${cmd[@]}"

#!/bin/sh
# datatoolkit launcher (macOS / Linux): engine + Studio with Docker, one command.
#
#   curl -fsSL https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.sh | sh
#   curl -fsSL .../scripts/datatoolkit.sh | sh -s -- stop
#
# Commands: start (default) | stop | update | uninstall [--purge] | help
# Env: DTK_PORT (8080), DTK_DATA (<install dir>/datatoolkit-data), DTK_HOME
# (install dir, ~/datatoolkit), DTK_NO_OPEN=1 (do not open the browser),
# DTK_TIMEOUT (seconds to wait for the app, 300), DTK_COMPOSE_SRC (URL or local
# path of the compose.yml to install; default: this repo's main branch).
#
# Everything runs inside main(), called on the last line, so a truncated
# download through `curl | sh` never runs half a script.

set -eu

DOCKER_URL="https://docs.docker.com/get-started/get-docker/"
DEFAULT_COMPOSE_SRC="https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/compose.yml"
LAUNCHER_URL="https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.sh"
PROJECT=datatoolkit

say() { printf '%s\n' "$*"; }
warn() { printf 'datatoolkit: %s\n' "$*" >&2; }
die() {
  warn "$*"
  exit 1
}

usage() {
  cat <<'EOF'
Usage: datatoolkit.sh [start|stop|update|uninstall [--purge]|help]

  start      start engine + Studio and open it in the browser (default)
  stop       stop the containers (data is kept)
  update     pull the latest images and restart
  uninstall  remove the containers, images and compose file; keeps your data
             unless --purge is given

Piped form: curl -fsSL <url>/datatoolkit.sh | sh -s -- stop
EOF
}

# Value of KEY in the install dir's .env (written by a previous start), if any.
env_file_value() {
  [ -f "$DIR/.env" ] || return 0
  sed -n "s/^$1=//p" "$DIR/.env" | tail -n 1 | sed "s/^'\\(.*\\)'\$/\\1/"
}

resolve_settings() {
  DIR=${DTK_HOME:-$HOME/datatoolkit}
  if [ -e "$DIR/.git" ]; then
    die "$DIR is a git checkout, not a datatoolkit install dir. Set DTK_HOME to another directory."
  fi
  PORT=${DTK_PORT:-}
  DATA=${DTK_DATA:-}
  if [ -d "$DIR" ]; then
    [ -n "$PORT" ] || PORT=$(env_file_value DTK_PORT)
    [ -n "$DATA" ] || DATA=$(env_file_value DTK_DATA)
  fi
  PORT=${PORT:-8080}
  DATA=${DATA:-./datatoolkit-data}
  case $PORT in
    '' | *[!0-9]*) die "DTK_PORT must be a port number, got '$PORT'." ;;
  esac
  case $DATA in
    /*) DATA_ABS=$DATA ;;
    *) DATA_ABS=$DIR/${DATA#./} ;;
  esac
  URL="http://localhost:$PORT"
  CHECK_URL="http://127.0.0.1:$PORT"
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker is not installed. Install Docker Desktop (macOS) or Docker Engine (Linux): $DOCKER_URL
Then run this command again."
  fi
  if ! docker compose version >/dev/null 2>&1 </dev/null; then
    die "Docker is installed but the 'docker compose' plugin is missing.
Install Docker Compose v2: https://docs.docker.com/compose/install/"
  fi
  if ! err=$(docker info 2>&1 >/dev/null </dev/null); then
    case $err in
      *"permission denied"*)
        die "Docker is running but your user may not use it (permission denied).
Add yourself to the docker group (sudo usermod -aG docker \"\$USER\"), log out and back in, then run this again." ;;
    esac
    die "Docker is installed but not running. Start Docker Desktop (or the docker service: sudo systemctl start docker), wait until it is ready, then run this command again."
  fi
}

compose() {
  (cd "$DIR" && docker compose -p "$PROJECT" -f compose.yml "$@" </dev/null)
}

fetch() { # fetch URL DEST
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "Neither curl nor wget is available to download $1."
  fi
}

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -o /dev/null --max-time 5 "$1" 2>/dev/null
  else
    wget -qO /dev/null -T 5 "$1" 2>/dev/null
  fi
}

install_compose() { # install_compose force|missing
  mkdir -p "$DIR"
  if [ "$1" = missing ] && [ -f "$DIR/compose.yml" ]; then
    :
  else
    src=${DTK_COMPOSE_SRC:-$DEFAULT_COMPOSE_SRC}
    case $src in
      http://* | https://*) fetch "$src" "$DIR/compose.yml.tmp" || die "Could not download $src." ;;
      *) cp "$src" "$DIR/compose.yml.tmp" || die "Could not copy $src." ;;
    esac
    mv "$DIR/compose.yml.tmp" "$DIR/compose.yml"
  fi
  # Persist the port and data dir so later stop / update / start reuse them.
  printf "DTK_PORT=%s\nDTK_DATA='%s'\n" "$PORT" "$DATA" >"$DIR/.env"
}

wait_ready() {
  timeout=${DTK_TIMEOUT:-300}
  say "Waiting for Studio on $URL (up to ${timeout}s)..."
  start=$(date +%s)
  while :; do
    if http_ok "$CHECK_URL/" && http_ok "$CHECK_URL/api/keys"; then
      return 0
    fi
    if [ $(($(date +%s) - start)) -ge "$timeout" ]; then
      warn "Studio did not answer on $URL within ${timeout}s. Last container logs:"
      compose ps >&2 || true
      compose logs --tail 40 >&2 || true
      die "Startup failed. Run this command again, or check the logs above."
    fi
    sleep 2
  done
}

open_browser() {
  if [ "${DTK_NO_OPEN:-}" = 1 ]; then
    return 0
  fi
  case $(uname -s) in
    Darwin) open "$URL" >/dev/null 2>&1 || true ;;
    *)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
      elif command -v wslview >/dev/null 2>&1; then
        wslview "$URL" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

bring_up() {
  say "Pulling images..."
  compose pull || die "Could not pull the datatoolkit images. Check your network connection and try again."
  say "Starting engine + Studio..."
  if ! compose up -d --no-build; then
    die "Could not start the containers. If port $PORT is already used, pick another one: DTK_PORT=8090 (then run this again)."
  fi
  wait_ready
  open_browser
  say ""
  say "datatoolkit Studio is running: $URL"
  say "Your data (workspaces, uploads, exports): $DATA_ABS"
  say "Stop it:  curl -fsSL $LAUNCHER_URL | sh -s -- stop"
}

cmd_start() {
  check_docker
  install_compose missing
  bring_up
}

cmd_update() {
  check_docker
  install_compose force
  bring_up
}

cmd_stop() {
  check_docker
  [ -f "$DIR/compose.yml" ] || die "Nothing to stop: datatoolkit is not installed in $DIR."
  compose stop
  say "datatoolkit stopped. Your data is still in $DATA_ABS."
}

cmd_uninstall() {
  purge=${1:-}
  case $purge in
    '' | --purge) ;;
    *) die "Unknown option '$purge' (did you mean --purge?)." ;;
  esac
  check_docker
  if [ -f "$DIR/compose.yml" ]; then
    compose down --rmi all --remove-orphans || die "Could not remove the containers."
    rm -f "$DIR/compose.yml" "$DIR/.env"
  else
    say "No compose file in $DIR: nothing to remove from Docker."
  fi
  if [ "$purge" = --purge ]; then
    if [ -d "$DATA_ABS" ]; then
      rm -rf "$DATA_ABS" || die "Could not delete $DATA_ABS (files owned by another user? remove it by hand, maybe with sudo)."
    fi
    say "datatoolkit uninstalled and its data deleted."
  else
    say "datatoolkit uninstalled. Your data is kept in $DATA_ABS (run 'uninstall --purge' to delete it)."
  fi
  rmdir "$DIR" 2>/dev/null || true
}

main() {
  cmd=${1:-start}
  [ $# -gt 0 ] && shift
  case $cmd in
    -h | --help | help)
      usage
      return 0
      ;;
    start | stop | update | uninstall) ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  resolve_settings
  case $cmd in
    start) cmd_start ;;
    stop) cmd_stop ;;
    update) cmd_update ;;
    uninstall) cmd_uninstall "${1:-}" ;;
  esac
}

main "$@"

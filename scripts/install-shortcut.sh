#!/usr/bin/env bash
# Creates the "datatoolkit Studio" launcher from this checkout:
#   in WSL     a Windows desktop shortcut (wsl.exe -> scripts/studio-wsl.sh);
#   on Linux   a .desktop file in ~/Desktop (or $XDG_DESKTOP_DIR) and
#              ~/.local/share/applications.
#
#   scripts/install-shortcut.sh [--target DIR] [--print]
#
# --target DIR  put the shortcut there instead of the desktop (a Windows or
#               Linux path); --print  show what would be created, create nothing.
# Env: DTK_WSL_DISTRO (default $WSL_DISTRO_NAME, else Ubuntu).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target=""
print=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) target="${2:?--target needs a directory}"; shift 2 ;;
    --print) print=1; shift ;;
    -h|--help) sed -n 2,11p "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
  distro="${DTK_WSL_DISTRO:-${WSL_DISTRO_NAME:-Ubuntu}}"
  pwsh="$(command -v powershell.exe || echo /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe)"
  ps=("$pwsh" -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$here/studio-shortcut.ps1")"
      -Wsl -Distro "$distro" -WslScript "$here/studio-wsl.sh" -Icon "$(wslpath -w "$here/assets/datatoolkit.ico")")
  [ -z "$target" ] || ps+=(-Target "$target")
  [ "$print" = 0 ] || ps+=(-Print)
  exec "${ps[@]}"
fi

desktop_file() {
  cat <<DESK
[Desktop Entry]
Type=Application
Name=datatoolkit Studio
Comment=Start datatoolkit Studio (engine + browser); close the terminal to stop it
Exec=bash "$here/studio-wsl.sh"
Icon=$here/assets/datatoolkit.ico
Terminal=true
Categories=Development;Science;
DESK
}

if [ "$print" = 1 ]; then desktop_file; exit 0; fi
dirs=()
if [ -n "$target" ]; then dirs=("$target")
else dirs=("${XDG_DESKTOP_DIR:-$HOME/Desktop}" "$HOME/.local/share/applications"); fi
for d in "${dirs[@]}"; do
  mkdir -p "$d"
  desktop_file > "$d/datatoolkit-studio.desktop"
  chmod +x "$d/datatoolkit-studio.desktop"
  echo "Created $d/datatoolkit-studio.desktop"
done

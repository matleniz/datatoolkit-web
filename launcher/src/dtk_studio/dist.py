"""Studio build (``studio-dist.zip``): download, verify, cache.

The zip and its ``.sha256`` are assets of the immutable GitHub release
``studio-<sha7>`` of one web commit (``.github/workflows/studio-release.yml``),
pinned by the release step (``scripts/pin-release.py``). A verified build
is unpacked once under ``<data home>/studio/<sha256>/``; ``studio/current``
names the one in use and ``studio/source`` the URL it came from, so a build
cached from another source (an older pin, ``$DTK_STUDIO_URL``) is replaced.
``$DTK_STUDIO_URL`` overrides the base URL the two assets are fetched from
(any ``urllib`` URL, ``file://`` included: CI uses it).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_URL = "https://github.com/matleniz/datatoolkit-web/releases/download/studio-latest"
ZIP_NAME = "studio-dist.zip"


class DistError(Exception):
    """No usable Studio build (download failed and nothing cached)."""


def data_home() -> Path:
    """The engine's data home: ``$DTK_HOME``, default ``~/.datatoolkit``."""
    return Path(os.environ.get("DTK_HOME") or "~/.datatoolkit").expanduser()


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "dtk-studio"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def _cached(root: Path) -> Path | None:
    """The build named by ``root/current``, if it is still on disk."""
    try:
        sha = (root / "current").read_text().strip()
    except OSError:
        return None
    path = root / sha
    return path if sha and (path / "index.html").is_file() else None


def _source(root: Path) -> str:
    try:
        return (root / "source").read_text().strip()
    except OSError:
        return ""


def _activate(root: Path, sha: str, base: str) -> Path:
    """Point ``current`` at ``sha`` (from ``base``) and drop the other cached builds."""
    (root / "current").write_text(sha + "\n")
    (root / "source").write_text(base + "\n")
    for old in root.iterdir():
        if old.is_dir() and old.name != sha:
            shutil.rmtree(old, ignore_errors=True)
    return root / sha


def ensure_dist(refresh: bool = False, log=print) -> Path:
    """Directory holding Studio's ``index.html``, downloading it if needed.

    Without ``refresh`` a build cached from the same source is used as is (no
    network). With ``refresh``, with no cache, or with a cache from another
    source, the release's checksum is fetched and the
    zip downloaded unless that exact build is cached; offline, an existing
    cache is still used.
    """
    root = data_home() / "studio"
    cached = _cached(root)
    base = (os.environ.get("DTK_STUDIO_URL") or DEFAULT_URL).rstrip("/")
    if cached and not refresh and _source(root) == base:
        return cached
    try:
        sha = _fetch(f"{base}/{ZIP_NAME}.sha256").decode().split()[0].lower()
    except (OSError, IndexError, UnicodeDecodeError) as exc:
        if cached:
            log(f"Could not check for a newer Studio ({exc}); using the cached one.")
            return cached
        raise DistError(f"Could not download Studio from {base}: {exc}") from exc
    root.mkdir(parents=True, exist_ok=True)
    if (root / sha / "index.html").is_file():
        return _activate(root, sha, base)
    log(f"Downloading Studio ({ZIP_NAME}) from {base} ...")
    try:
        data = _fetch(f"{base}/{ZIP_NAME}")
    except OSError as exc:
        if cached:
            log(f"Could not download Studio ({exc}); using the cached one.")
            return cached
        raise DistError(f"Could not download Studio from {base}: {exc}") from exc
    if hashlib.sha256(data).hexdigest() != sha:
        if cached:
            log("The Studio download did not match its checksum; using the cached one.")
            return cached
        raise DistError(
            "The Studio download did not match its checksum (a new build may be "
            "being published). Try again in a minute."
        )
    tmp = Path(tempfile.mkdtemp(prefix=f"{sha}.", dir=root))
    try:
        zip_path = tmp / ZIP_NAME
        zip_path.write_bytes(data)
        out = tmp / "dist"
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(out)  # extractall drops absolute and ".." members
        if not (out / "index.html").is_file():
            raise DistError(f"{ZIP_NAME} has no index.html at its root.")
        out.rename(root / sha)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return _activate(root, sha, base)

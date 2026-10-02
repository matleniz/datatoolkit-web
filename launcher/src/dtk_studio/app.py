"""``dtk-studio``: Studio's static build + the engine API in one process.

One ASGI app on ``127.0.0.1`` only (the engine reads local files and SQL
URLs): the engine's ``create_app()`` answers ``/api/...``, every other path
is Studio's build with an SPA fallback to ``index.html``. Studio still talks
to the engine over HTTP (same origin, ``/api``), as behind nginx in Docker.
"""

from __future__ import annotations

import argparse
import os
import re
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse
from starlette.staticfiles import StaticFiles

from dtk_studio.dist import DistError, data_home, ensure_dist

HOST = "127.0.0.1"
PORT_TRIES = 20


def _loopback_host(scope) -> bool:
    """The request's Host passes the engine's UI-bridge rule (DNS-rebinding guard)."""
    from dtk_engine.ui_bridge import allowed_hosts, host_name

    host = dict(scope["headers"]).get(b"host", b"").decode("latin-1")
    return host_name(host) in allowed_hosts()


def with_ui_token(html: str, token: str) -> str:
    """``index.html`` with the bridge token handed to the page as a meta tag."""
    html = re.sub(r"<meta\s+name=[\"']dtk-ui-token[\"'][^>]*>", "", html)  # never keep a stale one
    meta = f'<meta name="dtk-ui-token" content="{token}" />'
    head = html.find("</head>")
    return meta + html if head < 0 else html[:head] + meta + html[head:]


class SPAStaticFiles(StaticFiles):
    """Static files; unknown paths outside ``/api`` get ``index.html``.

    With a ``token``, ``index.html`` carries it as ``<meta name="dtk-ui-token">``
    (the agent bridge's per-run token), but only for a loopback ``Host``, so a
    DNS-rebinding page cannot read it. Never cached.
    """

    def __init__(self, *args, token: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._token = token

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            response = None
        if response is None or response.status_code == 404:
            # Starlette hands over an OS path here ("api\\x" on Windows).
            if path.replace(os.sep, "/").split("/", 1)[0] == "api":
                raise HTTPException(status_code=404)
            path = "index.html"
            response = await super().get_response(path, scope)
        if (
            self._token
            and path.replace(os.sep, "/") in ("", ".", "index.html")
            and response.status_code == 200
            and _loopback_host(scope)
        ):
            html = (Path(self.directory) / "index.html").read_text(encoding="utf-8")
            return HTMLResponse(
                with_ui_token(html, self._token), headers={"Cache-Control": "no-store"}
            )
        return response


def build_app(dist: Path):
    """The engine app with Studio's build mounted under every non-API path."""
    from dtk_engine.http import create_app

    app = create_app()
    bridge = getattr(app.state, "ui_bridge", None)  # engines without the UI bridge: no token
    token = getattr(bridge, "token", None)
    app.mount("/", SPAStaticFiles(directory=dist, html=True, token=token), name="studio")
    return app


def _bind(port: int) -> socket.socket | None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name != "nt":
        # POSIX: lets a restart reuse a port in TIME_WAIT. On Windows the same
        # option would let us steal a port another process listens on.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((HOST, port))
    except OSError:
        sock.close()
        return None
    return sock


def bind_port(port: int) -> socket.socket:
    """A socket bound to ``port``, or to the next free one (said so)."""
    for candidate in range(port, min(port + PORT_TRIES, 65536)):
        sock = _bind(candidate)
        if sock is not None:
            if candidate != port:
                print(f"Port {port} is busy, using {candidate} instead.")
            return sock
    raise SystemExit(
        f"dtk-studio: ports {port}-{port + PORT_TRIES - 1} are all busy. "
        "Pick another one with --port."
    )


def _announce(port: int, open_browser: bool, timeout: float = 120) -> None:
    """Once ``/api/keys`` answers: print where things are, open the browser."""
    url = f"http://localhost:{port}"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"http://{HOST}:{port}/api/keys", timeout=5) as resp:
                if resp.status == 200:
                    break
        except OSError:
            pass
        time.sleep(0.5)
    else:
        print(f"dtk-studio: {url}/api/keys did not answer within {timeout:.0f}s.")
        return
    print()
    print(f"datatoolkit Studio is running: {url}")
    print(f"Your data (workspaces, uploads, Studio cache): {data_home()}")
    print("Ctrl+C to stop (closing this window stops it too).")
    sys.stdout.flush()
    if open_browser:
        webbrowser.open(url)


def main(argv: list[str] | None = None) -> None:
    """CLI entry: ``dtk-studio [--port PORT] [--no-open] [--refresh]``."""
    parser = argparse.ArgumentParser(
        prog="dtk-studio",
        description="datatoolkit Studio + engine on http://localhost (no Docker).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("DTK_PORT") or 8080),
        help="port on 127.0.0.1 (default: $DTK_PORT or 8080; next free one if busy)",
    )
    parser.add_argument("--no-open", action="store_true", help="do not open the browser")
    parser.add_argument("--refresh", action="store_true", help="download the latest Studio build")
    args = parser.parse_args(argv)
    if not 0 < args.port < 65536:
        parser.error(f"--port must be 1-65535, got {args.port}")

    try:
        dist = ensure_dist(refresh=args.refresh)
    except DistError as exc:
        raise SystemExit(f"dtk-studio: {exc}") from exc
    sock = bind_port(args.port)
    port = sock.getsockname()[1]
    url = f"http://localhost:{port}"
    print(f"Starting datatoolkit Studio on {url} ...")
    sys.stdout.flush()

    import uvicorn

    app = build_app(dist)
    threading.Thread(target=_announce, args=(port, not args.no_open), daemon=True).start()
    # Studio's SSE stream (/api/ui/events) would otherwise hold Ctrl+C open.
    config = uvicorn.Config(app, log_level="warning", timeout_graceful_shutdown=2)
    uvicorn.Server(config).run(sockets=[sock])


if __name__ == "__main__":
    main()

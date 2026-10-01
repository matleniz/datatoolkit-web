"""CI smoke test of the no-Docker launcher (dtk-studio, or the sh / ps1 uv mode).

    python scripts/smoke-uv-launcher.py [--port 8080] [--expect TEXT ...] -- CMD ...

Starts CMD, waits for ``/api/keys`` on 127.0.0.1:PORT, checks Studio's index,
a deep SPA route, the key list and a 404 under ``/api``, checks each
``--expect`` text is in CMD's output, then kills CMD's whole process tree
(uvx -> uv -> python) and checks the port is closed. Stdlib only.
"""

import argparse
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

TIMEOUT = 900  # first launch: uv fetches Python, the engine and its deps


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, ""


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def answered(base):
    try:
        return get(f"{base}/api/keys")[0] == 200
    except OSError:
        return False


def kill_tree(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], check=False)
    else:
        os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=30)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--expect", action="append", default=[])
    parser.add_argument("cmd", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    cmd = args.cmd[1:] if args.cmd[:1] == ["--"] else args.cmd
    base = f"http://127.0.0.1:{args.port}"

    # The child writes it through its own handle; we read it by path.
    log_path = os.path.join(tempfile.mkdtemp(), "launcher.log")
    log = open(log_path, "wb")  # noqa: SIM115 (closed after the kill)
    extra = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        if os.name == "nt"
        else {"start_new_session": True}
    )
    print("$", " ".join(cmd), flush=True)
    proc = subprocess.Popen(
        cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, **extra
    )
    failures = []
    try:
        deadline = time.monotonic() + TIMEOUT
        while True:
            if answered(base):
                break
            if proc.poll() is not None:
                failures.append(f"exited with {proc.returncode} before answering")
                break
            if "Studio is running: http://localhost:" in read(log_path) and not answered(base):
                failures.append(f"running, but not on port {args.port}")
                break
            if time.monotonic() > deadline:
                failures.append(f"no answer on {base}/api/keys within {TIMEOUT}s")
                break
            time.sleep(2)
        if not failures:
            time.sleep(1)  # let the "is running" banner reach the log
            checks = [
                ("/", 200, "datatoolkit Studio"),
                ("/some/deep/route", 200, "datatoolkit Studio"),
                ("/api/keys", 200, "dataset_overview"),
                ("/api/no-such-route", 404, ""),
            ]
            for path, status, text in checks:
                got, body = get(base + path)
                ok = got == status and text in body
                print(f"{'ok  ' if ok else 'FAIL'} GET {path} -> {got}", flush=True)
                if not ok:
                    failures.append(f"GET {path}: {got}, expected {status} with {text!r}")
    finally:
        kill_tree(proc)
        log.close()
        output = read(log_path)
        print("----- launcher output -----")
        print(output)
        print("---------------------------", flush=True)
    for text in args.expect:
        if text not in output:
            failures.append(f"output lacks {text!r}")
    try:
        get(f"{base}/")
        failures.append("still answering after the kill")
    except OSError:
        pass
    if failures:
        sys.exit("smoke failed: " + "; ".join(failures))
    print("smoke ok")


if __name__ == "__main__":
    main()

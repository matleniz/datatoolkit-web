"""Release step: pin the installers to one engine + Studio version.

    python3 scripts/pin-release.py [--engine REF] [--web REF] [--dry-run]

Resolves the engine (matleniz/datatoolkit) and the web (matleniz/datatoolkit-web)
REFs (default: each repo's ``main``) to commits, checks that what the
installers will fetch is published (GHCR images ``sha-<7>`` of both, the
``studio-<7>`` release of the web commit, made by the docker / studio-release
workflows on every push to main), then makes two commits on the current branch:

1. the pins: compose.yml (both images, the engine build source), the uv
   launcher's engine dependency (launcher/pyproject.toml) and its Studio build
   URL (launcher/src/dtk_studio/dist.py);
2. the sources: the sh / ps1 installers (and the by-hand commands in the docs)
   fetch compose.yml and launcher/ from commit 1.

The engine is pinned by a release tag when one points at its commit, else by
its full SHA (images are tagged by SHA only). Nothing is pushed. Stdlib + git.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE_REPO = "matleniz/datatoolkit"
WEB_REPO = "matleniz/datatoolkit-web"
HEX40 = re.compile(r"[0-9a-f]{40}")

# (file, pattern, replacement template). Each pattern must match at least once.
PINS = [
    ("compose.yml", r"(image: ghcr\.io/matleniz/datatoolkit-engine:)\S+", r"\g<1>sha-{e7}"),
    ("compose.yml", r"(build: https://github\.com/matleniz/datatoolkit\.git#)\S+", r"\g<1>{eref}"),
    ("compose.yml", r"(image: ghcr\.io/matleniz/datatoolkit-web:)\S+", r"\g<1>sha-{w7}"),
    (
        "launcher/pyproject.toml",
        r'("dtk-engine\[api,pdf\] @ git\+https://github\.com/matleniz/datatoolkit)(@[^"]*)?"',
        r'\g<1>@{eref}"',
    ),
    (
        "launcher/src/dtk_studio/dist.py",
        r'(DEFAULT_URL = "https://github\.com/matleniz/datatoolkit-web/releases/download/)[^"]+"',
        r'\g<1>studio-{w7}"',
    ),
]
SOURCES = [
    (
        name,
        r"(https://raw\.githubusercontent\.com/matleniz/datatoolkit-web/)[^/\s]+(/compose\.yml)",
        r"\g<1>{a}\g<2>",
    )
    for name in ("scripts/datatoolkit.sh", "scripts/datatoolkit.ps1", "docs/running.md")
] + [
    (
        name,
        r"(git\+https://github\.com/matleniz/datatoolkit-web)(@[0-9a-f]{40})?(#subdirectory=launcher)",
        r"\g<1>@{a}\g<3>",
    )
    for name in ("scripts/datatoolkit.sh", "scripts/datatoolkit.ps1", "docs/running.md")
]


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def resolve(repo: str, ref: str) -> tuple[str, str]:
    """(commit SHA, ref to pin by: a release tag on that commit, else the SHA)."""
    lines = git("ls-remote", f"https://github.com/{repo}").splitlines()
    refs = dict(reversed(line.split("\t")) for line in lines)
    if HEX40.fullmatch(ref):
        sha = ref
    else:
        sha = next(
            (
                refs[name]
                for name in (f"refs/tags/{ref}^{{}}", f"refs/tags/{ref}", f"refs/heads/{ref}")
                if name in refs
            ),
            None,
        )
        if sha is None:
            sys.exit(f"{repo}: no branch or tag named {ref!r}.")
    tags = sorted(
        name[len("refs/tags/") :].removesuffix("^{}")
        for name, target in refs.items()
        if name.startswith("refs/tags/")
        and target == sha
        and not name.startswith("refs/tags/studio-")
        and (name.endswith("^{}") or f"{name}^{{}}" not in refs)
    )
    return sha, (tags[-1] if tags else sha)


def ghcr_has(image: str, tag: str) -> bool:
    token_url = f"https://ghcr.io/token?scope=repository:{image}:pull"
    with urllib.request.urlopen(token_url, timeout=30) as resp:
        token = json.load(resp)["token"]
    req = urllib.request.Request(
        f"https://ghcr.io/v2/{image}/manifests/{tag}",
        method="HEAD",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.oci.image.index.v1+json, "
            "application/vnd.docker.distribution.manifest.list.v2+json, "
            "application/vnd.oci.image.manifest.v1+json, "
            "application/vnd.docker.distribution.manifest.v2+json",
        },
    )
    return url_ok(req)


def url_ok(req: urllib.request.Request | str) -> bool:
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status == 200
    except urllib.error.HTTPError:
        return False


def rewrite(rules, values: dict[str, str]) -> list[str]:
    """Apply the rules; returns the files that changed."""
    changed = []
    for name in dict.fromkeys(rule[0] for rule in rules):
        path = ROOT / name
        text = before = path.read_text(encoding="utf-8")
        for _, pattern, template in (r for r in rules if r[0] == name):
            text, n = re.subn(pattern, template.format(**values), text)
            if n == 0:
                sys.exit(f"{name}: no match for {pattern!r}; update scripts/pin-release.py.")
        if text != before:
            path.write_text(text, encoding="utf-8", newline="")
            changed.append(name)
    return changed


def commit(files: list[str], message: str) -> str:
    git("add", "--", *files)
    git("commit", "-q", "-m", message, "--", *files)
    return git("rev-parse", "HEAD")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--engine", default="main", help="engine branch, tag or SHA (main)")
    parser.add_argument("--web", default="main", help="web branch, tag or SHA (main)")
    parser.add_argument("--dry-run", action="store_true", help="resolve and check only")
    args = parser.parse_args()

    e, eref = resolve(ENGINE_REPO, args.engine)
    w, _ = resolve(WEB_REPO, args.web)
    values = {"e7": e[:7], "eref": eref, "w7": w[:7]}
    print(f"engine {ENGINE_REPO}@{eref} (commit {e}), web {WEB_REPO}@{w}")

    missing = [
        what
        for what, ok in [
            (
                f"ghcr.io/{ENGINE_REPO}-engine:sha-{e[:7]}",
                ghcr_has(f"{ENGINE_REPO}-engine", f"sha-{e[:7]}"),
            ),
            (f"ghcr.io/{WEB_REPO}:sha-{w[:7]}", ghcr_has(WEB_REPO, f"sha-{w[:7]}")),
            (
                f"release studio-{w[:7]}",
                url_ok(
                    f"https://github.com/{WEB_REPO}/releases/download/studio-{w[:7]}/studio-dist.zip.sha256"
                ),
            ),
        ]
        if not ok
    ]
    for what in missing:
        print(f"missing: {what}", file=sys.stderr)
    if missing:
        sys.exit(
            "Not published yet: wait for the docker / studio-release workflows of that "
            "commit (or run them: gh workflow run <name>.yml --ref main), then retry."
        )
    print("published: both images and the Studio build")
    if args.dry_run:
        return

    pinned = [
        n
        for n in dict.fromkeys(r[0] for r in PINS + SOURCES)
        if git("status", "--porcelain", "--", n)
    ]
    if pinned:
        sys.exit(f"Uncommitted changes in {', '.join(pinned)}: commit or discard them first.")
    files = rewrite(PINS, values)
    if files:
        a = commit(files, f"chore(release): pin engine {eref[:12]} and web {w[:7]}")
        print(f"pinned in {a[:7]}: {', '.join(files)}")
    else:
        a = git("log", "-1", "--format=%H", "--", *dict.fromkeys(r[0] for r in PINS))
        print(f"pins already at these versions (commit {a[:7]})")
    files = rewrite(SOURCES, {"a": a})
    if files:
        b = commit(
            files, f"chore(release): installers fetch compose.yml and launcher/ from {a[:7]}"
        )
        print(f"sources in {b[:7]}: {', '.join(files)}")
    else:
        print("installers already fetch from that commit")
    print("Next: push this branch and open a PR. The pinned commit must stay reachable:")
    print("merge it with a merge commit or a rebase, not a squash.")


if __name__ == "__main__":
    main()

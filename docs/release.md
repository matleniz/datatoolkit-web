# Release: pin the installers

The launchers install one version ([Pinned version](running.md#pinned-version)).
Moving that version is this release step, never a hand edit.
Back to the [README](../README.md).

## When

After the engine or Studio changes you want to ship are on `main` of
`matleniz/datatoolkit` and `matleniz/datatoolkit-web`, and the workflows of
those `main` commits have published:

- `ghcr.io/matleniz/datatoolkit-engine:sha-<7>` (engine repo's docker workflow);
- `ghcr.io/matleniz/datatoolkit-web:sha-<7>` (`docker.yml`, job `image`);
- the release `studio-<7>` (`studio-release.yml`).

## How

From an up-to-date checkout, on a new branch:

```bash
git switch -c release-pin origin/main
python3 scripts/pin-release.py --dry-run          # resolve + check what is published
python3 scripts/pin-release.py                    # two commits, nothing pushed
npm test -- installerPins                         # every pin names the same versions
```

`--engine REF` / `--web REF` (branch, tag or SHA; default `main`) pick other
commits. The script:

1. resolves both refs to commits; the engine is pinned by a release tag when
   one points at its commit, else by its full SHA (images are tagged by SHA);
2. stops if an image or the Studio release is missing (re-run the workflow:
   `gh workflow run studio-release.yml --ref main`);
3. commit 1 pins `compose.yml` (both images, engine build source),
   `launcher/pyproject.toml` (engine dependency) and
   `launcher/src/dtk_studio/dist.py` (Studio release URL);
4. commit 2 points `scripts/datatoolkit.sh` / `.ps1` and the by-hand commands
   in `docs/running.md` at commit 1.

Then push and open a PR. Merge it with a merge commit or a rebase, **not a
squash**: the installers fetch commit 1 by SHA, so it must stay on `main`.

`tests/installerPins.test.ts` (in `npm test`, so in the CHECK) fails if the
pins disagree or a rolling default (`:latest`, `#main`, `studio-latest`) comes
back.

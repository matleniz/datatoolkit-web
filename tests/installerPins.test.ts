// The installers install ONE version: every pin names the same engine commit
// and the same web commit, and nothing rolling (main, latest) is a default.
// The pins are written by scripts/pin-release.py, never by hand.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

const compose = read("compose.yml");
const pyproject = read("launcher/pyproject.toml");
const dist = read("launcher/src/dtk_studio/dist.py");
const sh = read("scripts/datatoolkit.sh");
const ps1 = read("scripts/datatoolkit.ps1");

const match = (text: string, re: RegExp) => {
  const m = text.match(re);
  expect(m, `${re} not found`).not.toBeNull();
  return m![1]!;
};

describe("installer pins", () => {
  it("compose.yml pins both images and the engine build to one commit each", () => {
    const engineImage = match(compose, /image: ghcr\.io\/matleniz\/datatoolkit-engine:(\S+)/);
    const engineBuild = match(compose, /build: https:\/\/github\.com\/matleniz\/datatoolkit\.git#(\S+)/);
    const webImage = match(compose, /image: ghcr\.io\/matleniz\/datatoolkit-web:(\S+)/);
    expect(engineImage).toMatch(/^sha-[0-9a-f]{7}$/);
    expect(webImage).toMatch(/^sha-[0-9a-f]{7}$/);
    expect(engineBuild).not.toBe("main");
    // A tag or the full SHA whose short form is the image tag.
    if (/^[0-9a-f]{40}$/.test(engineBuild)) expect(`sha-${engineBuild.slice(0, 7)}`).toBe(engineImage);
  });

  it("the uv launcher runs the same engine and the same Studio as the images", () => {
    const engineBuild = match(compose, /datatoolkit\.git#(\S+)/);
    const webImage = match(compose, /datatoolkit-web:sha-([0-9a-f]{7})/);
    expect(match(pyproject, /"dtk-engine\[api,pdf\] @ git\+https:\/\/github\.com\/matleniz\/datatoolkit@([^"]+)"/)).toBe(
      engineBuild,
    );
    expect(match(dist, /DEFAULT_URL = "https:\/\/github\.com\/matleniz\/datatoolkit-web\/releases\/download\/([^"]+)"/)).toBe(
      `studio-${webImage}`,
    );
  });

  it("sh and ps1 fetch compose.yml and launcher/ from one pinned commit", () => {
    const refs = [
      match(sh, /DEFAULT_COMPOSE_SRC="https:\/\/raw\.githubusercontent\.com\/matleniz\/datatoolkit-web\/([^/]+)\/compose\.yml"/),
      match(sh, /DEFAULT_LAUNCHER_SRC="git\+https:\/\/github\.com\/matleniz\/datatoolkit-web@([^#]+)#subdirectory=launcher"/),
      match(ps1, /\$DefaultComposeSrc = 'https:\/\/raw\.githubusercontent\.com\/matleniz\/datatoolkit-web\/([^/]+)\/compose\.yml'/),
      match(ps1, /\$DefaultLauncherSrc = 'git\+https:\/\/github\.com\/matleniz\/datatoolkit-web@([^#]+)#subdirectory=launcher'/),
    ];
    expect(new Set(refs).size).toBe(1);
    expect(refs[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("no rolling default is left", () => {
    for (const text of [compose, pyproject, dist]) {
      expect(text).not.toMatch(/:latest\b|#main\b|studio-latest"/);
    }
  });
});

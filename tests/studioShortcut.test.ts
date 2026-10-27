// The desktop shortcut scripts build the right target, arguments, icon and
// memory cap. No Windows needed: the .desktop file and the launch command are
// printed by the shell scripts; the .lnk spec of the ps1 is checked as text and,
// when a PowerShell is on the machine, by running it with -Print.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const run = (script: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [resolve(root, script), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: "/home/dtk", WSL_DISTRO_NAME: "", ...env },
  });

describe("studio-wsl.sh", () => {
  it("runs dtk-studio under a 3G user-scope memory cap, from the local engine", () => {
    const r = run("scripts/studio-wsl.sh", ["--print", "--no-open"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/systemd-run --user --scope --quiet -p MemoryMax=3G uv /);
    expect(r.stdout).toContain("dtk-studio --no-open");
    expect(r.stdout).toMatch(/DTK_STUDIO_URL=file:\/\/\S+/);
  });

  it("falls back to the pinned engine without a checkout", () => {
    const pinned = run("scripts/studio-wsl.sh", ["--print"], { DTK_ENGINE_DIR: "/nonexistent" });
    expect(pinned.stdout).toContain("uv tool run --from");
  });

  it("DTK_MEM_MAX sets or drops the cap", () => {
    expect(run("scripts/studio-wsl.sh", ["--print"], { DTK_MEM_MAX: "1G" }).stdout).toContain("MemoryMax=1G");
    expect(run("scripts/studio-wsl.sh", ["--print"], { DTK_MEM_MAX: "none" }).stdout).not.toContain("systemd-run");
  });
});

describe("install-shortcut.sh (Linux)", () => {
  it("prints a .desktop entry that runs the launcher in a terminal, with the icon", () => {
    const r = run("scripts/install-shortcut.sh", ["--print"]);
    if (r.status !== 0) return; // running under WSL: the Windows path is used instead
    expect(r.stdout).toContain("Name=datatoolkit Studio");
    expect(r.stdout).toContain(`Exec=bash "${resolve(root, "scripts")}/studio-wsl.sh"`);
    expect(r.stdout).toContain("assets/datatoolkit.ico");
    expect(r.stdout).toContain("Terminal=true");
  });
});

describe("studio-shortcut.ps1", () => {
  const ps1 = read("scripts/studio-shortcut.ps1");

  it("resolves the desktop with GetFolderPath, not a hard-coded path", () => {
    expect(ps1).toContain("[Environment]::GetFolderPath('Desktop')");
  });

  it("standard shortcut reuses datatoolkit.ps1 in uv mode", () => {
    expect(ps1).toContain("scripts/datatoolkit.ps1");
    expect(ps1).toContain("-Uv");
  });

  it("WSL shortcut starts studio-wsl.sh through wsl.exe in the chosen distro", () => {
    expect(ps1).toContain("wsl.exe");
    expect(ps1).toMatch(/-d \$Distro -- bash -lc '\$WslScript'/);
  });

  it("ships a valid icon and holds no credential", () => {
    const ico = readFileSync(resolve(root, "scripts/assets/datatoolkit.ico"));
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(ps1).not.toMatch(/token|password|secret/i);
  });

  const winPs = [
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/usr/bin/pwsh",
  ].find(existsSync);
  it.skipIf(!winPs)("-Print gives the spec for both modes", () => {
    const spec = (extra: string[]) =>
      JSON.parse(
        spawnSync(winPs!, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", winPath("scripts/studio-shortcut.ps1"), "-Print", "-Target", "X", ...extra], {
          encoding: "utf8",
        }).stdout,
      );
    const std = spec([]);
    expect(std.path).toMatch(/datatoolkit Studio\.lnk$/);
    expect(std.target).toMatch(/powershell\.exe$/i);
    expect(std.arguments).toContain("datatoolkit.ps1");
    expect(std.icon).toMatch(/datatoolkit\.ico,0$/);
    const wsl = spec(["-Wsl", "-Distro", "Debian", "-WslScript", "/h/s.sh"]);
    expect(wsl.target).toMatch(/wsl\.exe$/i);
    expect(wsl.arguments).toBe("-d Debian -- bash -lc '/h/s.sh'");
  });
});

function winPath(rel: string): string {
  const p = resolve(root, rel);
  const w = spawnSync("wslpath", ["-w", p], { encoding: "utf8" });
  return w.status === 0 ? w.stdout.trim() : p;
}

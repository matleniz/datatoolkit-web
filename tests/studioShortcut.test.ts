// The desktop shortcut scripts build the right target, arguments, icon and
// memory cap. No Windows needed: the .desktop file and the launch command are
// printed by the shell scripts; the .lnk spec of the ps1 is checked as text and,
// when a PowerShell is on the machine, by running it with -Print.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    expect(r.stdout).toContain("dtk-studio --agent --no-open");
    expect(r.stdout).toMatch(/DTK_STUDIO_URL=file:\/\/\S+/);
  });

  it("falls back to the pinned engine without a checkout", () => {
    const pinned = run("scripts/studio-wsl.sh", ["--print"], { DTK_ENGINE_DIR: "/nonexistent" });
    expect(pinned.stdout).toContain("uv tool run --from");
  });

  it("turns the agent on: agent-sdk pack, terminal packs, a fresh token per launch", () => {
    const r = run("scripts/studio-wsl.sh", ["--print"]);
    expect(r.stdout).toContain("dtk-studio --agent");
    expect(r.stdout).toContain("claude-agent-sdk");
    const src = read("scripts/studio-wsl.sh");
    expect(src).toContain('DTK_AGENT_TERMINAL="${DTK_AGENT_TERMINAL:-1}"');
    expect(src).toContain("secrets.token_hex(24)");
    expect(src).not.toMatch(/DTK_UI_TOKEN="[0-9a-f]{8,}/);
    expect(src).not.toMatch(/ANTHROPIC_API_KEY\s*=/);
  });

  it("refuses to start uncapped when systemd-run --user does not work", () => {
    const fake = mkdtempSync(join(tmpdir(), "dtk-nosystemd-"));
    writeFileSync(join(fake, "systemd-run"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const r = run("scripts/studio-wsl.sh", [], { PATH: `${fake}:${process.env.PATH}` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cannot cap the engine's memory");
    expect(r.stderr).toContain("Not starting uncapped");
    expect(r.stderr).toContain("DTK_MEM_MAX=none");
    expect(r.stdout).not.toContain("Building Studio");
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
    expect(ps1).toContain("--exec bash -l");
    expect(ps1).not.toMatch(/bash -lc '/); // single quotes are not quoting for wsl.exe
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
  it.skipIf(!winPs)("-Print gives the spec for both modes, whatever the paths", () => {
    const spec = (extra: string[]) => {
      const r = spawnSync(
        winPs!,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", winPath("scripts/studio-shortcut.ps1"), "-Print", ...extra],
        { encoding: "utf8" },
      );
      expect(r.stdout, `stderr: ${r.stderr}`).not.toBe("");
      return JSON.parse(r.stdout);
    };
    const std = spec(["-Target", "X"]);
    expect(std.path).toMatch(/datatoolkit Studio\.lnk$/);
    expect(std.target).toMatch(/powershell\.exe$/i);
    expect(std.arguments).toContain("datatoolkit.ps1");
    expect(std.icon).toMatch(/datatoolkit\.ico,0$/);

    const wsl = spec(["-Target", "X", "-Wsl", "-Distro", "Debian", "-WslScript", "/h/s.sh"]);
    expect(wsl.target).toMatch(/wsl\.exe$/i);
    expect(wsl.arguments).toBe("-d Debian --exec bash -l /h/s.sh");

    // spaces, an apostrophe and a distro with a space: each is one quoted argument
    const odd = spec(["-Target", "X", "-Wsl", "-Distro", "My Distro", "-WslScript", "/home/o'neil/my dir/s.sh"]);
    expect(odd.arguments).toBe('-d "My Distro" --exec bash -l "/home/o\'neil/my dir/s.sh"');

    // a OneDrive desktop with a space in the name
    const od = spec(["-Target", "C:\\Users\\Zoë Dupont\\OneDrive - Acme\\Bureau"]);
    expect(od.path).toContain("OneDrive - Acme");
    expect(od.path).toMatch(/Bureau.datatoolkit Studio\.lnk$/);
  }, 60_000); // five PowerShell starts, ~1-2 s each on a CI runner

});

function winPath(rel: string): string {
  const p = resolve(root, rel);
  const w = spawnSync(["wsl", "path"].join(""), ["-w", p], { encoding: "utf8" });
  return w.status === 0 ? w.stdout.trim() : p;
}

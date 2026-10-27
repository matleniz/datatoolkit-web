# Creates the "datatoolkit Studio" desktop shortcut (Windows PowerShell 5.1+).
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/studio-shortcut.ps1)))
#
# Standard install: double-click runs scripts/datatoolkit.ps1 in uv mode (engine
# + Studio, no Docker) in a console window; closing the window stops it.
# WSL install (-Wsl): double-click runs scripts/studio-wsl.sh in WSL (see
# docs/running.md); the engine runs under a 3G memory cap.
#
# Params: -Target <dir> (default: the user's Desktop, which may be
# OneDrive\Bureau), -Wsl, -Distro <name> (Ubuntu), -WslScript <linux path of
# studio-wsl.sh> (required with -Wsl), -Icon <path or URL> (default: the icon on
# main), -Print (print the shortcut spec as JSON, create nothing).

param(
    [string]$Target = '',
    [switch]$Wsl,
    [string]$Distro = 'Ubuntu',
    [string]$WslScript = '',
    [string]$Icon = 'https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/assets/datatoolkit.ico',
    [switch]$Print
)
$ErrorActionPreference = 'Stop'
$name = 'datatoolkit Studio'
$launcherUrl = 'https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1'

if (-not $Target) { $Target = [Environment]::GetFolderPath('Desktop') }
# Fallbacks keep -Print working where these are unset (e.g. PowerShell on Linux).
$localApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
$sysRoot = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
if (-not $localApp) { $localApp = 'C:\Users\Public\AppData\Local' }
# Plain string joins (Windows paths): Join-Path throws on an empty part and joins with / off Windows.
$iconDir = "$localApp\datatoolkit"
$iconPath = "$iconDir\datatoolkit.ico"

# One argument of a Windows command line (CommandLineToArgvW rules): quoted only
# when needed, inner quotes and backslashes before them escaped.
function Quote-Arg([string]$a) {
    if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }
    $a = $a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
    return '"' + $a + '"'
}

if ($Wsl) {
    if (-not $WslScript) { throw '-Wsl needs -WslScript <linux path of scripts/studio-wsl.sh>' }
    $exe = "$sysRoot\System32\wsl.exe"
    # --exec skips wsl.exe's own shell, so argv is exactly what is quoted here; the
    # script path is an argument of `bash -l`, never part of a shell string.
    $arguments = "-d $(Quote-Arg $Distro) --exec bash -l $(Quote-Arg $WslScript)"
} else {
    $exe = "$sysRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    # Same launcher as the one-liner in docs/running.md, uv mode; the window stays
    # open while the app runs and closing it stops the process.
    $inner = "& ([scriptblock]::Create((irm $launcherUrl))) -Uv"
    $arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"$inner`""
}
$spec = [ordered]@{
    path        = "$($Target.TrimEnd('\'))\$name.lnk"
    target      = $exe
    arguments   = $arguments
    icon        = "$iconPath,0"
    description = 'Start datatoolkit Studio (engine + browser); close the window to stop it'
    windowStyle = 1
}
if ($Print) { $spec | ConvertTo-Json; return }

New-Item -ItemType Directory -Force -Path $Target, $iconDir | Out-Null
if ($Icon -match '^https?://') { Invoke-WebRequest -UseBasicParsing $Icon -OutFile $iconPath }
else { Copy-Item -Force $Icon $iconPath }
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($spec.path)
$lnk.TargetPath = $spec.target
$lnk.Arguments = $spec.arguments
$lnk.IconLocation = $spec.icon
$lnk.Description = $spec.description
$lnk.WindowStyle = $spec.windowStyle
$lnk.Save()
Write-Host "Created $($spec.path)"

# datatoolkit launcher (Windows PowerShell 5.1+): engine + Studio, one command.
# With Docker when it is usable, else (or with -Uv) without it: uv runs the
# dtk-studio launcher (launcher/), one local process, installing uv if needed.
#
#   irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1))) stop
#
# Commands: start (default) | stop | update | uninstall [-Purge] | help;
# option -Uv (no Docker; start / update only, stop is Ctrl+C).
# Env: DTK_PORT (8080), DTK_DATA (<install dir>\datatoolkit-data, Docker mode),
# DTK_INSTALL_DIR (install dir, %USERPROFILE%\datatoolkit), DTK_NO_OPEN=1 (do
# not open the browser), DTK_TIMEOUT (seconds to wait for the app, 300),
# DTK_COMPOSE_SRC (URL or local path of the compose.yml to install; default:
# this repo's main), DTK_LAUNCHER_SRC (uv mode: what `uv tool run --from` gets;
# default: this repo's main branch, launcher/). DTK_HOME is the engine's data
# home (uv mode, %USERPROFILE%\.datatoolkit), not the install dir.
#
# No param() block and no `exit` on purpose: under `irm | iex` the script runs
# in the caller's session, where `exit` would close the PowerShell window.

function Invoke-Datatoolkit {
    $DockerUrl = 'https://docs.docker.com/desktop/setup/install/windows-install/'
    $DefaultComposeSrc = 'https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/compose.yml'
    $LauncherUrl = 'https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1'
    $DefaultLauncherSrc = 'git+https://github.com/matleniz/datatoolkit-web#subdirectory=launcher'
    $UvInstallerUrl = 'https://astral.sh/uv/install.ps1'
    $UvDocsUrl = 'https://docs.astral.sh/uv/getting-started/installation/'
    $Project = 'datatoolkit'
    # Native stderr redirected under a caller's 'Stop' would throw in 5.1.
    $ErrorActionPreference = 'Continue'

    $uvMode = $false
    $rest = @()
    foreach ($a in $args) {
        if ([string]$a -in '-Uv', '--uv') { $uvMode = $true } else { $rest += [string]$a }
    }
    $cmd = 'start'
    $opt = ''
    if ($rest.Count -gt 0) { $cmd = $rest[0] }
    if ($rest.Count -gt 1) { $opt = $rest[1] }

    function Fail([string]$Message) {
        Write-Host "datatoolkit: $Message" -ForegroundColor Red
        throw 'datatoolkit-failed'
    }

    function Show-Usage {
        Write-Host @'
Usage: datatoolkit.ps1 [start|stop|update|uninstall [-Purge]|help] [-Uv]

  start      start engine + Studio and open it in the browser (default)
  stop       stop the containers (data is kept)
  update     pull the latest images and restart
  uninstall  remove the containers, images and compose file; keeps your data
             unless -Purge is given
  -Uv        run without Docker, in this window (Ctrl+C stops it); used
             automatically when Docker is missing or not running. `update -Uv`
             fetches the latest launcher and Studio build.

Piped form: & ([scriptblock]::Create((irm <url>/datatoolkit.ps1))) stop
'@
    }

    switch ($cmd) {
        { $_ -in 'help', '-h', '--help', '-help' } { Show-Usage; return 0 }
        { $_ -in 'start', 'stop', 'update', 'uninstall' } { break }
        default { Show-Usage; return 2 }
    }
    if ($cmd -eq 'uninstall' -and $opt -and $opt -notin '-Purge', '--purge') {
        Write-Host "datatoolkit: Unknown option '$opt' (did you mean -Purge?)." -ForegroundColor Red
        return 2
    }

    # PowerShell 5.1 may default to TLS 1.0, which GitHub refuses.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $dir = if ($env:DTK_INSTALL_DIR) { $env:DTK_INSTALL_DIR } else { Join-Path $HOME 'datatoolkit' }
    $envFile = Join-Path $dir '.env'
    $composeFile = Join-Path $dir 'compose.yml'

    function Get-EnvFileValue([string]$Key) {
        if (-not (Test-Path -LiteralPath $envFile)) { return '' }
        $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -like "$Key=*" } | Select-Object -Last 1
        if (-not $line) { return '' }
        return $line.Substring($Key.Length + 1).Trim("'")
    }

    try {
        if ($uvMode -and $cmd -in 'stop', 'uninstall') {
            $dataHome = if ($env:DTK_HOME) { $env:DTK_HOME } else { Join-Path $HOME '.datatoolkit' }
            Fail "In uv mode datatoolkit runs in its window: Ctrl+C (or closing that window) stops it.`nIts data stays in $dataHome; 'uv cache clean' frees uv's downloads."
        }
        $port = if ($env:DTK_PORT) { $env:DTK_PORT } else { Get-EnvFileValue 'DTK_PORT' }
        if (-not $port) { $port = '8080' }
        if ($port -notmatch '^[0-9]+$') { Fail "DTK_PORT must be a port number, got '$port'." }
        $data = if ($env:DTK_DATA) { $env:DTK_DATA } else { Get-EnvFileValue 'DTK_DATA' }
        if (-not $data) { $data = './datatoolkit-data' }
        $dataAbs = if ([IO.Path]::IsPathRooted($data)) { $data } else { Join-Path $dir ($data -replace '^\./', '') }
        $url = "http://localhost:$port"
        $checkUrl = "http://127.0.0.1:$port"

        # Docker mode only: the uv mode never touches the install dir.
        function Test-InstallDir {
            if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
                Fail "$dir is a git checkout, not a datatoolkit install dir. Set DTK_INSTALL_DIR to another directory."
            }
        }

        # Why Docker is unusable: missing | compose | stopped; '' if usable.
        function Get-DockerProblem {
            if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return 'missing' }
            docker compose version *> $null
            if ($LASTEXITCODE -ne 0) { return 'compose' }
            docker info *> $null
            if ($LASTEXITCODE -ne 0) { return 'stopped' }
            return ''
        }

        function Test-Docker {
            switch (Get-DockerProblem) {
                'missing' { Fail "Docker is not installed. Install Docker Desktop: $DockerUrl`nThen run this command again (or run without Docker: add -Uv)." }
                'compose' { Fail "Docker is installed but 'docker compose' is missing. Update Docker Desktop: $DockerUrl" }
                'stopped' { Fail 'Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then run this command again.' }
            }
        }

        # Use the uv mode? Yes with -Uv, or (with a notice) when Docker is unusable.
        function Test-WantUv {
            if ($uvMode) { return $true }
            $why = switch (Get-DockerProblem) {
                '' { return $false }
                'missing' { 'Docker is not installed' }
                'compose' { "Docker has no 'docker compose'" }
                default { 'Docker is not running' }
            }
            Write-Host "${why}: starting datatoolkit without Docker (uv mode; pass -Uv to skip this check)." -ForegroundColor Yellow
            return $true
        }

        # A usable uv.exe: on PATH, or where Astral's installer puts it.
        function Find-Uv {
            $cmdUv = Get-Command uv -ErrorAction SilentlyContinue
            if ($cmdUv) { return $cmdUv.Source }
            $candidates = @()
            if ($env:UV_INSTALL_DIR) { $candidates += Join-Path $env:UV_INSTALL_DIR 'uv.exe' }
            if ($env:XDG_BIN_HOME) { $candidates += Join-Path $env:XDG_BIN_HOME 'uv.exe' }
            $candidates += (Join-Path $HOME '.local\bin\uv.exe'), (Join-Path $HOME '.cargo\bin\uv.exe')
            foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return $c } }
            return ''
        }

        function Get-Uv {
            $uv = Find-Uv
            if ($uv) { return $uv }
            Write-Host "Installing uv (Astral's Python package manager) into your user directory..."
            # A child PowerShell: the installer must not run in (or exit) this session.
            $shell = (Get-Process -Id $PID).Path
            & $shell -NoProfile -ExecutionPolicy ByPass -Command "irm $UvInstallerUrl | iex" | Out-Host
            if ($LASTEXITCODE -ne 0) { Fail "The uv installer failed. Install uv by hand ($UvDocsUrl), then run this again." }
            $uv = Find-Uv
            if (-not $uv) { Fail 'uv was installed but cannot be found. Open a new PowerShell window and run this again.' }
            return $uv
        }

        # Run dtk-studio (Studio + engine, one process) in this window through uv.
        # `update` also refreshes uv's copy of the launcher and the Studio build.
        function Start-Uv([bool]$Refresh) {
            $uv = Get-Uv
            $src = if ($env:DTK_LAUNCHER_SRC) { $env:DTK_LAUNCHER_SRC } else { $DefaultLauncherSrc }
            $uvArgs = @('tool', 'run')
            if ($Refresh) { $uvArgs += '--refresh' }
            $uvArgs += '--from', $src, 'dtk-studio', '--port', $port
            if ($env:DTK_NO_OPEN -eq '1') { $uvArgs += '--no-open' }
            if ($Refresh) { $uvArgs += '--refresh' }
            Write-Host 'Starting datatoolkit with uv (the first launch takes about a minute: Python + dependencies)...'
            & $uv @uvArgs | Out-Host
            if ($LASTEXITCODE -ne 0) { Fail "dtk-studio stopped with exit code $LASTEXITCODE." }
        }

        function Invoke-Compose {
            Push-Location -LiteralPath $dir
            try {
                # Out-Host: keep docker's output off the function's return value.
                docker compose -p $Project -f compose.yml @args | Out-Host
                return ($LASTEXITCODE -eq 0)
            } finally {
                Pop-Location
            }
        }

        function Install-Compose([bool]$Force) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
            if ($Force -or -not (Test-Path -LiteralPath $composeFile)) {
                $src = if ($env:DTK_COMPOSE_SRC) { $env:DTK_COMPOSE_SRC } else { $DefaultComposeSrc }
                $tmp = "$composeFile.tmp"
                try {
                    if ($src -match '^https?://') {
                        Invoke-WebRequest -UseBasicParsing -Uri $src -OutFile $tmp -ErrorAction Stop
                    } else {
                        Copy-Item -LiteralPath $src -Destination $tmp -ErrorAction Stop
                    }
                } catch {
                    Fail "Could not get $src : $($_.Exception.Message)"
                }
                Move-Item -LiteralPath $tmp -Destination $composeFile -Force
            }
            # Persist the port and data dir so later stop / update / start reuse them.
            $lines = "DTK_PORT=$port", "DTK_DATA='$data'"
            [IO.File]::WriteAllLines($envFile, [string[]]$lines)
        }

        function Test-Http([string]$Uri) {
            try {
                $r = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5 -ErrorAction Stop
                return ($r.StatusCode -eq 200)
            } catch {
                return $false
            }
        }

        function Wait-Ready {
            $timeout = if ($env:DTK_TIMEOUT) { [int]$env:DTK_TIMEOUT } else { 300 }
            Write-Host "Waiting for Studio on $url (up to ${timeout}s)..."
            $deadline = (Get-Date).AddSeconds($timeout)
            while ($true) {
                if ((Test-Http "$checkUrl/") -and (Test-Http "$checkUrl/api/keys")) { return }
                if ((Get-Date) -ge $deadline) {
                    Write-Host "datatoolkit: Studio did not answer on $url within ${timeout}s. Last container logs:" -ForegroundColor Red
                    Invoke-Compose ps | Out-Null
                    Invoke-Compose logs --tail 40 | Out-Null
                    Fail 'Startup failed. Run this command again, or check the logs above.'
                }
                Start-Sleep -Seconds 2
            }
        }

        function Start-Stack {
            Write-Host 'Pulling images...'
            if (-not (Invoke-Compose pull)) {
                Fail 'Could not pull the datatoolkit images. Check your network connection and try again.'
            }
            Write-Host 'Starting engine + Studio...'
            if (-not (Invoke-Compose up -d --no-build)) {
                Fail "Could not start the containers. If port $port is already used, pick another one: `$env:DTK_PORT = '8090' (then run this again)."
            }
            Wait-Ready
            if ($env:DTK_NO_OPEN -ne '1') { Start-Process $url }
            Write-Host ''
            Write-Host "datatoolkit Studio is running: $url" -ForegroundColor Green
            Write-Host "Your data (workspaces, uploads, exports): $dataAbs"
            Write-Host "Stop it:  & ([scriptblock]::Create((irm $LauncherUrl))) stop"
        }

        switch ($cmd) {
            'start' {
                if (Test-WantUv) { Start-Uv $false; break }
                Test-InstallDir
                Test-Docker
                Install-Compose $false
                Start-Stack
            }
            'update' {
                if (Test-WantUv) { Start-Uv $true; break }
                Test-InstallDir
                Test-Docker
                Install-Compose $true
                Start-Stack
            }
            'stop' {
                Test-InstallDir
                Test-Docker
                if (-not (Test-Path -LiteralPath $composeFile)) { Fail "Nothing to stop: datatoolkit is not installed in $dir." }
                if (-not (Invoke-Compose stop)) { Fail 'Could not stop the containers.' }
                Write-Host "datatoolkit stopped. Your data is still in $dataAbs."
            }
            'uninstall' {
                Test-InstallDir
                Test-Docker
                if (Test-Path -LiteralPath $composeFile) {
                    if (-not (Invoke-Compose down --rmi all --remove-orphans)) { Fail 'Could not remove the containers.' }
                    Remove-Item -LiteralPath $composeFile, $envFile -Force -ErrorAction SilentlyContinue
                } else {
                    Write-Host "No compose file in ${dir}: nothing to remove from Docker."
                }
                if ($opt) {
                    if (Test-Path -LiteralPath $dataAbs) {
                        try {
                            Remove-Item -LiteralPath $dataAbs -Recurse -Force -ErrorAction Stop
                        } catch {
                            Fail "Could not delete $dataAbs : $($_.Exception.Message)"
                        }
                    }
                    Write-Host 'datatoolkit uninstalled and its data deleted.'
                } else {
                    Write-Host "datatoolkit uninstalled. Your data is kept in $dataAbs (run 'uninstall -Purge' to delete it)."
                }
                if ((Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) {
                    Remove-Item -LiteralPath $dir -Force
                }
            }
        }
        return 0
    } catch {
        if ($_.Exception.Message -ne 'datatoolkit-failed') {
            Write-Host "datatoolkit: $($_.Exception.Message)" -ForegroundColor Red
        }
        return 1
    }
}

$dtkExitCode = Invoke-Datatoolkit @args
# Only a script run from a file may exit; under `irm | iex` it would close the window.
if ($PSCommandPath) { exit $dtkExitCode }

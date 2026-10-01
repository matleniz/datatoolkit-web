# datatoolkit launcher (Windows PowerShell 5.1+): engine + Studio with Docker, one command.
#
#   irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1))) stop
#
# Commands: start (default) | stop | update | uninstall [-Purge] | help
# Env: DTK_PORT (8080), DTK_DATA (<install dir>\datatoolkit-data), DTK_HOME
# (install dir, %USERPROFILE%\datatoolkit), DTK_NO_OPEN=1 (do not open the
# browser), DTK_TIMEOUT (seconds to wait for the app, 300), DTK_COMPOSE_SRC
# (URL or local path of the compose.yml to install; default: this repo's main).
#
# No param() block and no `exit` on purpose: under `irm | iex` the script runs
# in the caller's session, where `exit` would close the PowerShell window.

function Invoke-Datatoolkit {
    $DockerUrl = 'https://docs.docker.com/desktop/setup/install/windows-install/'
    $DefaultComposeSrc = 'https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/compose.yml'
    $LauncherUrl = 'https://raw.githubusercontent.com/matleniz/datatoolkit-web/main/scripts/datatoolkit.ps1'
    $Project = 'datatoolkit'
    # Native stderr redirected under a caller's 'Stop' would throw in 5.1.
    $ErrorActionPreference = 'Continue'

    $cmd = 'start'
    $opt = ''
    if ($args.Count -gt 0) { $cmd = [string]$args[0] }
    if ($args.Count -gt 1) { $opt = [string]$args[1] }

    function Fail([string]$Message) {
        Write-Host "datatoolkit: $Message" -ForegroundColor Red
        throw 'datatoolkit-failed'
    }

    function Show-Usage {
        Write-Host @'
Usage: datatoolkit.ps1 [start|stop|update|uninstall [-Purge]|help]

  start      start engine + Studio and open it in the browser (default)
  stop       stop the containers (data is kept)
  update     pull the latest images and restart
  uninstall  remove the containers, images and compose file; keeps your data
             unless -Purge is given

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

    $dir = if ($env:DTK_HOME) { $env:DTK_HOME } else { Join-Path $HOME 'datatoolkit' }
    $envFile = Join-Path $dir '.env'
    $composeFile = Join-Path $dir 'compose.yml'

    function Get-EnvFileValue([string]$Key) {
        if (-not (Test-Path -LiteralPath $envFile)) { return '' }
        $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -like "$Key=*" } | Select-Object -Last 1
        if (-not $line) { return '' }
        return $line.Substring($Key.Length + 1).Trim("'")
    }

    try {
        if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
            Fail "$dir is a git checkout, not a datatoolkit install dir. Set DTK_HOME to another directory."
        }
        $port = if ($env:DTK_PORT) { $env:DTK_PORT } else { Get-EnvFileValue 'DTK_PORT' }
        if (-not $port) { $port = '8080' }
        if ($port -notmatch '^[0-9]+$') { Fail "DTK_PORT must be a port number, got '$port'." }
        $data = if ($env:DTK_DATA) { $env:DTK_DATA } else { Get-EnvFileValue 'DTK_DATA' }
        if (-not $data) { $data = './datatoolkit-data' }
        $dataAbs = if ([IO.Path]::IsPathRooted($data)) { $data } else { Join-Path $dir ($data -replace '^\./', '') }
        $url = "http://localhost:$port"
        $checkUrl = "http://127.0.0.1:$port"

        function Test-Docker {
            if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
                Fail "Docker is not installed. Install Docker Desktop: $DockerUrl`nThen run this command again."
            }
            docker compose version *> $null
            if ($LASTEXITCODE -ne 0) {
                Fail "Docker is installed but 'docker compose' is missing. Update Docker Desktop: $DockerUrl"
            }
            docker info *> $null
            if ($LASTEXITCODE -ne 0) {
                Fail 'Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then run this command again.'
            }
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
                Test-Docker
                Install-Compose $false
                Start-Stack
            }
            'update' {
                Test-Docker
                Install-Compose $true
                Start-Stack
            }
            'stop' {
                Test-Docker
                if (-not (Test-Path -LiteralPath $composeFile)) { Fail "Nothing to stop: datatoolkit is not installed in $dir." }
                if (-not (Invoke-Compose stop)) { Fail 'Could not stop the containers.' }
                Write-Host "datatoolkit stopped. Your data is still in $dataAbs."
            }
            'uninstall' {
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

<#
Run Feedback locally without Docker: the API on port 8001 (local Postgres, stub model, dev
sign-in, email off) and the web app on port 3000, in one terminal. Ctrl+C stops both.
PowerShell twin of dev.sh. See README.md.

  .\dev.ps1

Needs: uv and Node.js. Installs the web packages on the first run.
#>
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$listening = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
foreach ($port in 8001, 3000) {
    if ($listening -contains $port) { Write-Host "STOP: port $port is in use. Stop that server first." -ForegroundColor Red; exit 1 }
}
if (-not (Test-Path web\node_modules)) {
    npm --prefix web ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$api = Start-Process uv -ArgumentList "--directory backend run python -m scripts.dev_server" -NoNewWindow -PassThru
$web = Start-Process npm.cmd -ArgumentList "--prefix web run dev" -NoNewWindow -PassThru
try {
    # Stop both when either exits (its error shows above) or on Ctrl+C.
    while (-not ($api.HasExited -or $web.HasExited)) { Start-Sleep -Milliseconds 500 }
} finally {
    foreach ($p in $api, $web) { if (-not $p.HasExited) { taskkill /PID $p.Id /T /F | Out-Null } }
}

<#
Deploy Feedback to staging or production on Cloud Run (spec v3 D25, D28 to D33; company
deployment manual §4 to §11, §45 to §47). PowerShell twin of deploy.sh. See docs/deployment.md.

  .\deploy.ps1 staging                build, push, deploy staging from the `staging` branch
  .\deploy.ps1 production             same for production from `main`, via a no-traffic candidate
  .\deploy.ps1 staging -ConfigOnly    no rebuild: re-apply configuration with the current images

Needs: git, docker, gcloud (signed in), and deploy\<env>.env filled in. Prints no secrets.
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet("staging", "production")][string]$EnvName,
    [switch]$ConfigOnly
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Stop-Deploy([string]$Message) { Write-Error "STOP: $Message"; exit 1 }

# Load deploy\<env>.env (KEY=value lines; # comments).
$envFile = "deploy\$EnvName.env"
$cfg = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $value = $line -split '=', 2
    $cfg[$key.Trim()] = $value.Trim()
}
if ((Get-Content $envFile -Raw) -match 'REPLACE') { Stop-Deploy "$envFile still has REPLACE values." }

# --- pre-deployment checks (manual §47) ---------------------------------------------------
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne $cfg.DEPLOY_BRANCH) { Stop-Deploy "$EnvName deploys from '$($cfg.DEPLOY_BRANCH)', you are on '$branch'." }
if (git status --porcelain) { Stop-Deploy "Uncommitted changes. Commit (after review) before deploying." }
$sha = (git rev-parse --short HEAD).Trim()
$tag = "$EnvName-$sha"
$registry = "$($cfg.REGION)-docker.pkg.dev/$($cfg.PROJECT_ID)/$($cfg.AR_REPO)"
$cfg.API_IMAGE = "$registry/feedback-api:$tag"
$cfg.WEB_IMAGE = "$registry/feedback-web:$tag"
gcloud projects describe $cfg.PROJECT_ID --format="value(projectId)" | Out-Null
if (-not $?) { Stop-Deploy "Can't reach project $($cfg.PROJECT_ID)." }
$gc = @("--project", $cfg.PROJECT_ID, "--region", $cfg.REGION)

if ($ConfigOnly) {
    $cfg.API_IMAGE = (gcloud run services describe $cfg.API_SERVICE @gc --format="value(spec.template.spec.containers[0].image)").Trim()
    $cfg.WEB_IMAGE = (gcloud run services describe $cfg.WEB_SERVICE @gc --format="value(spec.template.spec.containers[0].image)").Trim()
}

Write-Host "About to deploy Feedback"
Write-Host "  environment     $EnvName"
Write-Host "  branch / commit $branch / $sha"
Write-Host "  project         $($cfg.PROJECT_ID)"
Write-Host "  region          $($cfg.REGION)"
Write-Host "  services        $($cfg.API_SERVICE), $($cfg.WEB_SERVICE); job $($cfg.WORKER_JOB)"
Write-Host "  images          $($cfg.API_IMAGE)"
Write-Host "                  $($cfg.WEB_IMAGE)"
Write-Host "  database        $($cfg.CLOUDSQL_INSTANCE) (secret feedback-$EnvName-database-url)"
Write-Host "  bucket          $($cfg.GCS_BUCKET)"
Write-Host "  rebuild         $(if ($ConfigOnly) { 'no (configuration only)' } else { 'yes' })"
$answer = Read-Host "Type '$EnvName' to continue"
if ($answer -ne $EnvName) { Stop-Deploy "Cancelled." }

# --- build and push -------------------------------------------------------------------------
if (-not $ConfigOnly) {
    gcloud auth configure-docker "$($cfg.REGION)-docker.pkg.dev" --quiet
    docker build -t $cfg.API_IMAGE --label "project=feedback" --label "environment=$EnvName" --label "git-sha=$sha" backend
    docker build -t $cfg.WEB_IMAGE --label "project=feedback" --label "environment=$EnvName" --label "git-sha=$sha" web
    docker push $cfg.API_IMAGE
    docker push $cfg.WEB_IMAGE
}

# --- render the YAML for review -----------------------------------------------------------
$out = "deploy\rendered\$EnvName"
New-Item -ItemType Directory -Force $out | Out-Null
function Write-Rendered([string]$Template, [string]$Target) {
    $text = Get-Content $Template -Raw
    $missing = [regex]::Matches($text, '\$\{([A-Z_]+)\}') | ForEach-Object { $_.Groups[1].Value } | Where-Object { -not $cfg.ContainsKey($_) } | Sort-Object -Unique
    if ($missing) { Stop-Deploy "Missing values: $($missing -join ', ')" }
    $result = [regex]::Replace($text, '\$\{([A-Z_]+)\}', { param($m) $cfg[$m.Groups[1].Value] })
    [System.IO.File]::WriteAllText((Join-Path $PWD $Target), $result)
}
function Get-CurrentRevision([string]$Service) {
    try { (gcloud run services describe $Service @gc --format="value(status.traffic[0].revisionName)" 2>$null).Trim() } catch { "" }
}
function Get-TrafficBlock([string]$Current) {
    if ($EnvName -eq "production" -and $Current) {
        return "  traffic:`n    - revisionName: $Current`n      percent: 100`n    - latestRevision: true`n      percent: 0`n      tag: candidate"
    }
    return "  traffic:`n    - latestRevision: true`n      percent: 100"
}

$apiCurrent = Get-CurrentRevision $cfg.API_SERVICE
$webCurrent = Get-CurrentRevision $cfg.WEB_SERVICE
$cfg.TRAFFIC_BLOCK = Get-TrafficBlock $apiCurrent
Write-Rendered "deploy\api.service.yaml" "$out\api.service.yaml"
Write-Rendered "deploy\worker.job.yaml" "$out\worker.job.yaml"

# --- deploy the API and the worker job ------------------------------------------------------
gcloud run services replace "$out\api.service.yaml" @gc
gcloud run jobs replace "$out\worker.job.yaml" @gc
$cfg.API_URL = (gcloud run services describe $cfg.API_SERVICE @gc --format="value(status.url)").Trim()
$cfg.TRAFFIC_BLOCK = Get-TrafficBlock $webCurrent
Write-Rendered "deploy\web.service.yaml" "$out\web.service.yaml"
gcloud run services replace "$out\web.service.yaml" @gc

# --- scheduler: start the worker job every minute -------------------------------------------
$jobUri = "https://run.googleapis.com/v2/projects/$($cfg.PROJECT_ID)/locations/$($cfg.REGION)/jobs/$($cfg.WORKER_JOB):run"
gcloud scheduler jobs describe $cfg.SCHEDULER_JOB --project $cfg.PROJECT_ID --location $cfg.REGION 2>$null | Out-Null
$action = if ($?) { "update" } else { "create" }
gcloud scheduler jobs $action http $cfg.SCHEDULER_JOB --project $cfg.PROJECT_ID --location $cfg.REGION `
    --schedule "* * * * *" --time-zone "Australia/Sydney" --uri $jobUri --http-method POST `
    --oauth-service-account-email $cfg.SCHEDULER_SA

# --- verification (manual §45) ----------------------------------------------------------------
function Test-Health([string]$Url) {
    $body = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 30
    if ($body.database -ne "ok") { Stop-Deploy "Database not ok at $Url." }
    Write-Host "Health ok at $Url"
}
function Get-CandidateUrl([string]$Service) {
    $urls = (gcloud run services describe $Service @gc --format="value(status.traffic[].url)") -split ';'
    return $urls | Where-Object { $_ -match 'candidate' } | Select-Object -First 1
}
if ($EnvName -eq "production" -and $apiCurrent) {
    $apiCandidate = Get-CandidateUrl $cfg.API_SERVICE
    $webCandidate = Get-CandidateUrl $cfg.WEB_SERVICE
    if ($apiCandidate) { Test-Health $apiCandidate }
    if ($webCandidate) {
        Invoke-WebRequest -Uri "$webCandidate/" -TimeoutSec 30 -UseBasicParsing | Out-Null
        Write-Host "Web candidate loads at $webCandidate"
    }
    Write-Host "Note: until traffic moves, the web candidate still talks to the live API."
    Write-Host "Check the API candidate's health above, then the web candidate in a browser."
    $go = Read-Host "Move 100% of production traffic to the new revisions? Type 'yes'"
    if ($go -ne "yes") { Write-Host "Traffic left on $apiCurrent / $webCurrent."; exit 0 }
    gcloud run services update-traffic $cfg.API_SERVICE --to-latest @gc
    gcloud run services update-traffic $cfg.WEB_SERVICE --to-latest @gc
    Write-Host "Rollback if needed:"
    Write-Host "  gcloud run services update-traffic $($cfg.API_SERVICE) --to-revisions $apiCurrent=100 --project $($cfg.PROJECT_ID) --region $($cfg.REGION)"
    Write-Host "  gcloud run services update-traffic $($cfg.WEB_SERVICE) --to-revisions $webCurrent=100 --project $($cfg.PROJECT_ID) --region $($cfg.REGION)"
}
$webUrl = (gcloud run services describe $cfg.WEB_SERVICE @gc --format="value(status.url)").Trim()
Test-Health $webUrl
Write-Host "Deployed $tag. Finish the post-deployment verification in docs\deployment.md."

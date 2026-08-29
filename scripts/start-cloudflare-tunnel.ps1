param(
  [ValidateSet("production", "development")]
  [string]$Mode = "production",
  [ValidateRange(1024, 65535)]
  [int]$Port = 3010
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateDirectory = Join-Path $projectRoot ".tunnel"
$serverOutput = Join-Path $stateDirectory "server.out.log"
$serverError = Join-Path $stateDirectory "server.err.log"
$tunnelOutput = Join-Path $stateDirectory "cloudflared.out.log"
$tunnelError = Join-Path $stateDirectory "cloudflared.err.log"
$publicUrlFile = Join-Path $stateDirectory "public-url.txt"
$origin = "http://127.0.0.1:$Port"
$ownedServer = $null
$ownedTunnel = $null

function Resolve-Executable {
  param([string]$Name, [string[]]$Candidates)
  foreach ($candidate in $Candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Wait-ForResearchOps {
  param([string]$BaseUrl)
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 2
      if ($health.status -eq "healthy" -and $health.service -eq "research-ops") { return }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "ResearchOps did not become healthy at $BaseUrl. Read .tunnel/server.err.log for details."
}

function Test-ResearchOpsSurface {
  param(
    [string]$BaseUrl,
    [bool]$RequireAuth
  )

  $loginResponse = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/login" -TimeoutSec 8
  if ($loginResponse.StatusCode -ne 200 -or $loginResponse.Content -notmatch '<html') {
    throw "The login page did not return rendered HTML."
  }

  $styleMatch = [regex]::Match($loginResponse.Content, '(?:href|src)="([^"]+\.css(?:\?[^"]*)?)"')
  if (-not $styleMatch.Success) {
    throw "The login page did not reference a stylesheet."
  }

  $styleUrl = [Uri]::new([Uri]$BaseUrl, $styleMatch.Groups[1].Value).AbsoluteUri
  # Vite's development server serves a direct CSS module request as its
  # JavaScript HMR wrapper unless the request identifies itself as a browser
  # stylesheet fetch. Production assets are CSS either way.
  $styleResponse = Invoke-WebRequest -UseBasicParsing -Uri $styleUrl -Headers @{
    Accept = "text/css,*/*;q=0.1"
    "Sec-Fetch-Dest" = "style"
  } -TimeoutSec 8
  if ($styleResponse.StatusCode -ne 200 -or $styleResponse.Headers["Content-Type"] -notmatch 'text/css') {
    throw "The application stylesheet is not available."
  }

  if ($RequireAuth) {
    $authResponse = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/supabase/auth/v1/health" -TimeoutSec 8
    if ($authResponse.StatusCode -ne 200) {
      throw "The same-origin authentication gateway is not healthy."
    }
  }

  return $true
}

Set-Location $projectRoot
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Remove-Item -LiteralPath $serverOutput, $serverError, $tunnelOutput, $tunnelError, $publicUrlFile -Force -ErrorAction SilentlyContinue

# Production servers inherit Worker connection values from the process. Keep
# the parser intentionally narrow and never print secret values to the console.
foreach ($environmentFileName in @(".env.local", ".env", ".env.testing")) {
  $environmentFile = Join-Path $projectRoot $environmentFileName
  if (-not (Test-Path -LiteralPath $environmentFile)) { continue }
  foreach ($line in Get-Content -LiteralPath $environmentFile) {
    if ($line -notmatch '^\s*(SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|EVENT_INGESTION_SECRET|CPX_CALLBACK_SECRET|BITLABS_CALLBACK_SECRET|PURESPECTRUM_CALLBACK_SECRET|FRAUD_HASH_SECRET|DEV_AUTO_LOGIN)\s*=\s*(.*)\s*$') { continue }
    $variableName = $Matches[1]
    $variableValue = $Matches[2].Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($variableName, "Process")) {
      [Environment]::SetEnvironmentVariable($variableName, $variableValue, "Process")
    }
  }
}

$nodeDirectory = "C:\Program Files\nodejs"
if ((Test-Path -LiteralPath $nodeDirectory) -and -not (($env:Path -split ";") -contains $nodeDirectory)) {
  $env:Path = "$nodeDirectory;$env:Path"
}

$npm = Resolve-Executable -Name "npm" -Candidates @("C:\Program Files\nodejs\npm.cmd")
$npx = Resolve-Executable -Name "npx" -Candidates @("C:\Program Files\nodejs\npx.cmd")
$node = Resolve-Executable -Name "node" -Candidates @("C:\Program Files\nodejs\node.exe")
$vinextCli = Join-Path $projectRoot "node_modules\vinext\dist\cli.js"
$wranglerCli = Join-Path $projectRoot "node_modules\wrangler\bin\wrangler.js"
$cloudflared = Resolve-Executable -Name "cloudflared" -Candidates @(
  "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  "C:\Program Files\cloudflared\cloudflared.exe",
  (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\cloudflared.exe")
)

if (-not $npm) { throw "npm was not found. Install Node.js 22.13 or newer." }
if (-not $npx) { throw "npx was not found. Install Node.js 22.13 or newer." }
if (-not $node) { throw "node was not found. Install Node.js 22.13 or newer." }
if (-not (Test-Path -LiteralPath $vinextCli)) { throw "Dependencies are missing. Run npm install first." }
if (-not (Test-Path -LiteralPath $wranglerCli)) { throw "Wrangler is missing. Run npm install first." }
if (-not $cloudflared) { throw "cloudflared was not found. Install it with: winget install --id Cloudflare.cloudflared" }

if ($env:DEV_AUTO_LOGIN -eq "true" -and -not $env:DEV_AUTO_LOGIN_TOKEN) {
  $tokenBytes = New-Object byte[] 32
  $tokenGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $tokenGenerator.GetBytes($tokenBytes) } finally { $tokenGenerator.Dispose() }
  $env:DEV_AUTO_LOGIN_TOKEN = ([BitConverter]::ToString($tokenBytes) -replace "-", "").ToLowerInvariant()
}

# Local Supabase service credentials can rotate when the stack is recreated.
# Prefer the active value for this process without persisting or printing it.
try {
  $serviceCredentialRefreshed = $false
  # Windows PowerShell promotes native stderr to an ErrorRecord when the
  # script-wide preference is Stop. Supabase can emit harmless status notices
  # on stderr, so relax only this read-only probe and restore immediately.
  $previousErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $supabaseStatus = & $npx supabase status -o env 2>$null }
  finally { $ErrorActionPreference = $previousErrorPreference }
  foreach ($line in $supabaseStatus) {
    if ($line -match '^\s*SERVICE_ROLE_KEY="?([^"\r\n]+)"?\s*$') {
      $env:SUPABASE_SERVICE_ROLE_KEY = $Matches[1]
      $serviceCredentialRefreshed = $true
    }
  }
  if ($serviceCredentialRefreshed) { Write-Host "Active local Supabase service binding refreshed." -ForegroundColor DarkGray }
} catch {
  Write-Warning "The active local Supabase service binding could not be refreshed. Event ingestion may fail if .env.local is stale."
}

$quickTunnelConfigs = @(
  (Join-Path $env:USERPROFILE ".cloudflared\config.yml"),
  (Join-Path $env:USERPROFILE ".cloudflared\config.yaml")
) | Where-Object { Test-Path -LiteralPath $_ }
if ($quickTunnelConfigs.Count -gt 0) {
  throw "A cloudflared config file exists at $($quickTunnelConfigs[0]). Quick Tunnels cannot run while it is present. Use a named tunnel or temporarily move that config yourself."
}

try {
  if ($Mode -eq "production") {
    Write-Host "Building ResearchOps for the tunnel..." -ForegroundColor Cyan
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw "The production build failed." }
    # The built output targets Cloudflare Workers. Wrangler supplies runtime
    # bindings; vinext's plain Node production server does not.
    $serverEntry = $wranglerCli
    $serverArguments = @("dev", "--config", "dist/server/wrangler.json", "--port", "$Port", "--ip", "127.0.0.1")
    foreach ($variableName in @("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "EVENT_INGESTION_SECRET", "CPX_CALLBACK_SECRET", "BITLABS_CALLBACK_SECRET", "PURESPECTRUM_CALLBACK_SECRET", "FRAUD_HASH_SECRET", "DEV_AUTO_LOGIN", "DEV_AUTO_LOGIN_TOKEN")) {
      $variableValue = [Environment]::GetEnvironmentVariable($variableName, "Process")
      if ($variableValue) { $serverArguments += @("--var", "${variableName}:$variableValue") }
    }
  } else {
    $serverEntry = $vinextCli
    $serverArguments = @("dev", "--port", "$Port", "--host", "127.0.0.1", "--strictPort")
  }

  $existingHealthyServer = $false
  try {
    $existingHealth = Invoke-RestMethod -Uri "$origin/api/health" -TimeoutSec 2
    $existingHealthyServer = $existingHealth.status -eq "healthy" -and $existingHealth.service -eq "research-ops"
    if ($existingHealthyServer -and $env:SUPABASE_URL) {
      $existingReadiness = Invoke-RestMethod -Uri "$origin/api/readiness" -TimeoutSec 2
      $existingHealthyServer = $existingReadiness.database.status -eq "configured"
    }
  } catch {}

  if ($existingHealthyServer) {
    Write-Host "Using the ResearchOps server already running at $origin" -ForegroundColor DarkGray
  } else {
    $ownedServer = Start-Process -FilePath $node -ArgumentList (@($serverEntry) + $serverArguments) -PassThru -NoNewWindow -RedirectStandardOutput $serverOutput -RedirectStandardError $serverError
    Wait-ForResearchOps -BaseUrl $origin
    Write-Host "ResearchOps is healthy at $origin" -ForegroundColor Green
  }

  $readiness = Invoke-RestMethod -Uri "$origin/api/readiness" -TimeoutSec 5
  Write-Host "Application: $($readiness.application) | API: $($readiness.api) | Database: $($readiness.database.status)" -ForegroundColor Cyan
  if ($readiness.database.status -ne "configured") {
    Write-Warning "The tunnel will serve the current mock-data prototype. Configure Supabase before treating persistence as operational."
  }
  Test-ResearchOpsSurface -BaseUrl $origin -RequireAuth ($readiness.database.status -eq "configured") | Out-Null

  Write-Host "Starting Cloudflare Quick Tunnel. Press Ctrl+C to stop." -ForegroundColor Cyan
  $ownedTunnel = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--url", $origin) -PassThru -NoNewWindow -RedirectStandardOutput $tunnelOutput -RedirectStandardError $tunnelError

  $publicUrl = $null
  for ($attempt = 0; $attempt -lt 45 -and -not $publicUrl; $attempt++) {
    Start-Sleep -Seconds 1
    $logText = ((Get-Content -Raw -LiteralPath $tunnelOutput -ErrorAction SilentlyContinue) + "`n" + (Get-Content -Raw -LiteralPath $tunnelError -ErrorAction SilentlyContinue))
    $urlMatch = [regex]::Match($logText, "https://[-a-z0-9]+\.trycloudflare\.com")
    if ($urlMatch.Success) { $publicUrl = $urlMatch.Value }
    if ($ownedTunnel.HasExited) {
      throw "cloudflared exited before creating a tunnel. Read .tunnel/cloudflared.err.log for details."
    }
  }
  if (-not $publicUrl) { throw "Timed out waiting for the public Cloudflare URL." }
  Set-Content -LiteralPath $publicUrlFile -Value $publicUrl

  $publicHealthy = $false
  for ($attempt = 0; $attempt -lt 15 -and -not $publicHealthy; $attempt++) {
    try {
      $publicHealth = Invoke-RestMethod -Uri "$publicUrl/api/health" -TimeoutSec 5
      $publicHealthy =
        $publicHealth.status -eq "healthy" -and
        $publicHealth.service -eq "research-ops" -and
        (Test-ResearchOpsSurface -BaseUrl $publicUrl -RequireAuth ($readiness.database.status -eq "configured"))
    } catch { Start-Sleep -Seconds 1 }
  }
  Write-Host "Public ResearchOps URL: $publicUrl/projects" -ForegroundColor Green
  if ($env:DEV_AUTO_LOGIN -eq "true") {
    Write-Host "Protected owner testing link: $publicUrl/api/testing/enter?token=$($env:DEV_AUTO_LOGIN_TOKEN)" -ForegroundColor Yellow
    Write-Warning "Treat the protected testing link like a password. Normal tunnel visitors are not auto-logged in."
  }
  Write-Host "Public API health: $publicUrl/api/health" -ForegroundColor Green
  if ($publicHealthy) {
    Write-Host "Tunnel verified: UI assets, API, and authentication gateway are available. Keep this window open; press Ctrl+C to stop it." -ForegroundColor Cyan
  } else {
    Write-Warning "Cloudflare registered the tunnel, but this machine's DNS did not resolve the new hostname during the short propagation window. Open the printed URL manually after a moment."
  }
  Wait-Process -Id $ownedTunnel.Id
} finally {
  if ($ownedTunnel -and -not $ownedTunnel.HasExited) {
    Stop-Process -Id $ownedTunnel.Id -Force -ErrorAction SilentlyContinue
  }
  if ($ownedServer -and -not $ownedServer.HasExited) {
    Stop-Process -Id $ownedServer.Id -Force -ErrorAction SilentlyContinue
  }
}

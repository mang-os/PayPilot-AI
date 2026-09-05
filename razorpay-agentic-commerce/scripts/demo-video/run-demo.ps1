[CmdletBinding()]
param(
    [string]$FrontendUrl = "http://localhost:3000",
    [string]$BackendUrl = "http://localhost:8000",
    [ValidateSet("chrome", "msedge")]
    [string]$BrowserChannel = "chrome",
    [ValidateRange(1, 60)]
    [int]$PaymentTimeoutMinutes = 10
)

$ErrorActionPreference = "Stop"

function Assert-Reachable {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Name
    )

    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
            throw "HTTP $($response.StatusCode)"
        }
    }
    catch {
        throw "$Name is not reachable at $Uri. Start PayPilot AI before recording. $($_.Exception.Message)"
    }
}

Assert-Reachable -Uri $FrontendUrl -Name "Frontend"
Assert-Reachable -Uri "$($BackendUrl.TrimEnd('/'))/health" -Name "Backend health endpoint"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw "Node.js is required to run the Playwright recorder."
}

$playwrightPath = Join-Path $PSScriptRoot "node_modules\playwright-core"
if (-not (Test-Path -LiteralPath $playwrightPath -PathType Container)) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        throw "npm is required to install the Playwright recorder dependency."
    }
    Write-Host "Installing the local Playwright recorder dependency..."
    Push-Location $PSScriptRoot
    try {
        & $npmCommand.Source install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

$recordingScript = Join-Path $PSScriptRoot "record-demo.mjs"
$paymentTimeoutMs = $PaymentTimeoutMinutes * 60 * 1000
Write-Host "Starting the PayPilot AI browser recording..."
& $nodeCommand.Source $recordingScript `
    --base-url $FrontendUrl `
    --backend-url $BackendUrl `
    --browser-channel $BrowserChannel `
    --payment-timeout-ms $paymentTimeoutMs
if ($LASTEXITCODE -ne 0) {
    throw "Playwright recording failed with exit code $LASTEXITCODE"
}

& (Join-Path $PSScriptRoot "generate-voice.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Narration generation failed with exit code $LASTEXITCODE"
}

& (Join-Path $PSScriptRoot "build-video.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Final video build failed with exit code $LASTEXITCODE"
}

$finalPath = Join-Path $PSScriptRoot "output\paypilot-ai-demo.mp4"
Write-Host "PayPilot AI demo complete: $finalPath"

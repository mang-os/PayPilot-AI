[CmdletBinding()]
param(
    [string]$NarrationPath = (Join-Path $PSScriptRoot "narration.txt"),
    [string]$OutputPath = (Join-Path $PSScriptRoot "narration.wav")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $NarrationPath -PathType Leaf)) {
    throw "Narration file not found: $NarrationPath"
}

$narration = Get-Content -LiteralPath $NarrationPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($narration)) {
    throw "Narration file is empty: $NarrationPath"
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

Add-Type -AssemblyName System.Speech
$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()

try {
    $englishVoices = @(
        $synthesizer.GetInstalledVoices() |
            Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "en-*" }
    )
    if ($englishVoices.Count -eq 0) {
        throw "No enabled English Windows speech voice is installed."
    }

    $voicePreferences = @("Microsoft Zira", "Microsoft Ravi", "Microsoft David", "Microsoft Mark", "Microsoft Heera")
    $selectedVoice = $null
    foreach ($preferredName in $voicePreferences) {
        $selectedVoice = $englishVoices | Where-Object { $_.VoiceInfo.Name -eq $preferredName } | Select-Object -First 1
        if ($selectedVoice) { break }
    }
    if (-not $selectedVoice) {
        $selectedVoice = $englishVoices | Select-Object -First 1
    }

    $synthesizer.SelectVoice($selectedVoice.VoiceInfo.Name)
    $synthesizer.Rate = -1
    $synthesizer.Volume = 100
    $synthesizer.SetOutputToWaveFile($OutputPath)
    $synthesizer.Speak($narration)
    $synthesizer.SetOutputToNull()

    Write-Host "Narration generated with $($selectedVoice.VoiceInfo.Name): $OutputPath"
}
finally {
    $synthesizer.Dispose()
}

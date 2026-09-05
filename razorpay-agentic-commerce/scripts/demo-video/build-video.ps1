[CmdletBinding()]
param(
    [string]$RecordingPath,
    [string]$NarrationPath = (Join-Path $PSScriptRoot "narration.wav"),
    [string]$OutputPath = (Join-Path $PSScriptRoot "output\paypilot-ai-demo.mp4")
)

$ErrorActionPreference = "Stop"

$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCommand) {
    Write-Host "ffmpeg is required to build the final MP4. Install it with:"
    Write-Host "winget install Gyan.FFmpeg"
    exit 1
}

$ffprobeCommand = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffprobeCommand) {
    throw "ffprobe was not found beside ffmpeg. Reinstall ffmpeg with: winget install Gyan.FFmpeg"
}

if ([string]::IsNullOrWhiteSpace($RecordingPath)) {
    $recordingsDirectory = Join-Path $PSScriptRoot "recordings"
    $latestRecording = Get-ChildItem -LiteralPath $recordingsDirectory -Recurse -File -Filter "*.webm" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $latestRecording) {
        throw "No Playwright WebM recording was found under $recordingsDirectory"
    }
    $RecordingPath = $latestRecording.FullName
}

if (-not (Test-Path -LiteralPath $RecordingPath -PathType Leaf)) {
    throw "Playwright recording not found: $RecordingPath"
}
if (-not (Test-Path -LiteralPath $NarrationPath -PathType Leaf)) {
    throw "Narration audio not found: $NarrationPath"
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$videoDurationText = & $ffprobeCommand.Source -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- $RecordingPath
if ($LASTEXITCODE -ne 0) { throw "ffprobe could not inspect the Playwright recording." }
$audioDurationText = & $ffprobeCommand.Source -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -- $NarrationPath
if ($LASTEXITCODE -ne 0) { throw "ffprobe could not inspect the narration audio." }

$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$videoDuration = [double]::Parse(($videoDurationText | Select-Object -First 1).Trim(), $invariant)
$audioDuration = [double]::Parse(($audioDurationText | Select-Object -First 1).Trim(), $invariant)
$videoFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1"

if ($audioDuration -gt $videoDuration) {
    $padding = ($audioDuration - $videoDuration + 0.25).ToString("0.###", $invariant)
    $videoFilter += ",tpad=stop_mode=clone:stop_duration=$padding"
}

$filterGraph = "[0:v]$videoFilter[v];[1:a]apad[a]"
$ffmpegArguments = @(
    "-y",
    "-i", $RecordingPath,
    "-i", $NarrationPath,
    "-filter_complex", $filterGraph,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    $OutputPath
)

Write-Host "Building MP4 from: $RecordingPath"
& $ffmpegCommand.Source @ffmpegArguments
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed with exit code $LASTEXITCODE"
}

Write-Host "Final video: $OutputPath"

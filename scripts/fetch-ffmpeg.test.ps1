# Runs fetch-ffmpeg.ps1 against a source every download attempt fails on, and check-ffmpeg.ps1 on
# folders of empty files. DEVELOPMENT.md "Tests". Like any fetch, it clears src-tauri/target/ffmpeg-fetch.
# Usage: pwsh scripts/fetch-ffmpeg.test.ps1 <temp>   (CI passes the runner's temp)
param([Parameter(Mandatory)][string]$Temp)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Temp -PathType Container)) { throw "$Temp is not an existing folder" }
$script = Join-Path $PSScriptRoot 'fetch-ffmpeg.ps1'
$check = Join-Path $PSScriptRoot 'check-ffmpeg.ps1'
$tmp = Join-Path (Resolve-Path -LiteralPath $Temp) ("ffmpeg-test-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  $case = 'every attempt fails'
  $into = Join-Path $tmp 'into'
  $from = ([Uri](Join-Path $tmp 'ffmpeg.zip')).AbsoluteUri
  $lines = [Collections.Generic.List[string]]::new()
  $threw = $false
  try { & $script -From $from -Into $into -PauseSeconds 0 *>&1 | ForEach-Object { $lines.Add("$_") } }
  catch { $threw = $true; $lines.Add("$_") }
  $out = $lines -join "`n"
  if (-not $threw) { throw "FAIL ${case}: the script succeeded`n$out" }
  $retries = [regex]::Matches($out, 'Download attempt \d of 4 failed').Count
  if ($retries -ne 3) { throw "FAIL ${case}: it retried $retries times, not 3`n$out" }
  if (Get-ChildItem -LiteralPath $into -ErrorAction SilentlyContinue) { throw "FAIL ${case}: it left files in -Into`n$out" }
  Write-Host "ok $case"

  $cases = @(
    @{ Case = 'neither program'; Files = @(); Folders = @(); Missing = 'ffmpeg.exe' }
    @{ Case = 'no ffprobe'; Files = @('ffmpeg.exe'); Folders = @(); Missing = 'ffprobe.exe' }
    @{ Case = 'no ffmpeg'; Files = @('ffprobe.exe'); Folders = @(); Missing = 'ffmpeg.exe' }
    @{ Case = 'ffprobe a folder'; Files = @('ffmpeg.exe'); Folders = @('ffprobe.exe'); Missing = 'ffprobe.exe' }
    @{ Case = 'both programs'; Files = @('ffmpeg.exe', 'ffprobe.exe'); Folders = @(); Missing = $null }
  )
  $n = 0
  foreach ($c in $cases) {
    $case = "check-ffmpeg with $($c.Case)"
    $n++
    $folder = Join-Path $tmp "check-$n"
    New-Item -ItemType Directory -Path $folder | Out-Null
    foreach ($f in $c.Files) { New-Item -ItemType File -Path (Join-Path $folder $f) | Out-Null }
    foreach ($f in $c.Folders) { New-Item -ItemType Directory -Path (Join-Path $folder $f) | Out-Null }
    $message = $null
    try { & $check -In $folder } catch { $message = "$_" }
    if ($c.Missing) {
      if (-not $message) { throw "FAIL ${case}: it passed" }
      if (-not $message.StartsWith("$($c.Missing) is not a file")) { throw "FAIL ${case}: it said $message" }
    } elseif ($message) {
      throw "FAIL ${case}: it threw $message"
    }
    Write-Host "ok $case"
  }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

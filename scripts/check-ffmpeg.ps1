# Throws unless ffmpeg.exe and ffprobe.exe are files in -In. fetch-ffmpeg.ps1 runs it after copying.
# Usage: pwsh scripts/check-ffmpeg.ps1 -In <folder>
param([Parameter(Mandatory)][string]$In)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

foreach ($program in 'ffmpeg.exe', 'ffprobe.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $In $program) -PathType Leaf)) {
    throw "$program is not a file in $In."
  }
}

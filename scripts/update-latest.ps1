# Unpacks the newest Nightly Filmstrip.zip into latest\, beside the data\ folder it keeps there,
# so the index, thumbnails and trash carry over from build to build.
#
#   pwsh scripts/update-latest.ps1            # Nightly
#   pwsh scripts/update-latest.ps1 v0.2.0     # a tagged release
param([string]$Tag = 'nightly')

$ErrorActionPreference = 'Stop'
$latest = Join-Path (Split-Path -Parent $PSScriptRoot) 'latest'
New-Item -ItemType Directory -Force -Path $latest | Out-Null

if (Get-Process -Name Filmstrip -ErrorAction SilentlyContinue) {
  throw 'Filmstrip is running; close it first.'
}
gh release download $Tag --repo darthbirb/filmstrip --pattern Filmstrip.zip --dir $latest --clobber
$zip = Join-Path $latest 'Filmstrip.zip'
try {
  Expand-Archive -Path $zip -DestinationPath $latest -Force
} finally {
  Remove-Item -LiteralPath $zip -ErrorAction SilentlyContinue
}
Write-Host "latest\Filmstrip.exe and its tools\ are now $Tag."

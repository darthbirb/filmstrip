# Puts the newest Nightly Filmstrip.exe in latest\, beside the data\ folder it keeps there,
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
gh release download $Tag --repo darthbirb/filmstrip --pattern Filmstrip.exe --dir $latest --clobber
Write-Host "latest\Filmstrip.exe is now $Tag."

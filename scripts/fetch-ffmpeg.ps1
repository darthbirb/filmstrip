# Fetches the ffmpeg build the release carries, refuses it unless its SHA-256 matches, and puts
# ffmpeg.exe, ffprobe.exe and their licence notice in a tools folder. DECISIONS.md "Video and ffmpeg".
#
#   pwsh scripts/fetch-ffmpeg.ps1                                     # target\tools, for the tests
#   pwsh scripts/fetch-ffmpeg.ps1 -Into src-tauri\target\debug\tools  # beside the tauri dev build
param([string]$Into = (Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\target\tools'))

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$version = '9.0.2'
$name = "ffmpeg-$version-essentials_build"
$url = "https://github.com/GyanD/codexffmpeg/releases/download/$version/$name.zip"
$sha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'

$notice = @"
ffmpeg.exe and ffprobe.exe are FFmpeg $version, the "essentials" build by Gyan Doshi
(https://www.gyan.dev/ffmpeg/builds/), unmodified, from
$url
SHA-256 $sha256

They are licensed under the GNU General Public License, version 3: see ffmpeg-LICENSE.txt.
ffmpeg-README.txt lists the configuration and the libraries the build includes.
FFmpeg's source for this version: https://ffmpeg.org/releases/ffmpeg-$version.tar.xz
The libraries' sources are linked from https://www.gyan.dev/ffmpeg/builds/

Filmstrip starts these programs and does not link to them.
"@

$Into = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Into)
$noticeFile = Join-Path $Into 'ffmpeg-NOTICE.txt'
$have = (Test-Path $noticeFile) -and
  (Test-Path (Join-Path $Into 'ffmpeg.exe')) -and (Test-Path (Join-Path $Into 'ffprobe.exe'))
if ($have -and (Get-Content $noticeFile -Raw) -eq $notice) {
  Write-Host "ffmpeg $version is already in $Into."
  exit 0
}

$work = Join-Path (Split-Path -Parent $PSScriptRoot) 'src-tauri\target\ffmpeg-fetch'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work, $Into | Out-Null
try {
  $zip = Join-Path $work "$name.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if ($actual -ne $sha256) {
    throw "$name.zip has SHA-256 $actual, not the pinned $sha256; refusing it."
  }
  Expand-Archive -Path $zip -DestinationPath $work
  $build = Join-Path $work $name
  $from = @{
    'ffmpeg.exe'         = 'bin\ffmpeg.exe'
    'ffprobe.exe'        = 'bin\ffprobe.exe'
    'ffmpeg-LICENSE.txt' = 'LICENSE'
    'ffmpeg-README.txt'  = 'README.txt'
  }
  foreach ($to in $from.Keys) {
    Copy-Item -LiteralPath (Join-Path $build $from[$to]) -Destination (Join-Path $Into $to) -Force
  }
  Set-Content -LiteralPath $noticeFile -Value $notice -NoNewline
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Get-ChildItem -LiteralPath $Into | ForEach-Object {
  '{0,-20} {1,8:N1} MB' -f $_.Name, ($_.Length / 1MB)
} | Write-Host
Write-Host "ffmpeg $version is in $Into."

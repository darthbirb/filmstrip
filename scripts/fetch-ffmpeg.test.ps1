# Runs fetch-ffmpeg.ps1 against a server on 127.0.0.1 and a port nothing listens on, so nothing
# is downloaded. DEVELOPMENT.md "Tests".
# Usage: pwsh scripts/fetch-ffmpeg.test.ps1 <temp>   (CI passes the runner's temp)
param([Parameter(Mandatory)][string]$Temp)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Temp -PathType Container)) { throw "$Temp is not an existing folder" }
$script = Join-Path $PSScriptRoot 'fetch-ffmpeg.ps1'
$tmp = Join-Path (Resolve-Path -LiteralPath $Temp) ("ffmpeg-test-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null

function Fetch([string]$from, [string]$into) {
  $out = & pwsh -NoProfile -NonInteractive -File $script -From $from -Into $into -PauseSeconds 0 2>&1 | Out-String
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

function Check([string]$case, [bool]$ok, [string]$why, [string]$out) {
  if (-not $ok) { throw "FAIL ${case}: $why`n$out" }
}

$server = {
  param($listener, $failures)
  $served = 0
  while ($true) {
    try { $client = $listener.AcceptTcpClient() } catch { break }
    $served++
    $stream = $client.GetStream()
    $reader = [IO.StreamReader]::new($stream)
    while ($reader.ReadLine()) {}
    $status = if ($served -le $failures) { '503 Service Unavailable' } else { '200 OK' }
    $body = [Text.Encoding]::ASCII.GetBytes('not ffmpeg')
    $head = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n")
    $stream.Write($head, 0, $head.Length)
    $stream.Write($body, 0, $body.Length)
    $stream.Flush()
    $client.Close()
  }
  $served
}

$listener = $null
$job = $null
try {
  $case = 'two failures, then the wrong file'
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $job = Start-ThreadJob -ScriptBlock $server -ArgumentList $listener, 2
  $into = Join-Path $tmp 'served'
  $run = Fetch "http://127.0.0.1:$port/ffmpeg.zip" $into
  $listener.Stop()
  $served = Receive-Job $job -Wait -AutoRemoveJob
  $job = $null
  Check $case ($run.Code -ne 0) 'the script succeeded' $run.Out
  Check $case ($served -eq 3) "the server answered $served requests, not 3" $run.Out
  Check $case ($run.Out -match 'Download attempt 2 of 4 failed') 'it did not retry after the second failure' $run.Out
  Check $case ($run.Out -match 'refusing it') 'it did not refuse the wrong SHA-256' $run.Out
  Check $case (-not (Get-ChildItem -LiteralPath $into -ErrorAction SilentlyContinue)) 'it left files in -Into' $run.Out
  Write-Host "ok $case"

  $case = 'nothing listening'
  $into = Join-Path $tmp 'refused'
  $run = Fetch "http://127.0.0.1:$port/ffmpeg.zip" $into
  Check $case ($run.Code -ne 0) 'the script succeeded' $run.Out
  Check $case (([regex]::Matches($run.Out, 'Download attempt \d of 4 failed')).Count -eq 3) 'it did not try four times' $run.Out
  Check $case (-not (Get-ChildItem -LiteralPath $into -ErrorAction SilentlyContinue)) 'it left files in -Into' $run.Out
  Write-Host "ok $case"
} finally {
  if ($listener) { $listener.Stop() }
  if ($job) { Remove-Job $job -Force }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

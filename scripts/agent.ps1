# Works the issue queue on this machine: one fresh Claude Code session per issue, each taken
# from ready to merged by the deliver skill, until nothing is left that a session can take.
# DEVELOPMENT.md "Running the queue".
#
#   pwsh scripts/agent.ps1            # until the queue is empty
#   pwsh scripts/agent.ps1 -Max 3     # at most three sessions
#
# Sessions run with every permission (bypassPermissions); the deny rules in
# .claude/settings.json still hold. A session that fails, usually a usage limit, is retried
# after -WaitMinutes, at most -Retries times in a row.
param(
  [int]$Max = 0,
  [int]$WaitMinutes = 30,
  [int]$Retries = 6
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$prompt = @'
Use the deliver skill: take the next ready issue to merged. If no issue is ready but some wait
on design, use the design-pass skill for them instead. Work without asking; label needs-human
only where the deliver skill says to.
'@

# Open issues a session could act on: ready to build, or waiting to be drawn.
function Get-Workable {
  $query = '[.[] | select([.labels[].name] as $l | ($l | index("ready") or index("design"))' +
    ' and ($l | index("in-progress") or index("blocked") or index("needs-human") | not))] | length'
  [int](gh issue list --state open --limit 200 --json labels --jq $query)
}

$sessions = 0
$failures = 0
while ($Max -eq 0 -or $sessions -lt $Max) {
  $workable = Get-Workable
  if ($workable -eq 0) {
    Write-Host 'Nothing is ready or waiting on design. Done.'
    break
  }
  Write-Host "$workable issues workable; starting session $($sessions + 1)."
  claude -p $prompt --permission-mode bypassPermissions
  if ($LASTEXITCODE -eq 0) {
    $sessions++
    $failures = 0
    continue
  }
  $failures++
  if ($failures -gt $Retries) {
    Write-Host "The session failed $failures times in a row; stopping."
    exit 1
  }
  Write-Host "The session failed (exit $LASTEXITCODE); trying again in $WaitMinutes minutes."
  Start-Sleep -Seconds ($WaitMinutes * 60)
}

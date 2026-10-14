#!/usr/bin/env bash
# A reviewer's worktree under the main checkout's .claude/worktrees. DEVELOPMENT.md "Review".
# Usage: scripts/review-worktree.sh open <n> <sha> | close <n>
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 open <n> <sha> | close <n>" >&2; exit 2; }
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
wt="$main/.claude/worktrees/review-$2"
modules="$wt/node_modules"

close() {
  # rmdir takes off the junction alone; rm -r, or a trailing slash, empties the checkout's modules.
  if [ -L "$modules" ] || [ -e "$modules" ]; then cmd //c rmdir "$(cygpath -w "$modules")"; fi
  git -C "$main" worktree remove --force "$wt" 2>/dev/null || true
  # Capture before grep: under pipefail, `git ... | grep -q` can fail on SIGPIPE and read as unregistered.
  local listed
  listed=$(git -C "$main" worktree list --porcelain)
  if [ -e "$wt" ] && [ ! -L "$modules" ] && [ ! -e "$modules" ] &&
    ! grep -Fxqi "worktree $wt" <<<"$listed"; then
    # PowerShell 7's Remove-Item takes off a link without following it; Windows PowerShell 5.1 follows.
    FILMSTRIP_WT="\\\\?\\$(cygpath -w "$wt")" pwsh -NoProfile -NonInteractive -Command \
      'Remove-Item -LiteralPath $env:FILMSTRIP_WT -Recurse -Force' || true
  fi
  git -C "$main" worktree prune
  listed=$(git -C "$main" worktree list --porcelain)
  if [ -e "$wt" ] || grep -Fxqi "worktree $wt" <<<"$listed"; then
    echo "$wt is still there or still registered with git; remove it by hand" >&2
    exit 1
  fi
}

case "$1" in
  open)
    [ $# -eq 3 ] || { echo "usage: $0 open <n> <sha>" >&2; exit 2; }
    close
    git -C "$main" worktree add --quiet --detach "$wt" "$3"
    if git -C "$main" diff --quiet "$3" -- package.json pnpm-lock.yaml; then
      cmd //c mklink //J "$(cygpath -w "$modules")" "$(cygpath -w "$main/node_modules")" >/dev/null
      echo "$wt: node_modules linked"
    else
      echo "$wt: its dependencies differ from the checkout's; run no frontend gates here, CI runs them"
    fi
    ;;
  close) close ;;
  *) echo "usage: $0 open <n> <sha> | close <n>" >&2; exit 2 ;;
esac

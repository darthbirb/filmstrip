#!/usr/bin/env bash
# A reviewer's worktree under the main checkout's .claude/worktrees. DEVELOPMENT.md "Review".
# Usage: scripts/review-worktree.sh open <n> <sha> | close <n>
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 open <n> <sha> | close <n>" >&2; exit 2; }
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
wt="$main/.claude/worktrees/review-$2"
modules="$wt/node_modules"

# Any spelling of a path under $main/.claude/worktrees: C:\x, C:/x, C:\\x, /c/x, /proc/cygdrive/c/x.
under=$(printf '%s' "${main#?:}/.claude/worktrees/" |
  sed -e 's/[][\.*^$+?(){}|]/\\&/g' -e 's|/|[\\/]+|g')
under="(^|[^[:alnum:]])${main%%:*}:?$under"

# What in the checkout's node_modules names a worktree: a link into one, or pnpm's state or shims.
named() {
  local nm="$main/node_modules"
  [ -d "$nm" ] || return 0
  find "$nm" -maxdepth 5 -type l -printf '%l\t%p\n' | grep -iE "^$under" |
    awk -F '\t' '{ print $2 " -> " $1 }' || true
  grep -lisE "$under" "$nm"/.modules.yaml "$nm"/.pnpm-workspace-state*.json "$nm"/.bin/* || true
}

close() {
  local found
  found=$(named)
  if [ -n "$found" ]; then
    printf '%s\n' "$main/node_modules names a worktree, so a package manager ran through one:" \
      "$found" "Nothing was removed. Run 'npx --yes pnpm@12.4.1 install --frozen-lockfile' in" \
      "$main to relink it, then run this again." >&2
    exit 1
  fi
  # rmdir takes off the junction alone; rm -r, or a trailing slash, empties the checkout's modules.
  if [ -L "$modules" ]; then cmd //c rmdir "$(cygpath -w "$modules")"; fi
  git -C "$main" worktree remove --force "$wt" 2>/dev/null || true
  # Capture before grep: under pipefail, `git ... | grep -q` can fail on SIGPIPE and read as unregistered.
  local listed
  listed=$(git -C "$main" worktree list --porcelain)
  if [ -e "$wt" ] && [ ! -L "$modules" ] && ! grep -Fxqi "worktree $wt" <<<"$listed"; then
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
      echo "$wt: packages resolve from $main/node_modules; run frontend gates with npm run, never pnpm"
    else
      echo "$wt: its dependencies differ from the checkout's; run no frontend gates here, CI runs them"
    fi
    ;;
  close) close ;;
  *) echo "usage: $0 open <n> <sha> | close <n>" >&2; exit 2 ;;
esac

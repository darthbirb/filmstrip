#!/usr/bin/env bash
# Runs review-worktree.sh against a throwaway clone made under <temp>. DEVELOPMENT.md "Review".
# Usage: scripts/review-worktree.test.sh <temp>   (CI passes the runner's temp)
set -euo pipefail

[ $# -eq 1 ] && [ -d "$1" ] || { echo "usage: $0 <existing temp folder>" >&2; exit 2; }
script="$(cd "$(dirname "$0")" && pwd)/review-worktree.sh"
repo=$(git -C "$(dirname "$script")" rev-parse --show-toplevel)
tmp=$(cygpath -m "$(mktemp -d "$(cygpath -m "$1")/rwt.XXXXXX")")

cleanup() {
  [ -e "$tmp" ] || return 0
  # Junctions here point only inside $tmp; PowerShell 7 takes them off without following them.
  FILMSTRIP_TMP="\\\\?\\$(cygpath -w "$tmp")" pwsh -NoProfile -NonInteractive -Command \
    'Remove-Item -LiteralPath $env:FILMSTRIP_TMP -Recurse -Force' || true
  [ ! -e "$tmp" ] || { echo "could not remove $tmp; remove it by hand" >&2; exit 1; }
}
trap cleanup EXIT

git clone --quiet --no-hardlinks "$repo" "$tmp/clone"
main=$(dirname "$(git -C "$tmp/clone" rev-parse --path-format=absolute --git-common-dir)")
[ "$main" = "$(git -C "$tmp/clone" rev-parse --show-toplevel)" ] && [ "${main#"$tmp"/}" != "$main" ] ||
  { echo "the clone at $tmp/clone resolves to $main, not to itself" >&2; exit 1; }
head=$(git -C "$main" rev-parse HEAD)
sentinels="$tmp/sentinels"
out="$tmp/out.log"
case=setup
kept=()
passed=0

fail() {
  echo "FAIL $case: $*" >&2
  exit 1
}
keep() {
  mkdir -p "$1"
  printf '%s\n' "$case" >"$1/keep.txt"
  kept+=("$1/keep.txt")
}
junction() { cmd //c mklink //J "$(cygpath -w "$1")" "$(cygpath -w "$2")" >/dev/null; }
wt() { printf '%s' "$main/.claude/worktrees/review-$1"; }
run() { (cd "$main" && bash "$script" "$@") >"$out" 2>&1; }

open() {
  run open "$1" "$head" || fail "open exited $?: $(cat "$out")"
  [ -L "$(wt "$1")/node_modules" ] && [ -f "$(wt "$1")/node_modules/pkg/keep.txt" ] ||
    fail "open did not link the clone's node_modules"
}
closes() {
  run close "$1" || fail "close exited $?: $(cat "$out")"
  [ ! -e "$(wt "$1")" ] && [ ! -L "$(wt "$1")" ] || fail "close left $(wt "$1") on disk"
}
check() {
  local f listed want
  for f in "${kept[@]}"; do
    [ "$(cat "$f" 2>/dev/null)" ] || fail "sentinel $f is gone or emptied"
  done
  listed=$(git -C "$main" worktree list --porcelain)
  want=$(printf 'worktree %s\n' "$main" "$@")
  [ "$(grep '^worktree ' <<<"$listed")" = "$want" ] ||
    fail "git worktree list is not what this case expects: $listed"
}
pass() {
  check
  passed=$((passed + 1))
  echo "ok - $case"
}

keep "$main/node_modules/pkg"

case="a sentinel junction inside the worktree"
open 1
mkdir -p "$(wt 1)/target"
keep "$sentinels/inside"
junction "$(wt 1)/target/jlink" "$sentinels/inside"
closes 1
pass

case="a path over 260 characters"
open 2
deep="$(wt 2)/target"
for i in 1 2 3 4 5 6 7 8; do deep="$deep/segment-$i-$(printf '%040d' 0)"; done
mkdir -p "$deep"
echo deep >"$deep/read-only.txt"
chmod a-w "$deep/read-only.txt"
long=$(cygpath -w "$deep/read-only.txt")
[ ${#long} -gt 260 ] && [ ! -w "$deep/read-only.txt" ] ||
  fail "made a ${#long}-character path, not a read-only file over 260"
keep "$sentinels/deep"
junction "$(wt 2)/target/jlink" "$sentinels/deep"
closes 2
pass

case="a dangling node_modules link"
open 3
cmd //c rmdir "$(cygpath -w "$(wt 3)/node_modules")"
mkdir -p "$sentinels/gone"
junction "$(wt 3)/node_modules" "$sentinels/gone"
rmdir "$sentinels/gone"
[ -L "$(wt 3)/node_modules" ] && [ ! -e "$(wt 3)/node_modules" ] || fail "the link is not dangling"
closes 3
pass

case="a locked worktree"
open 4
echo untracked >"$(wt 4)/untracked.txt"
git -C "$main" worktree lock "$(wt 4)"
if run close 4; then fail "close exited 0 on a locked worktree"; fi
grep -q "remove it by hand" "$out" || fail "close gave no reason: $(cat "$out")"
[ -f "$(wt 4)/untracked.txt" ] && [ -f "$(wt 4)/package.json" ] || fail "close deleted its files"
check "$(wt 4)"
grep -qx locked <<<"$(git -C "$main" worktree list --porcelain | sed -n "\|^worktree $(wt 4)\$|,/^\$/p")" ||
  fail "the worktree is no longer locked"
git -C "$main" worktree unlock "$(wt 4)"
closes 4
pass

case="the worktree folder itself a junction"
mkdir -p "$(dirname "$(wt 5)")"
keep "$sentinels/outer"
junction "$(wt 5)" "$sentinels/outer"
closes 5
pass

case="a leftover folder git no longer knows, holding a junction"
deep="$(wt 6)/target"
for i in 1 2 3 4 5 6 7 8; do deep="$deep/segment-$i-$(printf '%040d' 0)"; done
mkdir -p "$deep"
echo deep >"$deep/left.txt"
keep "$sentinels/leftover"
junction "$(wt 6)/jlink" "$sentinels/leftover"
check
closes 6
pass

echo "review-worktree.sh: all $passed cases passed"

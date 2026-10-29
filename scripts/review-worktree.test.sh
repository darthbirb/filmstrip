#!/usr/bin/env bash
# Runs review-worktree.sh against a throwaway clone made under <temp>. DEVELOPMENT.md "Review".
# Usage: scripts/review-worktree.test.sh <temp>   (CI passes the runner's temp)
set -euo pipefail

[ $# -eq 1 ] && [ -d "$1" ] || { echo "usage: $0 <existing temp folder>" >&2; exit 2; }
script="$(cd "$(dirname "$0")" && pwd)/review-worktree.sh"
repo=$(git -C "$(dirname "$script")" rev-parse --show-toplevel)
tmp=$(cygpath -aml "$(mktemp -d "$(cygpath -aml "$1")/rwt.XXXXXX")")

outside=()

cleanup() {
  [ -e "$tmp" ] || return 0
  local link
  for link in "${outside[@]}"; do
    if [ -L "$link" ]; then cmd //c rmdir "$(cygpath -w "$link")" || true; fi
  done
  # Junctions left here point only inside $tmp; PowerShell 7 takes them off without following them.
  FILMSTRIP_TMP="\\\\?\\$(cygpath -w "$tmp")" pwsh -NoProfile -NonInteractive -Command \
    'Remove-Item -LiteralPath $env:FILMSTRIP_TMP -Recurse -Force' || true
  [ ! -e "$tmp" ] || { echo "could not remove $tmp; remove it by hand" >&2; exit 1; }
}
trap cleanup EXIT

git -c advice.detachedHead=false clone --quiet --no-hardlinks "$repo" "$tmp/clone"
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
  local found
  run open "$1" "$head" || fail "open exited $?: $(cat "$out")"
  [ ! -e "$(wt "$1")/node_modules" ] && [ ! -L "$(wt "$1")/node_modules" ] ||
    fail "open made a node_modules in the worktree"
  found=$(cd "$(wt "$1")" && node -p 'require.resolve("pkg/keep.txt")') ||
    fail "a package does not resolve from the worktree"
  [ "$(cygpath -m "$found" | tr '[:upper:]' '[:lower:]')" = \
    "$(tr '[:upper:]' '[:lower:]' <<<"$main/node_modules/pkg/keep.txt")" ] ||
    fail "a package resolves from the worktree to $found, not to the clone's node_modules"
}
refuses() {
  if run "$@"; then fail "$1 exited 0 with the checkout's node_modules naming a worktree"; fi
  grep -q "names a worktree" "$out" || fail "$1 gave no reason: $(cat "$out")"
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
junction "$main/node_modules/linked" "$main/node_modules/pkg"
mkdir -p "$main/node_modules/.bin"
printf 'virtualStoreDir: %s\n' "$(cygpath -w "$main/node_modules/.pnpm")" >"$main/node_modules/.modules.yaml"
printf 'export NODE_PATH="/proc/cygdrive%s"\n' "$(cygpath -u "$main/node_modules/.pnpm")" \
  >"$main/node_modules/.bin/pkg"
modules=$(ls -A "$main/node_modules")

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

case="a leftover folder git no longer knows, holding junctions and its own node_modules"
deep="$(wt 6)/target"
for i in 1 2 3 4 5 6 7 8; do deep="$deep/segment-$i-$(printf '%040d' 0)"; done
mkdir -p "$deep"
echo deep >"$deep/left.txt"
keep "$sentinels/leftover"
junction "$(wt 6)/jlink" "$sentinels/leftover"
mkdir -p "$(wt 6)/node_modules/.pnpm"
junction "$(wt 6)/node_modules/dep" "$sentinels/leftover"
check
closes 6
pass

case="a node_modules linked to the checkout's, as an older open made"
open 7
junction "$(wt 7)/node_modules" "$main/node_modules"
closes 7
[ "$(ls -A "$main/node_modules")" = "$modules" ] || fail "close changed the clone's node_modules"
pass

case="a package manager writing the worktree's node_modules"
open 8
mkdir -p "$(wt 8)/node_modules/.pnpm/dep"
printf 'virtualStoreDir: %s\n' "$(cygpath -w "$(wt 8)/node_modules/.pnpm")" \
  >"$(wt 8)/node_modules/.modules.yaml"
junction "$(wt 8)/node_modules/dep" "$(wt 8)/node_modules/.pnpm/dep"
[ "$(ls -A "$main/node_modules")" = "$modules" ] ||
  fail "a write in the worktree reached the clone's node_modules"
closes 8
pass

case="the checkout's node_modules naming a worktree"
open 9
mkdir -p "$(wt 9)/node_modules/.pnpm/dep"
junction "$main/node_modules/dep" "$(wt 9)/node_modules/.pnpm/dep"
refuses close 9
grep -qF "$main/node_modules/dep" "$out" || fail "close did not name the link: $(cat "$out")"
refuses open 10 "$head"
check "$(wt 9)"
cmd //c rmdir "$(cygpath -w "$main/node_modules/dep")"
w=$(cygpath -w "$(wt 9)")
for form in ".modules.yaml|virtualStoreDir: $w\\node_modules\\.pnpm" \
  ".pnpm-workspace-state-v1.json|{ \"projects\": { \"${w//\\/\\\\}\": {} } }" \
  ".bin/pkg|export NODE_PATH=\"/proc/cygdrive$(cygpath -u "$(wt 9)")/node_modules/.pnpm\""; do
  file="$main/node_modules/${form%%|*}"
  if [ -e "$file" ]; then cp "$file" "$tmp/was"; else rm -f "$tmp/was"; fi
  printf '%s\n' "${form#*|}" >"$file"
  refuses close 9
  grep -qF "$file" "$out" || fail "close did not name $file: $(cat "$out")"
  if [ -e "$tmp/was" ]; then mv "$tmp/was" "$file"; else rm "$file"; fi
done
check "$(wt 9)"
closes 9
[ "$(ls -A "$main/node_modules")" = "$modules" ] || fail "the clone's node_modules was not restored"
pass

case="a review worktree's dev server serving the checkout's packages"
installed=$repo
until [ -e "$installed/node_modules/vite" ]; do
  [ "$installed" != "$(dirname "$installed")" ] || fail "no installed vite above $repo; install first"
  installed=$(dirname "$installed")
done
for p in vite @vitejs/plugin-react @tailwindcss/vite; do
  mkdir -p "$(dirname "$main/node_modules/$p")"
  outside+=("$main/node_modules/$p")
  junction "$main/node_modules/$p" "$(realpath "$installed/node_modules/$p")"
done
open 11
allow=$(cd "$(wt 11)" && node --input-type=module -e '
  const { resolveConfig } = await import("vite");
  console.log((await resolveConfig({}, "serve")).server.fs.allow.join("\n"));
') || fail "Vite could not load the worktree's config"
grep -Fxqi "$main/node_modules" <<<"$allow" ||
  fail "Vite in the worktree serves only from: $allow"
closes 11
for p in "${outside[@]}"; do cmd //c rmdir "$(cygpath -w "$p")"; done
outside=()
pass

echo "review-worktree.sh: all $passed cases passed"

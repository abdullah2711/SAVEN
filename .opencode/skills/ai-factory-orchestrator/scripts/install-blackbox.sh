#!/bin/bash
# Sets up the 30-minute Git checkpoint backup (black box) — SAVEN v3.2 semantics.
# SAFETY: git plumbing only, NEVER a working-tree checkout.
# CORRECTNESS RULES (v3):
#  1. Checkpoints are archived source-to-destination EXPLICITLY — each worker's
#     file comes only from that worker's mapped worktree. No globs over
#     worktrees; no shared-index last-writer-wins (the v2 glob let the last
#     sorted worktree overwrite other workers' checkpoints with stale copies).
#  2. The worker map (docs/agents/worker-map.env) is load-bearing: one entry
#     per worker with contract, branch, worktree. The dispatcher updates it on
#     every assignment/verdict/merge (protocol step), and the script REFUSES to
#     push when a map entry's contract and branch disagree.
#  3. The archive tree is verified to contain every mapped checkpoint before
#     push; a broken archive aborts loudly instead of shipping silently.
set -u
REPO_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$REPO_DIR" || exit 1
LOG="$REPO_DIR/.blackbox.log"
exec >>"$LOG" 2>&1
echo "--- run $(date -Is)"
MAP="${SAVEN_WORKER_MAP:-$REPO_DIR/docs/agents/worker-map.env}"
[ -f "$MAP" ] || MAP="${SAVEN_WORKER_MAP:-$HOME/.local/bin/saven-worker-map.env}"
STATE=docs/contractor/state
BASE=refs/heads/system-checkpoints
if ! git show-ref --verify -q "$BASE"; then
  base=$(git rev-parse origin/main 2>/dev/null) || exit 1
  git update-ref "$BASE" "$base"
fi
parent=$(git rev-parse "$BASE") || exit 1
IDX="$REPO_DIR/.git/blackbox-index.$$"
export GIT_DIR="$REPO_DIR/.git"
export GIT_INDEX_FILE="$IDX"
git read-tree "$parent" || { rm -f "$IDX"; exit 1; }
ALERT=""
[ -f "$MAP" ] && . "$MAP" || echo "ALERT-NO-MAP: worker map missing — refusing to guess sources"
map_guard() { # refuse when a worker's contract and branch disagree
  local W; W=$(echo "$1" | tr '[:lower:]' '[:upper:]')
  eval "CT=\$WORKER_${W}_CONTRACT"; eval "BR=\$WORKER_${W}_BRANCH"
  if [ -n "${CT:-}" ] && [ -n "${BR:-}" ]; then
    case "$BR" in
      *auth*) case "$CT" in AUTH-*) return 0;; *) echo "ALERT-MAP-DISAGREEMENT worker-$1: contract $CT vs branch $BR — refusing to push"; ALERT="$ALERT MAPDIS-$1"; return 1;; esac;;
      *pivot*) case "$CT" in PIVOT-*) return 0;; *) echo "ALERT-MAP-DISAGREEMENT worker-$1: contract $CT vs branch $BR — refusing to push"; ALERT="$ALERT MAPDIS-$1"; return 1;; esac;;
    esac
  fi
  return 0
}
archive_worker() {
  local W; W=$(echo "$1" | tr '[:lower:]' '[:upper:]')
  map_guard "$1" || return 1
  eval "WT=\$WORKER_${W}_WT"; eval "CT=\$WORKER_${W}_CONTRACT"
  SRC="$WT/$STATE/worker-$1-checkpoint.md"; DST="$STATE/worker-$1-checkpoint.md"
  if [ -z "${WT:-}" ] || [ ! -f "$SRC" ]; then echo "ALERT-CHECKPOINT-MISSING worker-$1"; ALERT="$ALERT MISSING-$1"; return 1; fi
  named=$(grep -m1 -oiE 'AUTH-[0-9]+|PIVOT-[0-9]+' "$SRC" | head -1)
  if [ -n "${CT:-}" ] && [ -n "$named" ] && ! echo "$named" | grep -q "$CT"; then
    echo "ALERT-STALE-CHECKPOINT worker-$1: names $named, expected $CT"; ALERT="$ALERT STALE-$1"
  fi
  git update-index --add --cacheinfo 100644,$(git hash-object -w "$SRC"),"$DST"
}
# Governance archives first (canonical checkout), worker checkpoints LAST.
for P in docs/contractor/contracts docs/contractor/reviews docs/contractor/deliveries docs/agents; do
  [ -d "$P" ] && (cd "$REPO_DIR" && git add -- "$P" 2>/dev/null) && echo "archived $P"
done
archive_worker a; archive_worker b
tree=$(git write-tree) || { rm -f "$IDX"; exit 1; }
for F in docs/contractor/state/worker-a-checkpoint.md docs/contractor/state/worker-b-checkpoint.md; do
  if ! git cat-file -e "$tree:$F" 2>/dev/null; then
    echo "ALERT-ARCHIVE-BROKEN: $F missing from tree — ABORTING push"
    ALERT="$ALERT ARCHIVE-BROKEN"
  fi
done
if echo "$ALERT" | grep -qE 'ARCHIVE-BROKEN|MAPDIS'; then rm -f "$IDX"; exit 1; fi
if [ "$tree" = "$(git rev-parse "$parent^{tree}")" ]; then rm -f "$IDX"; echo "no changes"; exit 0; fi
commit=$(git commit-tree "$tree" -p "$parent" -m "chore: system checkpoint backup $(date -Is)${ALERT:+ $ALERT}")
rm -f "$IDX"
git update-ref "$BASE" "$commit"
git push origin system-checkpoints && echo "Black Box PUSHED $commit" || echo "PUSH FAILED - local ref kept for retry"

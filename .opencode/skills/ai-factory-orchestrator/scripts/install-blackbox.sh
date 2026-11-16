#!/bin/bash
# Sets up the 30-minute Git checkpoint backup (black box).
# SAFETY: uses git plumbing with a temporary index — it NEVER checks out
# the backup branch in the live working tree, so running agents are never
# disturbed. The owner's original checkout-based approach is intentionally
# not used for that reason.
set -u
REPO_DIR=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$REPO_DIR" || exit 1
LOG="$REPO_DIR/.blackbox.log"
exec >>"$LOG" 2>&1
echo "--- run $(date -Is)"
BASE=refs/heads/system-checkpoints
if ! git show-ref --verify -q "$BASE"; then
  base=$(git rev-parse origin/main 2>/dev/null) || exit 1
  git update-ref "$BASE" "$base"
  echo "initialized $BASE at $base"
fi
parent=$(git rev-parse "$BASE") || exit 1
IDX="$REPO_DIR/.git/blackbox-index.$$"
export GIT_DIR="$REPO_DIR/.git"
export GIT_INDEX_FILE="$IDX"
git read-tree "$parent" || { rm -f "$IDX"; exit 1; }
added=0
for D in "$REPO_DIR" "$REPO_DIR"/wt-*; do
  [ -d "$D/docs/contractor/state" ] || [ -d "$D/docs/agents" ] || continue
  (cd "$D" && git add -- docs/agents docs/contractor/state .opencode 2>/dev/null) && added=1
done
[ "$added" = 1 ] || { rm -f "$IDX"; echo "nothing to add"; exit 0; }
tree=$(git write-tree) || { rm -f "$IDX"; exit 1; }
if [ "$tree" = "$(git rev-parse "$parent^{tree}")" ]; then rm -f "$IDX"; echo "no changes"; exit 0; fi
commit=$(git commit-tree "$tree" -p "$parent" -m "chore: system checkpoint backup $(date -Is)")
rm -f "$IDX"
git update-ref "$BASE" "$commit"
git push origin system-checkpoints && echo "Black Box PUSHED $commit" || echo "PUSH FAILED - local ref kept for retry"

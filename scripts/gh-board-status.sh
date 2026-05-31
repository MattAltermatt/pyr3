#!/usr/bin/env bash
# gh-board-status.sh — set a pyr3 issue's "pyr3 roadmap" Project board Status.
#
# Usage: scripts/gh-board-status.sh <issue-number> "<Status>"
#   <Status> ∈ Backlog | Ready | In Progress | Done
#
# Resolves the Status field + target option BY NAME (so GitHub re-minting the
# option IDs can't silently break this), finds the issue's board item id, and
# adds the issue to the board first if it isn't on it yet. Idempotent.
#
# Used by the pyr3-issue-start / pyr3-issue-close skills. Closing an issue is
# NOT "done" until its board card reads Done — this script is how that happens.
set -euo pipefail

OWNER="MattAltermatt"
PROJECT_NUMBER="1"
REPO="MattAltermatt/pyr3"

ISSUE="${1:?usage: gh-board-status.sh <issue#> <Status>}"
STATUS="${2:?usage: gh-board-status.sh <issue#> <Status>}"

# Project node id + Status field id + target option id (option looked up by name).
read -r PROJECT_ID FIELD_ID OPTION_ID < <(
  gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json \
  | OWNER="$OWNER" PROJECT_NUMBER="$PROJECT_NUMBER" STATUS="$STATUS" python3 -c '
import json, sys, os, subprocess
fields = json.load(sys.stdin)["fields"]
status = next(f for f in fields if f["name"] == "Status")
opts = [o for o in status["options"] if o["name"] == os.environ["STATUS"]]
if not opts:
    sys.exit("Unknown status %r (have: %s)" % (
        os.environ["STATUS"], ", ".join(o["name"] for o in status["options"])))
pid = json.loads(subprocess.check_output(
    ["gh", "project", "view", os.environ["PROJECT_NUMBER"],
     "--owner", os.environ["OWNER"], "--format", "json"]))["id"]
print(pid, status["id"], opts[0]["id"])
'
)

# Find this issue's board item id; add it to the board if missing.
ITEM_ID=$(
  gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 400 \
  | ISSUE="$ISSUE" python3 -c '
import json, sys, os
n = int(os.environ["ISSUE"])
for it in json.load(sys.stdin)["items"]:
    if it.get("content", {}).get("number") == n:
        print(it["id"]); break
'
)
if [ -z "${ITEM_ID:-}" ]; then
  ITEM_ID=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" \
    --url "https://github.com/$REPO/issues/$ISSUE" --format json \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  echo "added #$ISSUE to the board (item $ITEM_ID)"
fi

gh project item-edit --id "$ITEM_ID" --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" --single-select-option-id "$OPTION_ID" >/dev/null
echo "#$ISSUE → Status: $STATUS"

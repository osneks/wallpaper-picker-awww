#!/usr/bin/env bash
#
# apply-wallpaper.sh <index> <path-to-image>
#
# Called by the Electron UI (main.js) when the user clicks a wallpaper.
# Kept separate so all actual awww/state-file logic lives in one place
# you can also run by hand, independent of Electron.

set -euo pipefail

INDEX="${1:?usage: apply-wallpaper.sh <index> <path>}"
IMG_PATH="${2:?usage: apply-wallpaper.sh <index> <path>}"
STATE_FILE="${XDG_RUNTIME_DIR:-/tmp}/wallpaper-index"

# How long (seconds) a load can take before we treat it as "slow" and clear
# the awww cache so the NEXT apply gets a clean, fast start. We do NOT clear
# the cache before every apply - that would defeat the whole point of the
# cache (skipping re-decode/re-process of animations) and was making every
# single load slow, not just the occasional bad one.
SLOW_THRESHOLD_SECONDS="${AWWW_SLOW_THRESHOLD:-3}"

[[ -f "$IMG_PATH" ]] || { echo "No such file: $IMG_PATH" >&2; exit 1; }

printf '%s\n' "$INDEX" > "$STATE_FILE"

start_ns=$(date +%s%N)

awww img "$IMG_PATH" \
    --transition-type center \
    --transition-duration 1.5

end_ns=$(date +%s%N)
elapsed_seconds=$(( (end_ns - start_ns) / 1000000000 ))

if (( elapsed_seconds >= SLOW_THRESHOLD_SECONDS )); then
    echo "apply-wallpaper: load took ${elapsed_seconds}s (>= ${SLOW_THRESHOLD_SECONDS}s), clearing awww cache for next time" >&2
    # Run in the background so this apply doesn't sit around waiting on it -
    # the UI can report "Applied" immediately, the cache clear just prepares
    # things for whichever wallpaper gets picked next.
    awww clear-cache &
    disown
fi

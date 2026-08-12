#!/usr/bin/env bash
#
# wallpaper-cycle.sh {next|prev}
#
# Standalone keybind script - not called by the Electron UI, but reads/
# writes the same state file so the two stay in sync with each other.

set -euo pipefail

WALLPAPER_DIR="${WALLPAPER_DIR:-$HOME/.config/hypr/wallpaper_animated}"
STATE_FILE="${XDG_RUNTIME_DIR:-/tmp}/wallpaper-index"
SLOW_THRESHOLD_SECONDS="${AWWW_SLOW_THRESHOLD:-3}"

mapfile -t wallpapers < <(
    find "$WALLPAPER_DIR" -maxdepth 1 -type f \
        \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.gif' \) |
    while IFS= read -r f; do
        ext="${f##*.}"
        printf '%s\t%s\n' "${ext,,}" "$f"
    done | sort -k1,1 -k2,2 | cut -f2-
)

(( ${#wallpapers[@]} )) || exit 1

index=0
[[ -f "$STATE_FILE" ]] && index=$(<"$STATE_FILE")

case "$1" in
    next)
        index=$(( (index + 1) % ${#wallpapers[@]} ))
        ;;
    prev)
        index=$(( (index - 1 + ${#wallpapers[@]}) % ${#wallpapers[@]} ))
        ;;
    *)
        echo "Usage: $0 {next|prev}"
        exit 1
        ;;
esac

printf '%s\n' "$index" > "$STATE_FILE"

start_ns=$(date +%s%N)

awww img "${wallpapers[$index]}" \
    --transition-type center \
    --transition-duration 1.5

end_ns=$(date +%s%N)
elapsed_seconds=$(( (end_ns - start_ns) / 1000000000 ))

if (( elapsed_seconds >= SLOW_THRESHOLD_SECONDS )); then
    echo "wallpaper-cycle: load took ${elapsed_seconds}s (>= ${SLOW_THRESHOLD_SECONDS}s), clearing awww cache for next time" >&2
    awww clear-cache &
    disown
fi

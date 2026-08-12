#!/usr/bin/env bash
# Launches the wallpaper picker as a rofi/wofi-style layer-shell overlay.
#
# Usage: run-overlay.sh [wallpaper-dir]
# A directory argument overrides the configured wallpaper folder for this
# run only.
#
# Bind this script to a Hyprland keybind, e.g. in hyprland.lua:
#   hl.bind(mainMod .. "+ up", hl.dsp.exec_cmd("bash ~/.config/hypr/wallpaper-picker/overlay/run-overlay.sh"))
# Or bound to a specific folder:
#   hl.bind(mainMod .. "+ up", hl.dsp.exec_cmd("bash ~/.config/hypr/wallpaper-picker/overlay/run-overlay.sh ~/Pictures/wallpapers"))
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(cd .. && pwd)"

if [[ -n "${1:-}" ]]; then
  export WALLPAPER_DIR="$(realpath "$1")"
fi

SHIM="$(pwd)/liblayer-shell-shim.so"
[[ -f "$SHIM" ]] || { echo "Run build-shim.sh first" >&2; exit 1; }

# GDK_BACKEND=x11 forces Electron's GTK/XWayland path, which is required
# for the shim's gtk_window_new() hook to ever fire. LAYER_SHELL_OVERLAY=1
# is read by main.js to skip the native-Wayland Ozone switches for this run.
export GDK_BACKEND=x11
export LAYER_SHELL_OVERLAY=1
export LAYER_SHELL_NAMESPACE=wallpaper-picker
export LD_PRELOAD="$SHIM"

# Resolve the electron binary directly instead of going through `npx`.
# npx re-checks/resolves the package on every invocation, which adds
# real, noticeable latency to a hot keybind path. We want this launching
# instantly, the way rofi/wofi do.
if [[ -x "$APP_DIR/node_modules/.bin/electron" ]]; then
  ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
elif command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="$(command -v electron)"
else
  echo "electron not found - run 'npm install' in $APP_DIR first" >&2
  exit 1
fi

exec "$ELECTRON_BIN" "$APP_DIR"

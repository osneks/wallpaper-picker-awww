#!/usr/bin/env bash
# install.sh - sets up wallpaper-picker on Arch/Hyprland.
#
# This app is overlay-only (rofi/wofi-style layer-shell surface), so the
# overlay shim is always built - there's no "windowed mode" anymore.
#
# Usage:
#   ./install.sh                install app + overlay
#   ./install.sh --with-native  also build the native C++ thumbnail generator
set -euo pipefail
cd "$(dirname "$0")"

INSTALL_DIR="${WALLPAPER_PICKER_DIR:-$HOME/.local/share/wallpaper-picker}"
BIN_DIR="$HOME/.local/bin"
WITH_NATIVE=0
for arg in "$@"; do
  [[ "$arg" == "--with-native" ]] && WITH_NATIVE=1
done

echo "==> Checking dependencies"
missing=()
command -v node    >/dev/null 2>&1 || missing+=("nodejs")
command -v npm     >/dev/null 2>&1 || missing+=("npm")
command -v awww    >/dev/null 2>&1 || missing+=("awww")
command -v electron >/dev/null 2>&1 || echo "    (electron not found globally - will use a local npm install instead, that's fine)"

command -v gcc      >/dev/null 2>&1 || missing+=("base-devel")
pkg-config --exists gtk+-3.0        2>/dev/null || missing+=("gtk3")
pkg-config --exists gtk-layer-shell-0 2>/dev/null || missing+=("gtk-layer-shell (AUR)")

if [[ $WITH_NATIVE -eq 1 ]]; then
  command -v g++ >/dev/null 2>&1 || missing+=("base-devel")
  [[ -f /usr/include/webp/decode.h ]] || missing+=("libwebp")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo ""
  echo "Missing packages: ${missing[*]}"
  echo "On Arch, roughly:"
  echo "  sudo pacman -S nodejs npm awww base-devel gtk3"
  echo "  yay -S gtk-layer-shell"
  echo ""
  read -rp "Continue anyway? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || exit 1
fi

echo "==> Installing app to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude 'install.sh' --exclude '*.so' --exclude 'node_modules' ./ "$INSTALL_DIR/"
else
  # rsync isn't guaranteed to be installed. Plain cp -a covers the same
  # ground here: the source tarball never actually contains node_modules or
  # a built .so to begin with - those only ever get created inside
  # $INSTALL_DIR itself, later, by npm install / build-shim.sh.
  cp -a . "$INSTALL_DIR/"
  rm -f "$INSTALL_DIR/install.sh"
fi

echo "==> Installing npm dependencies (Electron)"
cd "$INSTALL_DIR"
if ! command -v electron >/dev/null 2>&1; then
  npm install --no-save electron
fi

echo "==> Building layer-shell overlay shim"
"$INSTALL_DIR/overlay/build-shim.sh"
chmod +x "$INSTALL_DIR/overlay/run-overlay.sh"

echo "==> Creating launcher at $BIN_DIR/wallpick"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/wallpick" <<EOF
#!/usr/bin/env bash
# wallpick - launch the wallpaper picker overlay
#
# Usage:
#   wallpick                use the last-configured folder
#   wallpick <dir>           use <dir> for this run only
#   wallpick set-dir <dir>   persist <dir> as the default folder
set -euo pipefail

# Mirrors Electron's app.getPath('userData') resolution for this app
# (package.json name: "wallpaper-picker"), so set-dir writes to exactly
# the file main.js itself reads on every launch.
CONFIG_FILE="\${XDG_CONFIG_HOME:-\$HOME/.config}/wallpaper-picker/config.json"

if [[ "\${1:-}" == "set-dir" ]]; then
  target="\${2:-}"
  if [[ -z "\$target" ]]; then
    echo "Usage: wallpick set-dir <folder>" >&2
    exit 1
  fi
  if [[ ! -d "\$target" ]]; then
    echo "Not a directory: \$target" >&2
    exit 1
  fi
  target="\$(realpath "\$target")"
  mkdir -p "\$(dirname "\$CONFIG_FILE")"
  node -e '
    const fs = require("fs");
    const [, dir, file] = process.argv;
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    cfg.wallpaperDir = dir;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  ' "\$target" "\$CONFIG_FILE"
  echo "Default wallpaper folder set to: \$target"
  exit 0
fi

if [[ "\${1:-}" == "-h" || "\${1:-}" == "--help" ]]; then
  echo "Usage: wallpick [wallpaper-dir]"
  echo "       wallpick set-dir <folder>"
  exit 0
fi

if [[ -n "\${1:-}" ]]; then
  export WALLPAPER_DIR="\$(realpath "\$1")"
fi

exec bash "$INSTALL_DIR/overlay/run-overlay.sh"
EOF
chmod +x "$BIN_DIR/wallpick"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo "    NOTE: $BIN_DIR isn't on your PATH. Add this to your shell rc:"
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

DEFAULT_WP_DIR="$HOME/.config/hypr/wallpaper_animated"
mkdir -p "$DEFAULT_WP_DIR"
echo "==> Wallpaper folder: $DEFAULT_WP_DIR (override with \$WALLPAPER_DIR)"

if [[ $WITH_NATIVE -eq 1 ]]; then
  echo "==> Building native thumbnail generator"
  "$INSTALL_DIR/native/build.sh"
  echo "    Thumbnails will cache to ~/.config/wallpaper-picker/thumb-cache (or your Electron userData dir)"
fi

echo ""
echo "==> Done."
echo "Run with:                wallpick"
echo "With a specific folder:  wallpick ~/Pictures/wallpapers"
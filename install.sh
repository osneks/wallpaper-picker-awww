#!/usr/bin/env bash
# install.sh - sets up wallpaper-picker on Arch/Hyprland.
#
# Usage:
#   ./install.sh                 install app only
#   ./install.sh --with-overlay  also build the layer-shell overlay shim
set -euo pipefail
cd "$(dirname "$0")"

INSTALL_DIR="${WALLPAPER_PICKER_DIR:-$HOME/.local/share/wallpaper-picker}"
BIN_DIR="$HOME/.local/bin"
WITH_OVERLAY=0
WITH_NATIVE=0
for arg in "$@"; do
  [[ "$arg" == "--with-overlay" || "$arg" == "--all" ]] && WITH_OVERLAY=1
  [[ "$arg" == "--with-native"  || "$arg" == "--all" ]] && WITH_NATIVE=1
done

echo "==> Checking dependencies"
missing=()
command -v node    >/dev/null 2>&1 || missing+=("nodejs")
command -v npm     >/dev/null 2>&1 || missing+=("npm")
command -v awww    >/dev/null 2>&1 || missing+=("awww")
command -v electron >/dev/null 2>&1 || echo "    (electron not found globally - will use a local npm install instead, that's fine)"

if [[ $WITH_OVERLAY -eq 1 ]]; then
  command -v gcc      >/dev/null 2>&1 || missing+=("base-devel")
  pkg-config --exists gtk+-3.0        2>/dev/null || missing+=("gtk3")
  pkg-config --exists gtk-layer-shell-0 2>/dev/null || missing+=("gtk-layer-shell (AUR)")
fi

if [[ $WITH_NATIVE -eq 1 ]]; then
  command -v g++ >/dev/null 2>&1 || missing+=("base-devel")
  [[ -f /usr/include/webp/decode.h ]] || missing+=("libwebp")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo ""
  echo "Missing packages: ${missing[*]}"
  echo "On Arch, roughly:"
  echo "  sudo pacman -S nodejs npm awww base-devel gtk3"
  echo "  yay -S gtk-layer-shell   # only needed for --with-overlay"
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

echo "==> Creating launcher at $BIN_DIR/wallpick"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/wallpick" <<EOF
#!/usr/bin/env bash
# wallpick - launch the wallpaper picker
#
# Usage:
#   wallpick                     normal window, last-configured folder
#   wallpick <dir>                normal window, use <dir> for this run only
#   wallpick -o|--overlay         overlay mode, last-configured folder
#   wallpick -o|--overlay <dir>   overlay mode, use <dir> for this run only
#   wallpick set-dir <dir>        persist <dir> as the default folder
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

overlay=0
dir=""

for arg in "\$@"; do
  case "\$arg" in
    -o|--overlay) overlay=1 ;;
    -h|--help)
      echo "Usage: wallpick [-o|--overlay] [wallpaper-dir]"
      echo "       wallpick set-dir <folder>"
      exit 0
      ;;
    *) dir="\$arg" ;;
  esac
done

if [[ -n "\$dir" ]]; then
  export WALLPAPER_DIR="\$(realpath "\$dir")"
fi

if [[ "\$overlay" -eq 1 ]]; then
  exec bash "$INSTALL_DIR/overlay/run-overlay.sh"
else
  cd "$INSTALL_DIR"
  if [[ -x node_modules/.bin/electron ]]; then
    exec node_modules/.bin/electron .
  else
    exec electron .
  fi
fi
EOF
chmod +x "$BIN_DIR/wallpick"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo "    NOTE: $BIN_DIR isn't on your PATH. Add this to your shell rc:"
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

DEFAULT_WP_DIR="$HOME/.config/hypr/wallpaper_animated"
mkdir -p "$DEFAULT_WP_DIR"
echo "==> Wallpaper folder: $DEFAULT_WP_DIR (override with \$WALLPAPER_DIR)"

if [[ $WITH_OVERLAY -eq 1 ]]; then
  echo "==> Building layer-shell overlay shim"
  "$INSTALL_DIR/overlay/build-shim.sh"
  chmod +x "$INSTALL_DIR/overlay/run-overlay.sh"
fi

if [[ $WITH_NATIVE -eq 1 ]]; then
  echo "==> Building native thumbnail generator"
  "$INSTALL_DIR/native/build.sh"
  echo "    Thumbnails will cache to ~/.config/wallpaper-picker/thumb-cache (or your Electron userData dir)"
fi

echo ""
echo "==> Done."
echo "Run normally with:      wallpick"
echo "Run as overlay with:    wallpick -o"
echo "With a specific folder: wallpick -o ~/Pictures/wallpapers"
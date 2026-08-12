#!/usr/bin/env bash
# Builds liblayer-shell-shim.so. Run once (or after editing the .c file).
set -euo pipefail
cd "$(dirname "$0")"

# Arch package names:
#   pacman -S gtk3
#   yay -S gtk-layer-shell     (AUR; provides gtk-layer-shell.pc)
if ! pkg-config --exists gtk-layer-shell-0; then
  echo "Missing gtk-layer-shell dev package. On Arch: yay -S gtk-layer-shell" >&2
  exit 1
fi

gcc -shared -fPIC -O2 -o liblayer-shell-shim.so layer-shell-shim.c \
  $(pkg-config --cflags --libs gtk+-3.0 gtk-layer-shell-0)

echo "Built ./liblayer-shell-shim.so"

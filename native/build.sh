#!/usr/bin/env bash
# Builds native/thumbgen. Run once (or after editing thumbgen.cpp).
set -euo pipefail
cd "$(dirname "$0")"

if ! pkg-config --exists libwebp 2>/dev/null && [[ ! -f /usr/include/webp/decode.h ]]; then
  echo "Missing libwebp dev headers. On Arch: sudo pacman -S libwebp" >&2
  exit 1
fi

mkdir -p vendor
fetch() {
  local name="$1"
  if [[ ! -f "vendor/$name" ]]; then
    echo "Fetching $name..."
    curl -sL -o "vendor/$name" "https://raw.githubusercontent.com/nothings/stb/master/$name"
  fi
}
fetch stb_image.h
fetch stb_image_resize2.h
fetch stb_image_write.h

g++ -O3 -std=c++17 -pthread thumbgen.cpp -lwebp -o thumbgen

echo "Built ./thumbgen"

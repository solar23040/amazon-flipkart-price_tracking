#!/usr/bin/env bash
# Regenerate the PWA icons from the SVG sources in this directory.
# Requires rsvg-convert (librsvg). Run from anywhere: scripts/pwa-icons/generate.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../../public/icons"
mkdir -p "$out"

render() { # <svg> <size> <output name>
  rsvg-convert -w "$2" -h "$2" "$here/$1" -o "$out/$3"
  printf 'rendered %s (%sx%s)\n' "$out/$3" "$2" "$2"
}

render icon.svg 192 icon-192x192.png
render icon.svg 512 icon-512x512.png
render maskable.svg 192 maskable-192x192.png
render maskable.svg 512 maskable-512x512.png
render icon.svg 180 apple-touch-icon.png

# Multi-size favicon (needs Python + Pillow).
if python3 -c 'import PIL' >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  rsvg-convert -w 48 -h 48 "$here/icon.svg" -o "$tmp/icon-48.png"
  python3 - "$tmp/icon-48.png" "$out/favicon.ico" <<'PY'
import sys

from PIL import Image

Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2], format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
PY
  rm -rf "$tmp"
  printf 'rendered %s (16/32/48)\n' "$out/favicon.ico"
else
  printf 'WARNING: Pillow not installed, skipped favicon.ico\n' >&2
fi

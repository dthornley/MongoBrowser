#!/bin/bash
# Renders build/icon.svg into build/icon.icns (all macOS sizes) and build/icon.png (1024px).
# Requires rsvg-convert (brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")"

SET=icon.iconset
rm -rf "$SET"
mkdir -p "$SET"

render() { rsvg-convert -w "$2" -h "$2" icon.svg -o "$SET/$1"; }
render icon_16x16.png        16
render icon_16x16@2x.png     32
render icon_32x32.png        32
render icon_32x32@2x.png     64
render icon_128x128.png     128
render icon_128x128@2x.png  256
render icon_256x256.png     256
render icon_256x256@2x.png  512
render icon_512x512.png     512
render icon_512x512@2x.png 1024

iconutil -c icns "$SET" -o icon.icns
cp "$SET/icon_512x512@2x.png" icon.png
rm -rf "$SET"
echo "wrote build/icon.icns and build/icon.png"

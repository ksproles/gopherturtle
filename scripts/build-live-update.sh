#!/usr/bin/env bash
# Packages www/ as a live update for the installed iPhone/Android apps.
# Writes www/live/<version>.zip and www/live/latest.json, which the deploy then
# publishes to https://gopher-turtle.web.app/live/. Run from the repo root (CI does this).
set -euo pipefail

version="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)"
min_native="$(node -p "require('./live-update.json').minNative")"

rm -rf www/live
mkdir -p www/live
(cd www && zip -qr "live/$version.zip" . -x 'live/*' '.well-known/*' '.DS_Store')
checksum="$(sha256sum "www/live/$version.zip" | cut -d' ' -f1)"

cat > www/live/latest.json <<JSON
{
  "version": "$version",
  "url": "https://gopher-turtle.web.app/live/$version.zip",
  "checksum": "$checksum",
  "minNative": "$min_native"
}
JSON
echo "Live update $version ($(du -h "www/live/$version.zip" | cut -f1)), needs app version $min_native or later"

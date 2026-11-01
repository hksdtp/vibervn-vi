#!/bin/bash
# Rebuild the Vietnamese locale and install it into ViberVN Bot. Usage: ./install.sh [path/to/ViberVN Bot.app]
# Needs: node >= 20, npx (@electron/asar), codesign. Run `node translate.mjs` first if vi.json is missing/outdated.
set -euo pipefail
cd "$(dirname "$0")"
APP="${1:-/Applications/ViberVN Bot.app}"
RES="$APP/Contents/Resources"
ASSETS="$RES/app.asar.unpacked/dist/assets"   # renderer chunks live OUTSIDE app.asar (asar "unpacked"), so no repack is needed

[ -d "$ASSETS" ] || { echo "no unpacked assets at $ASSETS" >&2; exit 1; }
CHUNK=$(ls "$ASSETS"/i18n-*.js)                 # exactly one expected
[ -f "$RES/app.asar.orig" ] || cp "$RES/app.asar" "$RES/app.asar.orig"
[ -f "$CHUNK.orig" ] || cp "$CHUNK" "$CHUNK.orig"   # pristine chunk (assumes first run was on an unpatched app)

osascript -e 'tell application "ViberVN Bot" to quit' 2>/dev/null || true
sleep 2

rm -rf work && mkdir -p work/assets
cp "$CHUNK.orig" "work/assets/$(basename "$CHUNK")"
node build-vi.mjs work/assets
cp "work/assets/$(basename "$CHUNK")" "$CHUNK"

grep -q 'id:`vi`' "$CHUNK" || { echo "patch missing in $CHUNK" >&2; exit 1; }
codesign --force --deep --sign - "$APP"
open -a "$APP"
echo "installed. Pick Settings > Language > Tiếng Việt (or run ./set-language.sh)."

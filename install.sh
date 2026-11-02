#!/bin/bash
# Rebuild the Vietnamese locale and install it into ViberVN Bot. Usage: ./install.sh [path/to/ViberVN Bot.app]
# Needs: node >= 20, npx (@electron/asar), codesign. Run `node translate.mjs` first if vi.json is missing/outdated.
set -euo pipefail
cd "$(dirname "$0")"
APP="${1:-/Applications/ViberVN Bot.app}"
RES="$APP/Contents/Resources"
ASSETS="$RES/app.asar.unpacked/dist/assets"   # renderer chunks live OUTSIDE app.asar (asar "unpacked"), so no repack is needed

[ -d "$ASSETS" ] || { echo "no unpacked assets at $ASSETS" >&2; exit 1; }
# every chunk that carries per-locale dictionaries: the i18n chunk plus feature chunks (kanban, radio, group chat, schedule)
CHUNKS=()   # bash 3.2 (macOS): no mapfile; paths contain spaces
while IFS= read -r f; do CHUNKS+=("$f"); done < <(grep -l -e '"zh-hant":' -e 'configValue:`ja`' "$ASSETS"/*.js)
[ ${#CHUNKS[@]} -gt 0 ] || { echo "no locale chunks found" >&2; exit 1; }
[ -f "$RES/app.asar.orig" ] || cp "$RES/app.asar" "$RES/app.asar.orig"
for f in "${CHUNKS[@]}"; do
  if [ ! -f "$f.orig" ]; then
    if grep -q 'id:`vi`\|,vi:' "$f"; then echo "$f already patched but has no .orig backup" >&2; exit 1; fi
    cp "$f" "$f.orig"   # pristine copy; later runs always rebuild from it
  fi
done

if pgrep -f "ViberVN Bot.app/Contents/MacOS" >/dev/null; then osascript -e 'tell application "ViberVN Bot" to quit' || true; sleep 3; fi

# gateway (Python payload): onboarding strings patch + t() overlay catalog (~/.vibervnbot/locales/vi.yaml, survives updates)
GW="$RES/agent-payload/vibervnbot-agent"
if [ -d "$GW" ]; then
  python3 gateway/patch-gateway.py "$GW"      # rebuilds touched files from .orig, clears their __pycache__
  mkdir -p "$HOME/.vibervnbot/locales" && cp gateway/locales-vi.yaml "$HOME/.vibervnbot/locales/vi.yaml"
fi

rm -rf work && mkdir -p work/assets
for f in "${CHUNKS[@]}"; do cp "$f.orig" "work/assets/$(basename "$f")"; done
node build-vi.mjs work/assets
node patch-renderer.mjs work/assets
for f in "${CHUNKS[@]}"; do cp "work/assets/$(basename "$f")" "$f"; done

I18N=$(ls "$ASSETS"/i18n-*.js)
grep -q 'id:`vi`' "$I18N" || { echo "patch missing in $I18N" >&2; exit 1; }
codesign --force --deep --sign - "$APP"
open -a "$APP"
echo "installed. Pick Settings > Language > Tiếng Việt."

# ViberVN Bot: Vietnamese (`vi`) locale

Adds a full Vietnamese UI locale to the ViberVN Bot desktop app (tested on 0.3.0, macOS arm64) by patching the
renderer chunks. The app is closed-source and has no `vi` locale, so this is a local patch plus a reproducible
pipeline. `vi.json` is the standalone dictionary (flat, keyed by JSON path) and can be attached to an upstream
issue/PR; `vi.js` is the same dictionary as an object literal.

## What the patch does

The renderer chunks are NOT inside `app.asar`: they live in `Contents/Resources/app.asar.unpacked/dist/assets/`
(asar "unpacked"). Electron fuses `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` are disabled, so
the files are patched in place; `app.asar` itself is untouched (a copy is kept as `app.asar.orig`).

In the i18n chunk (`i18n-<hash>.js`):

- dictionary map `N={en:...}` gets `vi`, built as `en` deep-merged with the Vietnamese overlay (any key without a
  translation falls back to English, same as the other locales do at runtime via `bu()`).
- locale registry array gets `{id:'vi',name:'Tiếng Việt',englishName:'Vietnamese',configValue:'vi'}`
  (this is what the Settings > Appearance > General > Language picker lists).
- endonym map gets `vi:'Tiếng Việt'`; alias map gets `vi`, `vi-vn`, `vi_vn`, `vietnamese`, `tiếng việt`
  (so a Vietnamese macOS picks `vi` automatically when no language is saved).

Four feature dictionaries live in other chunks as `X={en,ja,zh,...}` (kanban, radio, group chat, schedule editor in
`main-*.js` and `profile-ops-*.js`). Each gets a `vi:` property inserted right after `en`.

The chosen language is stored by the app in `~/.vibervnbot/config.yaml` under `display.language` (gateway accepts `vi`).

## Files

| file | purpose |
| --- | --- |
| `load-i18n.mjs`, `lib.mjs` | load a minified chunk in Node with sibling imports stubbed; flatten/overlay helpers; acorn-based finder for `{en,ja,zh}` dictionaries |
| `extract-en.mjs` | `en` tree -> `en.json` (strings by path, functions as source text) |
| `translate.mjs` | `en.json` -> `vi.json` through an OpenAI-compatible endpoint; resumable via `cache.json`; validates every result |
| `build-vi.mjs` | generates `vi.js` and injects the locale into pristine chunks |
| `install.sh` | backs up, rebuilds from pristine chunks, ad-hoc codesigns, restarts the app |

## Install (translation already done)

```sh
./install.sh                      # default /Applications/ViberVN Bot.app
```

Then open Settings > Appearance > General > Language > Tiếng Việt. To persist it from outside the UI, set
`display: {language: vi}` in `~/.vibervnbot/config.yaml` (the UI selection does exactly this).
Uninstall: copy every `*.orig` back over its chunk (`for f in .../assets/*.orig; do cp "$f" "${f%.orig}"; done`),
then `codesign --force --deep --sign - "/Applications/ViberVN Bot.app"`.

## Rebuild after an app update

An update replaces the chunks (new hashes) and the signature, so the patch is gone. To re-apply:

```sh
# 1. extract the new unpacked renderer assets (or point at the installed app's assets dir)
A="/Applications/ViberVN Bot.app/Contents/Resources/app.asar.unpacked/dist/assets"
# 2. only if the English text changed: re-extract and translate the delta (cache.json keeps old translations)
npm i                                   # acorn
node extract-en.mjs "$A"                # needs an UNPATCHED assets dir, e.g. the fresh update before install.sh
SUB2API_KEY=... node translate.mjs      # only new/changed strings are sent; endpoint/model via SUB2API_BASE / SUB2API_MODEL
# 3. patch + sign + restart
./install.sh
```

`extract-en.mjs` must see pristine chunks. After an update they are pristine; later, use the `*.orig` copies
(`mkdir t && cp "$A"/*.orig t/ && rename`, or just run the extract before `install.sh`).
If the minifier changes shapes, `build-vi.mjs` fails loudly with `anchor not found: ...`; the anchors are the
registry array, `{af:\`Afrikaans\`,` endonym map, `{en:\`en\`,"en-us":\`en\`` alias map and `,N={en:X,`.

## What is machine-translated

All of it: the dictionary was produced by `gpt-6-sol` via the sub2api endpoint, in casual-direct tone ("bạn"),
keeping product names and technical terms (API, token, model, plugin, skill, prompt, MCP, CLI...) in English.
Placeholders are machine-checked: strings must keep identical `{0}`/`{name}` tokens, markup, URLs and newlines;
function entries (`e=>\`...${e}...\``) must parse to an identical AST apart from template-literal text.
No native-speaker review has been done; expect some stiff or inconsistent wording.

## Not translated

- Text that comes from the gateway/backend and is not part of the renderer dictionary (automation templates,
  tool names/descriptions, bundled skill text, model/provider names, the agent's own replies).
- Symbol-only strings (`.`, `0`, dashes), brand names, keyboard keys, code identifiers.
- Any leaf whose value is neither a string, a string array nor a function (none exist in 0.3.0).

// Usage: node build-vi.mjs <assetsDir>   (patches chunks in place; run on pristine copies of them)
// Reads vi.json, writes vi.js (the overlay), injects the `vi` locale into the i18n chunk (dictionary, registry entry, name map, aliases)
// and into the extra per-locale dictionaries listed in vi.json `extra`.
import fs from 'node:fs';
import path from 'node:path';
import { findChunk } from './load-i18n.mjs';
import { overlaySource, findDicts } from './lib.mjs';

const dir = process.argv[2] ?? '/tmp/vvn/dist/assets';
const file = findChunk(dir);
let src = fs.readFileSync(file, 'utf8');
if (/\{id:`vi`,name:/.test(src)) throw new Error('chunk already patched; re-extract app.asar.orig first');
const vi = JSON.parse(fs.readFileSync('vi.json', 'utf8'));

const overlay = overlaySource(vi.strings, vi.functions);
fs.writeFileSync('vi.js', `// Vietnamese overlay (build-vi.mjs output), deep-merged over \`en\` (untranslated keys fall back to English).\nexport default ${overlay};\n`);

const once = (re, fn, what) => {
  const m = re.exec(src);
  if (!m) throw new Error(`anchor not found: ${what}`);
  src = src.slice(0, m.index) + fn(m) + src.slice(m.index + m[0].length);
};
// dictionary map: vi is `en` deep-merged with the overlay, so unlisted keys stay English
const MERGE = `function m(a,b){if(typeof a!=\`object\`||!a||Array.isArray(a)||typeof b!=\`object\`||!b||Array.isArray(b))return b;let r={...a};for(let k in b)r[k]=k in a?m(a[k],b[k]):b[k];return r}`;
once(/,N=\{en:([\w$]+),/, (m) => `${m[0]}vi:(${MERGE})(${m[1]},${overlay}),`, 'dictionary map N={en:X,');
// endonym map `_`
once(/\{af:`Afrikaans`,/, (m) => `{vi:\`Tiếng Việt\`,${m[0].slice(1)}`, 'endonym map');
// locale registry array, appended after the es entry
once(/\{id:`en`,name:([\w$]+)\.en,[\s\S]*?configValue:`es`\}/, (m) => `${m[0]},{id:\`vi\`,name:${m[1]}.vi,englishName:\`Vietnamese\`,configValue:\`vi\`}`, 'locale registry');
// alias map (browser/OS locale strings -> id)
once(/\{en:`en`,"en-us":`en`/, (m) => `{vi:\`vi\`,"vi-vn":\`vi\`,vi_vn:\`vi\`,vietnamese:\`vi\`,"tiếng việt":\`vi\`,${m[0].slice(1)}`, 'alias map');
fs.writeFileSync(file, src);

// extra per-locale dictionaries (kanban, radio, group chat, schedule): insert `vi:{...}` right after the `en` property
const byFile = {};
for (const key of Object.keys(vi.extra ?? {})) { const i = key.lastIndexOf('/'); (byFile[key.slice(0, i)] ??= []).push(key.slice(i + 1)); }
for (const [name, dictNames] of Object.entries(byFile)) {
  const f = path.join(dir, name);
  const { src: s0, dicts } = findDicts(f);
  const ins = dictNames.map((dn) => {
    const d = dicts.find((x) => x.name === dn);
    if (!d) throw new Error(`dictionary ${dn} not found in ${name}`);
    if (d.hasVi) throw new Error(`${name}/${dn} already has a vi entry; run on pristine chunks`);
    const e = vi.extra[`${name}/${dn}`];
    return [d.enEnd, `,vi:${overlaySource(e.strings, e.functions, e.canonicalRef ? { canonical: `${e.canonicalRef}.vi` } : {})}`];
  }).sort((a, b) => b[0] - a[0]);
  let s = s0;
  for (const [pos, text] of ins) s = s.slice(0, pos) + text + s.slice(pos);
  fs.writeFileSync(f, s);
  console.log(`patched ${f}: ${ins.length} dictionaries`);
}
console.log(`patched ${file}: overlay ${(overlay.length / 1024) | 0} KB`);

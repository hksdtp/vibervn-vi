// Usage: node build-vi.mjs <assetsDir>   (patches the i18n chunk in place; always run on a pristine extract)
// Reads vi.json, writes vi.js (the overlay), injects the `vi` locale: dictionary, registry entry, name map, aliases.
import fs from 'node:fs';
import { findChunk } from './load-i18n.mjs';

const dir = process.argv[2] ?? '/tmp/vvn/dist/assets';
const file = findChunk(dir);
let src = fs.readFileSync(file, 'utf8');
if (/\{id:`vi`,name:/.test(src)) throw new Error('chunk already patched; re-extract app.asar.orig first');
const vi = JSON.parse(fs.readFileSync('vi.json', 'utf8'));

// overlay tree: strings as JSON literals, functions as raw source; numeric path segments make arrays
const root = {};
const put = (key, val) => {
  const p = JSON.parse(key);
  let o = root;
  p.forEach((seg, i) => {
    if (i === p.length - 1) o[seg] = val;
    else o = o[seg] ??= typeof p[i + 1] === 'number' ? [] : {};
  });
};
for (const [k, v] of Object.entries(vi.strings)) put(k, { lit: JSON.stringify(v) });
for (const [k, v] of Object.entries(vi.functions)) put(k, { lit: v });
const ser = (n) => (n.lit !== undefined ? n.lit : Array.isArray(n) ? `[${n.map((x) => (x === undefined ? '' : ser(x))).join(',')}]` : `{${Object.entries(n).map(([k, v]) => `${JSON.stringify(k)}:${ser(v)}`).join(',')}}`);
const overlay = ser(root);
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
console.log(`patched ${file}: overlay ${(overlay.length / 1024) | 0} KB`);

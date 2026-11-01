// Usage: node extract-en.mjs [assetsDir=/tmp/vvn/dist/assets]  ->  en.json
// Loads the i18n chunk with stubbed imports and flattens the `en` dictionary.
// Leaf key = JSON path array, e.g. ["settings","language","label"] (array items use numeric index).
// strings: path -> text; functions: path -> source text (Function#toString).
import fs from 'node:fs';
import { loadI18n, findChunk } from './load-i18n.mjs';

const dir = process.argv[2] ?? '/tmp/vvn/dist/assets';
const { en } = await loadI18n(findChunk(dir));
const out = { strings: {}, functions: {}, other: {} };
const plain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
function walk(o, p) {
  for (const [k, v] of Object.entries(o)) {
    const path = [...p, Array.isArray(o) ? Number(k) : k];
    const key = JSON.stringify(path);
    if (typeof v === 'string') out.strings[key] = v;
    else if (typeof v === 'function') out.functions[key] = v.toString();
    else if (plain(v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) walk(v, path);
    else out.other[key] = String(v);
  }
}
walk(en, []);
if (Object.keys(out.other).length) console.error('unhandled leaves:', out.other);
fs.writeFileSync('en.json', JSON.stringify(out, null, 1));
console.log(`strings=${Object.keys(out.strings).length} functions=${Object.keys(out.functions).length} other=${Object.keys(out.other).length}`);

// Usage: node extract-en.mjs [assetsDir=/tmp/vvn/dist/assets]  ->  en.json
// 1. i18n chunk: loaded in Node with stubbed imports, `en` flattened to leaves.
// 2. extra chunks (main-*, profile-ops-*): top-level {en,ja,zh,...} dictionaries found with acorn, `en` evaluated and flattened.
// Leaf key = JSON path array. strings: path -> text; functions: path -> source text (Function#toString).
import fs from 'node:fs';
import path from 'node:path';
import { loadI18n, findChunk, findExtraChunks } from './load-i18n.mjs';
import { flatten, findDicts } from './lib.mjs';

const dir = process.argv[2] ?? '/tmp/vvn/dist/assets';
const { en } = await loadI18n(findChunk(dir));
const out = flatten(en);
out.extra = {};
for (const file of findExtraChunks(dir)) {
  const prefix = path.basename(file);
  for (const d of findDicts(file).dicts) {
    const f = flatten(d.en);
    out.extra[`${prefix}/${d.name}`] = { ...f, canonicalRef: d.canonicalRef };
    console.log(`extra ${prefix}/${d.name}: strings=${Object.keys(f.strings).length} functions=${Object.keys(f.functions).length} other=${Object.keys(f.other).length} canonical=${d.canonicalRef}`);
  }
}
for (const [k, v] of Object.entries({ main: out.other, ...Object.fromEntries(Object.entries(out.extra).map(([k, v]) => [k, v.other])) })) if (Object.keys(v).length) console.error('unhandled leaves in', k, v);
fs.writeFileSync('en.json', JSON.stringify(out, null, 1));
console.log(`i18n: strings=${Object.keys(out.strings).length} functions=${Object.keys(out.functions).length} other=${Object.keys(out.other).length}`);

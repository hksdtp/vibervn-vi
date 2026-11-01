// Loads a minified Vite/Rolldown chunk in Node with sibling-chunk imports replaced by a catch-all stub,
// and returns the requested top-level bindings (appended as an export).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// chunks whose text contains a `"zh-hant":` locale key (per-locale dictionaries), except the i18n chunk itself
export function findExtraChunks(assetsDir) {
  return fs.readdirSync(assetsDir).filter((n) => n.endsWith('.js') && !n.startsWith('i18n-') && fs.readFileSync(path.join(assetsDir, n), 'utf8').includes('"zh-hant":')).map((n) => path.join(assetsDir, n));
}

export function findChunk(assetsDir, prefix = 'i18n') {
  const f = fs.readdirSync(assetsDir).filter((n) => new RegExp(`^${prefix}-[\\w-]+\\.js$`).test(n));
  if (f.length !== 1) throw new Error(`expected exactly one ${prefix} chunk, got ${f}`);
  return path.join(assetsDir, f[0]);
}

const STUB = `const __mk=()=>new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>'':__mk(),apply:()=>__mk(),construct:()=>__mk()});
const __s=__mk();`;

export async function loadChunk(file, names) {
  const src = fs.readFileSync(file, 'utf8');
  let first = true;
  let patched = src.replace(/import\{([^}]*)\}from"\.\/[^"]+";/g, (_, list) => {
    const ns = list.split(',').map((p) => p.trim().split(/\s+as\s+/).pop());
    const head = first ? STUB : '';
    first = false;
    return `${head}const ${ns.map((n) => `${n}=__s`).join(',')};`;
  });
  patched = patched.replace(/import"\.\/[^"]+";/g, '');
  if (first) patched = STUB + patched;
  patched = patched.replace(/^const __vite__mapDeps=.*$/m, 'const __vite__mapDeps=()=>[];');
  patched += `\n;export const __d={${names.join(',')}};`;
  const tmp = path.join(os.tmpdir(), `chunk-load-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, patched);
  try {
    return (await import(pathToFileURL(tmp).href)).__d;
  } finally {
    fs.unlinkSync(tmp);
  }
}

export async function loadI18n(file) {
  const src = fs.readFileSync(file, 'utf8');
  const enName = /,N=\{en:([A-Za-z_$][\w$]*),/.exec(src)?.[1];
  if (!enName) throw new Error('cannot find `N={en:X,` registry');
  const d = await loadChunk(file, ['N', `${enName}`]);
  return { en: d[enName], N: d.N, src, enName };
}

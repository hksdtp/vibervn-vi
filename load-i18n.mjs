// Loads the minified i18n chunk in Node with sibling-chunk imports stubbed, returns {en, N, src, file}.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export function findChunk(assetsDir) {
  const f = fs.readdirSync(assetsDir).filter((n) => /^i18n-.*\.js$/.test(n));
  if (f.length !== 1) throw new Error(`expected exactly one i18n chunk, got ${f}`);
  return path.join(assetsDir, f[0]);
}

const STUB = `const __mk=()=>new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>'':__mk(),apply:()=>__mk(),construct:()=>__mk()});
const __s=__mk();`;

export async function loadI18n(file) {
  const src = fs.readFileSync(file, 'utf8');
  // replace `import{a as b,...}from"./x.js";` by stub bindings
  let first = true;
  let patched = src.replace(/import\{([^}]*)\}from"\.\/[^"]+";/g, (_, list) => {
    const names = list.split(',').map((p) => p.trim().split(/\s+as\s+/).pop());
    const head = first ? STUB : '';
    first = false;
    return `${head}const ${names.map((n) => `${n}=__s`).join(',')};`;
  });
  const enName = /,N=\{en:([A-Za-z_$][\w$]*),/.exec(src)?.[1];
  if (!enName) throw new Error('cannot find `N={en:X,` registry');
  patched += `\n;export const __N=N,__en=${enName};`;
  patched = patched.replace(/^const __vite__mapDeps=.*$/m, 'const __vite__mapDeps=()=>[];');
  const tmp = path.join(os.tmpdir(), `i18n-load-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, patched);
  try {
    const m = await import(pathToFileURL(tmp).href);
    return { en: m.__en, N: m.__N, src, enName };
  } finally {
    fs.unlinkSync(tmp);
  }
}

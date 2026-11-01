// Shared helpers: flatten a locale tree to leaves, rebuild an overlay source literal, find extra per-locale dictionaries.
import fs from 'node:fs';
import * as acorn from 'acorn';

export const STUB = Symbol.for('vi.stub');
const plain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

// leaf key = JSON path array (array items use numeric index)
export function flatten(tree, out = { strings: {}, functions: {}, other: {} }, prefix = []) {
  for (const [k, v] of Object.entries(tree)) {
    const path = [...prefix, Array.isArray(tree) ? Number(k) : k];
    const key = JSON.stringify(path);
    if (typeof v === 'string') out.strings[key] = v;
    else if (v && v[STUB]) continue; // reference to another dictionary, handled separately
    else if (typeof v === 'function') out.functions[key] = v.toString();
    else if (plain(v) || (Array.isArray(v) && v.every((x) => typeof x === 'string'))) flatten(v, out, path);
    else out.other[key] = String(v);
  }
  return out;
}

// JS source of a nested object literal from flat translations
export function overlaySource(strings, functions, extraTop = {}) {
  const root = {};
  const put = (key, val) => {
    const p = JSON.parse(key);
    let o = root;
    p.forEach((seg, i) => {
      if (i === p.length - 1) o[seg] = val;
      else o = o[seg] ??= typeof p[i + 1] === 'number' ? [] : {};
    });
  };
  for (const [k, v] of Object.entries(strings)) put(k, { lit: JSON.stringify(v) });
  for (const [k, v] of Object.entries(functions)) put(k, { lit: v });
  for (const [k, v] of Object.entries(extraTop)) root[k] = { lit: v };
  const ser = (n) => (n.lit !== undefined ? n.lit : Array.isArray(n) ? `[${n.map((x) => (x === undefined ? '' : ser(x))).join(',')}]` : `{${Object.entries(n).map(([k, v]) => `${JSON.stringify(k)}:${ser(v)}`).join(',')}}`);
  return ser(root);
}

// Evaluate an expression with every free identifier resolving to a catch-all stub.
function evalLoose(code) {
  const mk = () => new Proxy(function () {}, { get: (t, k) => (k === STUB ? true : k === Symbol.toPrimitive ? () => '' : mk()), apply: () => mk(), construct: () => mk() });
  const scope = new Proxy({}, { has: (t, k) => typeof k === 'string' && k !== '__r', get: (t, k) => (k === Symbol.unscopables ? undefined : mk()) });
  return new Function('__scope', `with(__scope){return (${code})}`)(scope);
}

// Top-level `X={en:..., ja:..., zh:...}` dictionaries (per-locale maps used by plugins/features).
export function findDicts(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  const decls = new Map();
  for (const st of ast.body) if (st.type === 'VariableDeclaration') for (const d of st.declarations) if (d.id.type === 'Identifier' && d.init) decls.set(d.id.name, d.init);
  const keyName = (p) => (p.key.type === 'Identifier' ? p.key.name : p.key.value);
  const out = [];
  for (const [name, init] of decls) {
    if (init.type !== 'ObjectExpression') continue;
    const props = new Map(init.properties.filter((p) => p.type === 'Property').map((p) => [keyName(p), p]));
    if (!props.has('en') || !props.has('ja') || !props.has('zh')) continue;
    const enProp = props.get('en');
    const enNode = enProp.value.type === 'Identifier' ? decls.get(enProp.value.name) : enProp.value;
    if (!enNode) continue;
    const jaNode = props.get('ja').value;
    let canonicalRef = null;
    if (jaNode.type === 'ObjectExpression') {
      const c = jaNode.properties.find((p) => p.type === 'Property' && keyName(p) === 'canonical');
      if (c?.value.type === 'MemberExpression' && c.value.object.type === 'Identifier') canonicalRef = c.value.object.name;
    }
    out.push({ name, hasVi: props.has('vi'), enEnd: enProp.end, canonicalRef, en: evalLoose(src.slice(enNode.start, enNode.end)) });
  }
  return { src, dicts: out };
}

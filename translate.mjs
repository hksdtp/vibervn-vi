// Usage: node translate.mjs   (en.json -> vi.json; resumable via cache.json)
// Env: SUB2API_KEY (or read from SUB2API_ENV_FILE, default /Users/nihdev/spec-ade-native/.env.local),
//      SUB2API_BASE (default http://100.115.227.21:8090/v1), SUB2API_MODEL (default gpt-6-sol), CONCURRENCY (default 6)
import fs from 'node:fs';
import * as acorn from 'acorn';

const BASE = process.env.SUB2API_BASE ?? 'http://100.115.227.21:8090/v1';
const MODEL = process.env.SUB2API_MODEL ?? 'gpt-6-sol';
const CONC = Number(process.env.CONCURRENCY ?? 6);
const envFile = process.env.SUB2API_ENV_FILE ?? '/Users/nihdev/spec-ade-native/.env.local';
const KEY = process.env.SUB2API_KEY ?? fs.readFileSync(envFile, 'utf8').match(/^SUB2API_KEY=(.*)$/m)[1].replace(/^["']|["']$/g, '');

const en = JSON.parse(fs.readFileSync('en.json', 'utf8'));
const CACHE = 'cache.json';
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));

// ---- validation ----
// Function: same AST once template-literal text is blanked out (only quasis may change).
export function skeleton(src) {
  const ast = acorn.parse(`x=${src}`, { ecmaVersion: 'latest' });
  return JSON.stringify(ast, (k, v) => (k === 'start' || k === 'end' || k === 'raw' ? undefined : k === 'value' && v && typeof v === 'object' && 'cooked' in v ? '' : v));
}
const tokens = (s) => (s.match(/\{[A-Za-z0-9_]*\}|<\/?[A-Za-z][^<>]*>|https?:\/\/[^\s)]+|\\n|\n|`[^`]*`|\$\{[^}]*\}|%[sd]/g) ?? []).sort().join('\u0000');
export function validate(kind, src, out) {
  if (typeof out !== 'string' || !out.trim() && src.trim()) return 'empty';
  if (kind === 'f') {
    try { if (skeleton(src) !== skeleton(out)) return 'function structure changed (only text inside template literals may change)'; } catch (e) { return `function does not parse: ${e.message}`; }
    return null;
  }
  if (tokens(src) !== tokens(out)) return `placeholders/markup/newlines differ: expected ${JSON.stringify(tokens(src).split('\u0000'))}`;
  return null;
}

// ---- units ----
const units = new Map(); // text -> {kind, hint}
for (const [k, v] of Object.entries(en.strings)) if (!units.has('s' + v)) units.set('s' + v, { kind: 's', text: v, hint: JSON.parse(k).join('.') });
for (const [k, v] of Object.entries(en.functions)) if (!units.has('f' + v)) units.set('f' + v, { kind: 'f', text: v, hint: JSON.parse(k).join('.') });
for (const [dn, d] of Object.entries(en.extra)) {
  for (const [k, v] of Object.entries(d.strings)) if (!units.has('s' + v)) units.set('s' + v, { kind: 's', text: v, hint: `${dn}:${JSON.parse(k).join('.')}` });
  for (const [k, v] of Object.entries(d.functions)) if (!units.has('f' + v)) units.set('f' + v, { kind: 'f', text: v, hint: `${dn}:${JSON.parse(k).join('.')}` });
}
const translatable = (u) => u.kind === 'f' || /\p{L}/u.test(u.text);
const todo = [...units.entries()].filter(([ck, u]) => translatable(u) && !(ck in cache));
console.log(`units=${units.size} cached=${Object.keys(cache).length} todo=${todo.length}`);

const SYSTEM = `You are a professional software localizer translating the UI of "ViberVN Bot" (a desktop AI agent app) from English to Vietnamese.
Rules:
- Tone: casual, direct, friendly; address the user as "bạn". Short UI labels stay short (buttons, menu items, tabs) - natural Vietnamese software wording, not literal word-for-word.
- Keep product/brand names (ViberVN Bot, Claude, OpenAI, GitHub, Telegram...), and tech terms in English: API, token, model, plugin, skill, prompt, MCP, CLI, SSH, URL, JSON, gateway, session when used as a technical noun is OK to translate as "phiên".
- "Show computer" → "Hiện máy tính". Keep keyboard keys (Cmd, Ctrl, Shift, Enter, Esc), file paths, commands, code, env vars, emoji, URLs unchanged.
- PRESERVE EXACTLY: {0}-style / {name} placeholders, \${...} expressions, backticks, markdown, HTML tags, newlines, leading/trailing spaces and punctuation conventions.
- Items of kind "s" are plain strings: return the translated string.
- Items of kind "f" are JavaScript arrow functions. Return the FULL function source with identical code (parameters, \${} expressions, conditionals, operators, string/number literals outside template text); translate ONLY the human text inside template literals (backtick strings). Vietnamese has no plural: for plural conditionals like \${e===1?\`\`:\`s\`} keep the same code but use empty text where English adds "s". Keep the conditional branches structurally identical (you may make both branches the same text).
- If an item is not translatable (a code identifier, a number, a symbol), return it unchanged.
Input: JSON object {"id": {"kind":"s"|"f","hint":"<key path for context>","text":"..."}}.
Output: ONLY a JSON object {"id":"<translation>"} with every id, no code fences, no commentary.`;

async function chat(messages) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: MODEL, messages }) });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).choices[0].message.content;
    } catch (e) {
      if (a >= 5) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (a + 1)));
    }
  }
}
const parseJson = (t) => JSON.parse(t.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));

async function runBatch(items, feedback = {}) {
  const payload = {};
  items.forEach(([ck, u], i) => (payload[i] = { kind: u.kind, hint: u.hint, text: u.text, ...(feedback[ck] ? { previous_error: feedback[ck] } : {}) }));
  const content = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(payload) }]);
  let res;
  try { res = parseJson(content); } catch { return items; }
  const failed = [];
  items.forEach(([ck, u], i) => {
    const err = validate(u.kind, u.text, res[i]);
    if (err) { feedback[ck] = err; failed.push([ck, u]); } else cache[ck] = res[i];
  });
  return failed;
}

// batches by size
const batches = [];
for (let i = 0, cur = [], size = 0; i <= todo.length; i++) {
  const it = todo[i];
  if (!it || cur.length >= 60 || size + it[1].text.length > 7000) { if (cur.length) batches.push(cur); cur = []; size = 0; }
  if (it) { cur.push(it); size += it[1].text.length; }
}
let done = 0;
const feedback = {};
async function worker(q) {
  while (q.length) {
    let b = q.shift();
    for (let round = 0; round < 4 && b.length; round++) {
      b = await runBatch(b, feedback);
      if (b.length && b.length > 8) { // split big failures so the model focuses
        const h = b.length >> 1; const [x, y] = [b.slice(0, h), b.slice(h)];
        b = [...await runBatch(x, feedback), ...await runBatch(y, feedback)];
      }
    }
    for (const [ck] of b) cache[ck] = null; // gave up: left in English
    done++; save();
    console.log(`batch ${done}/${batches.length} cached=${Object.keys(cache).length} giveups=${b.length}`);
  }
}
const q = [...batches];
await Promise.all(Array.from({ length: CONC }, () => worker(q)));
save();

// ---- assemble vi.json: same keys as en.json; missing => left in English ----
const vi = { strings: {}, functions: {}, extra: {} };
let tr = 0, left = 0;
const fill = (src, dst) => {
  for (const [kind, map, outMap] of [['s', src.strings, dst.strings], ['f', src.functions, dst.functions]])
    for (const [k, v] of Object.entries(map)) {
      const t = cache[kind + v];
      if (typeof t === 'string') { outMap[k] = t; tr++; } else if (kind === 's' && !/\p{L}/u.test(v)) { /* symbol-only: nothing to translate */ } else left++;
    }
};
fill(en, vi);
for (const [dn, d] of Object.entries(en.extra)) fill(d, (vi.extra[dn] = { strings: {}, functions: {}, canonicalRef: d.canonicalRef }));
fs.writeFileSync('vi.json', JSON.stringify(vi, null, 1));
console.log(`vi.json: translated leaves=${tr}, left in English=${left}`);

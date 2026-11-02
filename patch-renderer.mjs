// Behaviour patches for the renderer chunks in work/assets, run after build-vi; an anchor that is missing or repeated aborts the install.
// Why: the composer middleware puts a roster note into the prompt text, so the bubble printed it; the model needs the note, the user does not.
// Fix: send the note but give the send function the typed text as displayText.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'work/assets';
const anchor = 'return a?e(a.text,{...n,attachments:a.attachments}):!1';
const patched = 'return a?e(a.text,{...n,attachments:a.attachments,...(a.text!==t&&n?.displayText==null?{displayText:t}:{})}):!1';

let applied = 0;
for (const f of fs.readdirSync(dir).filter(name => /^main-.*\.js$/.test(name))) {
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, 'utf8');
  if (!s.includes(anchor)) continue;
  if (s.split(anchor).length !== 2) throw new Error(`${f}: mention anchor is not unique`);
  fs.writeFileSync(p, s.replace(anchor, patched));
  applied++;
  console.log(`mention-note patch applied: ${f}`);
}
if (!applied) throw new Error('mention-note anchor not found in any main-*.js; the app changed, derive the anchor again');

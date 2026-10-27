// Checks data/content.json for structural problems. Run: npm run check-content
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'data/content.json';
const raw = readFileSync(path, 'utf8');
const problems = [];

const EM_DASH = String.fromCharCode(0x2014);
if (raw.includes(EM_DASH)) problems.push('contains an em dash character');

let c;
try {
  c = JSON.parse(raw);
} catch (e) {
  console.error(`${path}: does not parse: ${e.message}`);
  process.exit(1);
}

for (const key of ['meta', 'passages', 'questions', 'quotes', 'speakerPool', 'timeline', 'characters', 'vocab']) {
  if (!(key in c)) problems.push(`missing top-level key ${key}`);
}

const ids = new Set();
for (const q of c.questions || []) {
  const where = `question ${q.id || '(no id)'}`;
  if (!q.id) problems.push(`${where}: missing id`);
  else if (ids.has(q.id)) problems.push(`${where}: duplicate id`);
  ids.add(q.id);
  if (![1, 2, 3].includes(q.part)) problems.push(`${where}: part must be 1, 2 or 3`);
  if (!q.prompt) problems.push(`${where}: missing prompt`);
  if (!q.answer) problems.push(`${where}: missing answer`);
  if (!Array.isArray(q.distractors) || q.distractors.length !== 3) problems.push(`${where}: needs exactly 3 distractors`);
  else if (q.distractors.includes(q.answer)) problems.push(`${where}: a distractor equals the answer`);
  if (!Array.isArray(q.tags) || q.tags.length === 0) problems.push(`${where}: needs at least one tag`);
  if (q.part === 3 && !(c.passages || {})[q.passageId]) problems.push(`${where}: passageId ${q.passageId} not found in passages`);
  if (q.part !== 3 && q.passageId) problems.push(`${where}: only Part 3 questions should have a passageId`);
}

const pool = new Set(c.speakerPool || []);
for (const qt of c.quotes || []) {
  if (!qt.text || !qt.speaker) problems.push(`quote ${qt.id}: needs text and speaker`);
  if (!pool.has(qt.speaker)) problems.push(`quote ${qt.id}: speaker "${qt.speaker}" is not in speakerPool`);
}

const orders = (c.timeline || []).map((t) => t.order).sort((a, b) => a - b);
orders.forEach((o, i) => { if (o !== i + 1) problems.push(`timeline order values must be 1..n without gaps (saw ${o} at position ${i + 1})`); });

for (const v of c.vocab || []) {
  if (!v.word || !v.definition) problems.push(`vocab ${v.id}: needs word and definition`);
}

if (problems.length) {
  console.error(`${path}: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const q = c.questions;
const count = (k) => q.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.log(`${path}: ok`);
console.log(`  questions ${q.length} (sets ${JSON.stringify(count('set'))}, parts ${JSON.stringify(count('part'))})`);
console.log(`  passages ${Object.keys(c.passages).length}, quotes ${c.quotes.length}, timeline ${c.timeline.length}, characters ${c.characters.length}, vocab ${c.vocab.length}`);

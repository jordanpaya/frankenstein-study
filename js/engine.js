// Pure game logic. No DOM, no storage. Shared by the browser app and the Node tests.

// Timer seconds per exam part in Normal mode. Extended multiplies by 1.5.
export const TIMERS = { 1: 20, 2: 30, 3: 45 };
export const EXTENDED_FACTOR = 1.5;

// Scoring: a correct answer is worth 500 to 1000 points by speed.
// Three or more correct in a row adds a flat 200. Timer off gives a flat 750.
export const SCORE = {
  base: 500,
  speedMax: 500,
  flatNoTimer: 750,
  streakBonus: 200,
  streakFrom: 3
};

export const PART_LABELS = {
  1: 'Part 1: Plot and quotes',
  2: 'Part 2: Analysis',
  3: 'Part 3: Passages'
};

export const TAG_LABELS = {
  frame: 'Walton and the frame story',
  'victor-early': "Victor's early life",
  creation: 'The creation',
  william: "William's murder",
  'justine-trial': "Justine's trial",
  alps: 'The Alps and Montanvert',
  'de-laceys': 'The De Laceys',
  books: 'Books and learning',
  'lightning-fire': 'Lightning and fire',
  demand: "The creature's demand",
  general: 'Reading passages closely'
};

// Deterministic random numbers so a shared set code gives everyone the same race.
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
  if (a === 0) a = 0x9e3779b9;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// Builds the four options for a question with the answer in a random position.
export function buildOptions(question, rng = Math.random) {
  const options = [{ text: question.answer, correct: true }]
    .concat(question.distractors.map((d) => ({ text: d, correct: false })));
  return shuffle(options, rng);
}

export function timerFor(part, mode) {
  if (mode === 'off') return null;
  const base = TIMERS[part] || TIMERS[1];
  if (mode === 'extended') return Math.round(base * EXTENDED_FACTOR);
  return base;
}

// Returns the points for one answer and the new streak.
export function scoreAnswer({ correct, timeLeft, timeTotal, streak }) {
  if (!correct) return { points: 0, speedPoints: 0, streakBonus: 0, streak: 0 };
  const newStreak = streak + 1;
  let points;
  let speedPoints;
  if (timeTotal == null) {
    points = SCORE.flatNoTimer;
    speedPoints = SCORE.flatNoTimer - SCORE.base;
  } else {
    const frac = Math.max(0, Math.min(1, timeLeft / timeTotal));
    speedPoints = Math.round((SCORE.speedMax * frac) / 10) * 10;
    points = SCORE.base + speedPoints;
  }
  const streakBonus = newStreak >= SCORE.streakFrom ? SCORE.streakBonus : 0;
  return { points: points + streakBonus, speedPoints, streakBonus, streak: newStreak };
}

export function defaultProgress() {
  return { questions: {}, cards: {} };
}

function stat(progress, id) {
  if (!progress.questions[id]) {
    progress.questions[id] = { seen: 0, right: 0, wrong: 0, lastWrong: false };
  }
  return progress.questions[id];
}

// Higher weight means the question is more likely to be picked.
// Unseen questions and recently missed ones come up first.
export function pickWeight(progress, id) {
  const s = progress.questions[id];
  if (!s || s.seen === 0) return 3;
  let w = 1 + s.wrong * 2;
  if (s.lastWrong) w += 3;
  if (s.right > s.wrong + 1) w = Math.max(0.5, w - 1);
  return w;
}

// Picks `count` distinct questions. With a seed, picks are uniform so a shared
// set code gives everyone the same questions regardless of their own progress.
export function pickQuestions(questions, progress, count, { rng = Math.random, seeded = false, onlyIds = null } = {}) {
  let pool = questions.slice();
  if (onlyIds) {
    const allow = new Set(onlyIds);
    pool = pool.filter((q) => allow.has(q.id));
  }
  const n = Math.min(count, pool.length);
  const picked = [];
  const remaining = pool.slice();
  for (let i = 0; i < n; i++) {
    const weights = remaining.map((q) => (seeded ? 1 : pickWeight(progress, q.id)));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let idx = 0;
    while (idx < remaining.length - 1 && r >= weights[idx]) {
      r -= weights[idx];
      idx++;
    }
    picked.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return picked;
}

// Records one answered question into progress (mutates and returns progress).
export function recordResult(progress, result) {
  const s = stat(progress, result.id);
  s.seen += 1;
  if (result.correct) {
    s.right += 1;
    s.lastWrong = false;
  } else {
    s.wrong += 1;
    s.lastWrong = true;
  }
  return progress;
}

export function missedIds(progress) {
  return Object.keys(progress.questions).filter((id) => progress.questions[id].lastWrong);
}

// Summarises a finished race: score, accuracy, and per-part accuracy.
export function summarize(results) {
  const byPart = { 1: { correct: 0, total: 0 }, 2: { correct: 0, total: 0 }, 3: { correct: 0, total: 0 } };
  let score = 0;
  let correct = 0;
  let bestStreak = 0;
  let streak = 0;
  for (const r of results) {
    score += r.points;
    const p = byPart[r.part] || (byPart[r.part] = { correct: 0, total: 0 });
    p.total += 1;
    if (r.correct) {
      correct += 1;
      p.correct += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
  }
  const total = results.length;
  return {
    score,
    correct,
    total,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    bestStreak,
    byPart,
    missed: results.filter((r) => !r.correct).map((r) => r.id)
  };
}

// Weakest topics by tag: share of answers wrong, among tags seen at least twice.
export function weakTopics(progress, questions) {
  const byTag = {};
  for (const q of questions) {
    const s = progress.questions[q.id];
    if (!s || s.seen === 0) continue;
    for (const tag of q.tags) {
      const t = byTag[tag] || (byTag[tag] = { tag, seen: 0, wrong: 0, ids: [] });
      t.seen += s.seen;
      t.wrong += s.wrong;
      t.ids.push(q.id);
    }
  }
  return Object.values(byTag)
    .filter((t) => t.seen >= 2)
    .map((t) => ({ ...t, label: TAG_LABELS[t.tag] || t.tag, wrongRate: t.wrong / t.seen }))
    .sort((a, b) => b.wrongRate - a.wrongRate || b.wrong - a.wrong);
}

// Set codes: four characters, easy to read aloud. No 0, O, 1, I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeSetCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeSetCode(input) {
  const code = String(input || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
  return code.length === 4 ? code : null;
}

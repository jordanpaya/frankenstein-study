import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  makeRng, shuffle, buildOptions, timerFor, scoreAnswer, SCORE,
  defaultProgress, pickQuestions, recordResult, missedIds, summarize,
  weakTopics, makeSetCode, normalizeSetCode
} from '../js/engine.js';

const content = JSON.parse(readFileSync(new URL('../data/content.json', import.meta.url), 'utf8'));
const questions = content.questions;

test('seeded rng is deterministic and in range', () => {
  const a = makeRng('ABCD');
  const b = makeRng('ABCD');
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(makeRng('ABCD')(), makeRng('ABCE')());
});

test('shuffle keeps every item exactly once and does not mutate', () => {
  const src = [1, 2, 3, 4, 5, 6];
  const out = shuffle(src, makeRng(7));
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(out.slice().sort(), src);
});

test('correct answer lands in every position over many shuffles', () => {
  const q = questions[0];
  const rng = makeRng(42);
  const positions = new Set();
  for (let i = 0; i < 200; i++) {
    const opts = buildOptions(q, rng);
    assert.equal(opts.length, 4);
    assert.equal(opts.filter((o) => o.correct).length, 1);
    positions.add(opts.findIndex((o) => o.correct));
  }
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
});

test('timers by part and mode', () => {
  assert.equal(timerFor(1, 'normal'), 20);
  assert.equal(timerFor(2, 'normal'), 30);
  assert.equal(timerFor(3, 'normal'), 45);
  assert.equal(timerFor(1, 'extended'), 30);
  assert.equal(timerFor(3, 'extended'), 68);
  assert.equal(timerFor(2, 'off'), null);
});

test('scoring: speed, streak, timer off, wrong', () => {
  const fast = scoreAnswer({ correct: true, timeLeft: 20, timeTotal: 20, streak: 0 });
  assert.equal(fast.points, 1000);
  assert.equal(fast.streak, 1);
  const slow = scoreAnswer({ correct: true, timeLeft: 0, timeTotal: 20, streak: 0 });
  assert.equal(slow.points, 500);
  const half = scoreAnswer({ correct: true, timeLeft: 10, timeTotal: 20, streak: 0 });
  assert.equal(half.points, 750);
  const third = scoreAnswer({ correct: true, timeLeft: 20, timeTotal: 20, streak: 2 });
  assert.equal(third.points, 1000 + SCORE.streakBonus);
  assert.equal(third.streakBonus, 200);
  assert.equal(third.streak, 3);
  const second = scoreAnswer({ correct: true, timeLeft: 20, timeTotal: 20, streak: 1 });
  assert.equal(second.streakBonus, 0);
  const off = scoreAnswer({ correct: true, timeLeft: null, timeTotal: null, streak: 0 });
  assert.equal(off.points, 750);
  const wrong = scoreAnswer({ correct: false, timeLeft: 20, timeTotal: 20, streak: 5 });
  assert.equal(wrong.points, 0);
  assert.equal(wrong.streak, 0);
  const over = scoreAnswer({ correct: true, timeLeft: 99, timeTotal: 20, streak: 0 });
  assert.equal(over.points, 1000);
});

test('pickQuestions never repeats within a set and respects count', () => {
  const progress = defaultProgress();
  for (let seed = 0; seed < 50; seed++) {
    const picked = pickQuestions(questions, progress, 15, { rng: makeRng(seed) });
    assert.equal(picked.length, 15);
    assert.equal(new Set(picked.map((q) => q.id)).size, 15);
  }
  const all = pickQuestions(questions, progress, 999, { rng: makeRng(1) });
  assert.equal(all.length, questions.length);
  assert.equal(new Set(all.map((q) => q.id)).size, questions.length);
});

test('pickQuestions with onlyIds stays inside that list', () => {
  const ids = ['pr-p1-01', 'pr-p1-02', 'ch-p3-63'];
  const picked = pickQuestions(questions, defaultProgress(), 10, { rng: makeRng(3), onlyIds: ids });
  assert.equal(picked.length, 3);
  assert.deepEqual(picked.map((q) => q.id).sort(), ids.slice().sort());
});

test('seeded picks are identical across different progress', () => {
  const p1 = defaultProgress();
  const p2 = defaultProgress();
  for (const q of questions.slice(0, 30)) recordResult(p2, { id: q.id, correct: false });
  const a = pickQuestions(questions, p1, 15, { rng: makeRng('ZZZZ'), seeded: true }).map((q) => q.id);
  const b = pickQuestions(questions, p2, 15, { rng: makeRng('ZZZZ'), seeded: true }).map((q) => q.id);
  assert.deepEqual(a, b);
});

test('missed questions are favoured in later picks', () => {
  const progress = defaultProgress();
  const missed = questions.slice(0, 5).map((q) => q.id);
  for (const q of questions) recordResult(progress, { id: q.id, correct: !missed.includes(q.id) });
  let hits = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const picked = pickQuestions(questions, progress, 10, { rng: makeRng(i) });
    hits += picked.filter((q) => missed.includes(q.id)).length;
  }
  const uniformExpected = trials * 10 * (5 / questions.length);
  assert.ok(hits > uniformExpected * 2, `missed hits ${hits} should be well above uniform ${uniformExpected}`);
});

test('recordResult and missedIds track wrong answers until corrected', () => {
  const progress = defaultProgress();
  recordResult(progress, { id: 'a', correct: false });
  recordResult(progress, { id: 'b', correct: true });
  assert.deepEqual(missedIds(progress), ['a']);
  recordResult(progress, { id: 'a', correct: true });
  assert.deepEqual(missedIds(progress), []);
  assert.equal(progress.questions.a.seen, 2);
  assert.equal(progress.questions.a.wrong, 1);
});

test('summarize totals, accuracy, per part, best streak and missed list', () => {
  const results = [
    { id: 'x1', part: 1, correct: true, points: 1000 },
    { id: 'x2', part: 1, correct: true, points: 800 },
    { id: 'x3', part: 2, correct: false, points: 0 },
    { id: 'x4', part: 3, correct: true, points: 600 }
  ];
  const s = summarize(results);
  assert.equal(s.score, 2400);
  assert.equal(s.correct, 3);
  assert.equal(s.total, 4);
  assert.equal(s.accuracy, 75);
  assert.equal(s.bestStreak, 2);
  assert.deepEqual(s.byPart[1], { correct: 2, total: 2 });
  assert.deepEqual(s.byPart[2], { correct: 0, total: 1 });
  assert.deepEqual(s.missed, ['x3']);
});

test('weakTopics ranks tags with most wrong answers first', () => {
  const progress = defaultProgress();
  const frame = questions.filter((q) => q.tags.includes('frame'));
  for (const q of frame) recordResult(progress, { id: q.id, correct: false });
  const books = questions.filter((q) => q.tags.includes('books') && !q.tags.includes('frame'));
  for (const q of books) recordResult(progress, { id: q.id, correct: true });
  const topics = weakTopics(progress, questions);
  assert.equal(topics[0].tag, 'frame');
  assert.ok(topics[0].wrongRate > 0.9);
  const booksTopic = topics.find((t) => t.tag === 'books');
  assert.ok(booksTopic.wrongRate < topics[0].wrongRate);
});

test('set codes are four readable characters and normalize', () => {
  const code = makeSetCode(makeRng(5));
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizeSetCode(' ab-cd '), 'ABCD');
  assert.equal(normalizeSetCode('abc'), null);
  assert.equal(normalizeSetCode('abcdef'), 'ABCD');
});

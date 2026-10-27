// Galvanize: screens, race flow, timers, and storage glue. Game rules live in engine.js.
import * as E from './engine.js';
import { loadState, saveState, clearState, defaultState } from './storage.js';

const app = document.getElementById('app');
const live = document.getElementById('live');

let content = null;
let byId = {};
let state = loadState();
let race = null;
let lastSummary = null;
let setup = { count: 15, code: '' };
let flagging = null;

const GLYPHS = [
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 L19 18 H1 Z"/></svg>',
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1 L19 10 L10 19 L1 10 Z"/></svg>',
  '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5"/></svg>',
  '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="2"/></svg>'
];
const LETTERS = ['A', 'B', 'C', 'D'];
const BOLT = '<svg class="bolt" viewBox="0 0 64 64" aria-hidden="true"><path d="M36 6 L18 36 h12 L26 58 L46 26 H34 Z" fill="#f0a93a"/></svg>';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function persist() { saveState(state); }

function announce(text) {
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// Sounds: tiny synthesized beeps, off unless enabled in settings.
let audio = null;
function beep(freq, ms, type = 'sine', gain = 0.06) {
  if (!state.settings.sounds) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(audio.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
    osc.stop(audio.currentTime + ms / 1000);
  } catch { /* no audio available */ }
}
const sfx = {
  correct: () => { beep(660, 120); setTimeout(() => beep(990, 160), 90); },
  wrong: () => beep(160, 220, 'square', 0.04),
  tick: () => beep(1200, 40, 'square', 0.02),
  done: () => { beep(523, 120); setTimeout(() => beep(659, 120), 120); setTimeout(() => beep(784, 220), 240); }
};

// Rendering ---------------------------------------------------------------

function render(html) {
  app.innerHTML = html;
  app.scrollTop = 0;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

function timerLabel(mode) {
  return mode === 'off' ? 'Timer off' : mode === 'extended' ? 'Extended time' : 'Normal time';
}

function screenHome() {
  const missed = E.missedIds(state.progress).filter((id) => byId[id]);
  const played = state.history.length;
  const best = state.history.reduce((m, h) => Math.max(m, h.score), 0);
  const weak = E.weakTopics(state.progress, content.questions).slice(0, 3);
  render(`
    <section class="screen">
      <header class="brand">
        ${BOLT}
        <h1>Galvanize</h1>
        <p>A Frankenstein study race. Volumes 1 and 2.</p>
      </header>
      <div class="stack">
        <button class="btn primary" data-action="setup">Quiz race</button>
        <button class="btn" data-action="practice-missed" ${missed.length ? '' : 'disabled'}>
          Practice what you missed <span class="count">${missed.length}</span>
        </button>
        <button class="btn" data-action="weak">Weak topics</button>
        <button class="btn ghost" data-action="settings">Settings</button>
      </div>
      ${played ? `
      <div class="stats">
        <div class="stat"><div class="v">${played}</div><div class="l">races</div></div>
        <div class="stat"><div class="v">${best.toLocaleString()}</div><div class="l">best score</div></div>
        <div class="stat"><div class="v">${Object.keys(state.progress.questions).length}/${content.questions.length}</div><div class="l">questions seen</div></div>
      </div>` : ''}
      ${weak.length ? `
      <div class="card">
        <h3>Weakest topics so far</h3>
        ${weak.map((t) => barRow(t.label, t.seen - t.wrong, t.seen)).join('')}
      </div>` : ''}
      <div class="card notice small">
        <p><strong>Heads up:</strong> these questions were written from memory of the novel and have not been checked against the class copy. If something looks wrong, tap <em>Flag a problem</em> on that question.</p>
      </div>
      <p class="muted small" style="text-align:center">Timer: ${timerLabel(state.settings.timerMode)}. Change it in Settings.</p>
    </section>
  `);
}

function barRow(label, correct, total) {
  const pct = total ? Math.round((correct / total) * 100) : 0;
  return `
    <div class="bar">
      <div class="lbl">${esc(label)}</div>
      <div class="track"><div class="fill ${pct < 60 ? 'weak' : ''}" style="width:${pct}%"></div></div>
      <div class="frac">${correct}/${total}</div>
    </div>`;
}

function screenSetup() {
  render(`
    <section class="screen">
      <div class="topbar">
        <button class="iconbtn" data-action="home" aria-label="Back to home">&#8592;</button>
        <h2 class="grow">Quiz race</h2>
      </div>
      <div class="card">
        <h3>How many questions</h3>
        <div class="chips" role="group" aria-label="Number of questions">
          ${[10, 15, 20].map((n) => `<button class="chip" data-action="count" data-count="${n}" aria-pressed="${setup.count === n}">${n}</button>`).join('')}
        </div>
        <p class="muted small">Questions you have not seen or have missed come up first.</p>
      </div>
      <div class="card">
        <h3>Timer</h3>
        <div class="chips" role="group" aria-label="Timer">
          ${['normal', 'extended', 'off'].map((m) => `<button class="chip" data-action="timer" data-mode="${m}" aria-pressed="${state.settings.timerMode === m}">${timerLabel(m)}</button>`).join('')}
        </div>
        <p class="muted small">Normal: ${E.TIMERS[1]}, ${E.TIMERS[2]} and ${E.TIMERS[3]} seconds for Parts 1, 2 and 3. Extended is one and a half times that.</p>
      </div>
      <div class="card">
        <h3>Race with friends (optional)</h3>
        <p class="small">Everyone who enters the same code gets the same 15 questions in the same order. Compare scores at the end.</p>
        <div class="row">
          <input class="input code" id="setcode" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="4" placeholder="CODE" value="${esc(setup.code)}" aria-label="Set code">
          <button class="btn" style="width:auto;white-space:nowrap" data-action="make-code">Make one</button>
        </div>
      </div>
      <button class="btn primary" data-action="start">Start</button>
      <div class="card small">
        <p><strong>Scoring:</strong> a correct answer is worth 500 to 1000 points, more when you are faster. Three or more in a row adds 200. With the timer off, every correct answer is 750.</p>
      </div>
    </section>
  `);
}

function partChip(part) {
  return `<span class="partchip">${esc(E.PART_LABELS[part] || 'Part ' + part)}</span>`;
}

function screenPlay() {
  const q = race.questions[race.index];
  const timed = race.timeTotal != null;
  const passage = q.part === 3 && q.passageId ? content.passages[q.passageId] : null;
  render(`
    <section class="screen">
      <div class="topbar">
        <button class="iconbtn" data-action="quit" aria-label="Quit race">&#10005;</button>
        <div class="grow muted">${race.index + 1} of ${race.questions.length}${race.code ? ` &middot; code ${esc(race.code)}` : ''}</div>
        <div class="streak" aria-label="Streak">${race.streak >= 2 ? `&#128293; ${race.streak}` : ''}</div>
        <div class="score" aria-label="Score">${race.score.toLocaleString()}</div>
      </div>
      ${timed ? `
      <div class="timer" aria-hidden="true">
        <div class="track"><div class="fill" id="tfill"></div></div>
        <div class="secs" id="tsecs">${race.timeTotal}</div>
      </div>` : ''}
      <div>${partChip(q.part)}</div>
      ${passage ? `
      <div class="passage" tabindex="0">
        <div class="ptitle">${esc(passage.title)}</div>
        <div>${esc(passage.text)}</div>
      </div>` : ''}
      <p class="prompt" id="prompt">${esc(q.prompt)}</p>
      <div class="options" role="group" aria-labelledby="prompt">
        ${race.options.map((o, i) => `
          <button class="opt" data-action="answer" data-idx="${i}">
            <span class="glyph">${GLYPHS[i]}</span>
            <span class="text">${esc(o.text)}</span>
            <span class="mark" aria-hidden="true"></span>
          </button>`).join('')}
      </div>
      <div id="after"></div>
    </section>
  `);
  if (timed) startTimer();
}

function renderAfter(result) {
  const q = race.questions[race.index];
  const buttons = app.querySelectorAll('.opt');
  buttons.forEach((b, i) => {
    const o = race.options[i];
    b.setAttribute('aria-disabled', 'true');
    const mark = b.querySelector('.mark');
    if (o.correct) {
      b.classList.add('correct');
      mark.textContent = '✓';
      b.insertAdjacentHTML('beforeend', '<span class="sr-only">Correct answer</span>');
    } else if (i === result.chosen) {
      b.classList.add('wrong');
      mark.textContent = '✗';
      b.insertAdjacentHTML('beforeend', '<span class="sr-only">Your answer, incorrect</span>');
    } else {
      b.classList.add('dim');
    }
  });
  const headline = result.correct ? 'Correct' : result.timedOut ? "Time's up" : 'Not quite';
  const detail = result.correct
    ? (result.streakBonus ? `Speed ${result.speedPoints} plus streak bonus ${result.streakBonus}` : `Base 500 plus speed ${result.speedPoints}`)
    : `The answer: ${q.answer}`;
  const last = race.index === race.questions.length - 1;
  const after = document.getElementById('after');
  after.innerHTML = `
    <div class="stack">
      <div class="feedback ${result.correct ? 'ok' : 'bad'} pop" role="status">
        <div class="headline"><span>${headline}</span><span class="points">${result.correct ? '+' + result.points.toLocaleString() : '+0'}</span></div>
        <div class="detail">${esc(detail)}</div>
        ${q.explanation ? `<div class="detail">${esc(q.explanation)}</div>` : ''}
      </div>
      <button class="btn primary" id="nextbtn" data-action="next">${last ? 'See results' : 'Next'}</button>
      <div class="row between">
        <button class="linkbtn" data-action="flag" data-id="${esc(q.id)}">Flag a problem</button>
        <span class="muted small">Press Enter for next</span>
      </div>
    </div>`;
  announce(`${headline}. ${result.correct ? result.points + ' points.' : 'The answer: ' + q.answer}`);
  document.getElementById('nextbtn').focus({ preventScroll: true });
  after.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function screenSummary() {
  const s = lastSummary;
  const parts = [1, 2, 3].filter((p) => s.byPart[p].total > 0);
  const missedCount = s.missed.length;
  render(`
    <section class="screen">
      <div class="topbar">
        <h2 class="grow">${esc(race.title)} finished</h2>
      </div>
      <div class="card">
        <div class="bigscore">
          <div class="num">${s.score.toLocaleString()}</div>
          <div class="label">points${race.code ? ` &middot; code ${esc(race.code)}` : ''}</div>
        </div>
        <div class="stats">
          <div class="stat"><div class="v">${s.accuracy}%</div><div class="l">accuracy</div></div>
          <div class="stat"><div class="v">${s.correct}/${s.total}</div><div class="l">correct</div></div>
          <div class="stat"><div class="v">${s.bestStreak}</div><div class="l">best streak</div></div>
        </div>
      </div>
      <div class="card">
        <h3>By exam part</h3>
        ${parts.map((p) => barRow(E.PART_LABELS[p], s.byPart[p].correct, s.byPart[p].total)).join('')}
      </div>
      <div class="stack">
        ${missedCount ? `
        <button class="btn primary" data-action="replay-missed">Replay the ${missedCount} you missed</button>
        <button class="btn" data-action="review">Review what you missed</button>` : `
        <div class="card notice"><p><strong>Clean sweep.</strong> Every answer right.</p></div>`}
        <button class="btn" data-action="share">Share score</button>
        <button class="btn ghost" data-action="setup">Play again</button>
        <button class="btn ghost" data-action="home">Home</button>
      </div>
    </section>
  `);
}

function reviewItem(r) {
  const q = byId[r.id];
  if (!q) return '';
  const passage = q.part === 3 && q.passageId ? content.passages[q.passageId] : null;
  return `
    <div class="item">
      <div>${partChip(q.part)}${passage ? ` <span class="muted small">${esc(passage.title)}</span>` : ''}</div>
      <div class="q">${esc(q.prompt)}</div>
      ${r.chosenText != null ? `<div class="ans badd"><span class="tag" aria-hidden="true">&#10007;</span><span><span class="sr-only">Your answer: </span>${esc(r.chosenText)}</span></div>` : ''}
      ${r.timedOut ? `<div class="ans badd"><span class="tag" aria-hidden="true">&#10007;</span><span>Ran out of time</span></div>` : ''}
      <div class="ans good"><span class="tag" aria-hidden="true">&#10003;</span><span><span class="sr-only">Correct answer: </span>${esc(q.answer)}</span></div>
      ${q.explanation ? `<p class="muted small">${esc(q.explanation)}</p>` : ''}
      <div><button class="linkbtn" data-action="flag" data-id="${esc(q.id)}">Flag a problem</button></div>
    </div>`;
}

function screenReview() {
  const missed = race.results.filter((r) => !r.correct);
  render(`
    <section class="screen">
      <div class="topbar">
        <button class="iconbtn" data-action="summary" aria-label="Back to results">&#8592;</button>
        <h2 class="grow">What you missed</h2>
      </div>
      <div class="list">${missed.map(reviewItem).join('')}</div>
      <button class="btn primary" data-action="replay-missed">Replay these ${missed.length}</button>
    </section>
  `);
}

function screenWeak() {
  const topics = E.weakTopics(state.progress, content.questions);
  const missed = E.missedIds(state.progress).filter((id) => byId[id]);
  render(`
    <section class="screen">
      <div class="topbar">
        <button class="iconbtn" data-action="home" aria-label="Back to home">&#8592;</button>
        <h2 class="grow">Weak topics</h2>
      </div>
      ${topics.length ? `
      <p class="muted small">Topics are rough groupings by keyword. Tap one to practice just those questions.</p>
      <div class="list">
        ${topics.map((t) => `
          <button class="item" style="text-align:left;cursor:pointer;font:inherit;color:inherit" data-action="topic" data-tag="${esc(t.tag)}">
            ${barRow(t.label, t.seen - t.wrong, t.seen)}
            <span class="muted small">${t.ids.length} question${t.ids.length === 1 ? '' : 's'}. Tap to practice.</span>
          </button>`).join('')}
      </div>` : `
      <div class="card"><p>Play a race or two first. Your weakest topics will show up here.</p></div>`}
      ${missed.length ? `<button class="btn primary" data-action="practice-missed">Practice all ${missed.length} you have missed</button>` : ''}
    </section>
  `);
}

function screenSettings() {
  render(`
    <section class="screen">
      <div class="topbar">
        <button class="iconbtn" data-action="home" aria-label="Back to home">&#8592;</button>
        <h2 class="grow">Settings</h2>
      </div>
      <div class="card">
        <h3>Timer</h3>
        <div class="chips" role="group" aria-label="Timer">
          ${['normal', 'extended', 'off'].map((m) => `<button class="chip" data-action="timer" data-mode="${m}" aria-pressed="${state.settings.timerMode === m}">${timerLabel(m)}</button>`).join('')}
        </div>
        <p class="muted small">Extended time is one and a half times normal. Off removes the countdown entirely.</p>
      </div>
      <div class="card">
        <div class="toggle">
          <span id="sndlbl">Sounds</span>
          <button class="switch" role="switch" aria-checked="${state.settings.sounds}" aria-labelledby="sndlbl" data-action="sounds"></button>
        </div>
      </div>
      <div class="card">
        <h3>Flagged items</h3>
        ${state.flags.length ? `
        <p class="small">${state.flags.length} flagged. Copy them and send them to whoever maintains the questions.</p>
        <button class="btn" data-action="copy-flags">Copy flags as text</button>
        <button class="btn ghost" data-action="clear-flags">Clear flags</button>` : `
        <p class="muted small">Nothing flagged yet. Use <em>Flag a problem</em> on any question.</p>`}
      </div>
      <div class="card">
        <h3>Your progress</h3>
        <p class="small">Progress is saved only on this device. Nothing is sent anywhere.</p>
        <button class="btn danger" data-action="reset">Reset all progress</button>
      </div>
      <p class="muted small" style="text-align:center">Galvanize v0.1. Content is unverified against the class edition.</p>
    </section>
  `);
}

function screenFlag() {
  const q = byId[flagging.id];
  render(`
    <section class="screen">
      <div class="topbar">
        <button class="iconbtn" data-action="flag-cancel" aria-label="Cancel">&#8592;</button>
        <h2 class="grow">Flag a problem</h2>
      </div>
      <div class="item">
        <div class="q">${esc(q.prompt)}</div>
        <div class="ans good"><span class="tag" aria-hidden="true">&#10003;</span><span>${esc(q.answer)}</span></div>
      </div>
      <label class="stack">
        <span>What looks wrong? (optional)</span>
        <textarea class="input" id="flagnote" placeholder="For example: the answer and a distractor both seem right"></textarea>
      </label>
      <button class="btn primary" data-action="flag-save">Save flag</button>
      <p class="muted small">Flags stay on this device. Copy them from Settings to send them along.</p>
    </section>
  `);
  document.getElementById('flagnote').focus();
}

// Race flow ---------------------------------------------------------------

function beginRace({ count, onlyIds = null, code = null, title = 'Quiz race', source = 'race' }) {
  const seeded = !!code;
  const rng = seeded ? E.makeRng('galvanize:' + code) : Math.random;
  const questions = E.pickQuestions(content.questions, state.progress, count, { rng, seeded, onlyIds });
  if (!questions.length) { toast('No questions to play'); return; }
  race = {
    questions, index: 0, results: [], streak: 0, score: 0,
    code, title, source, rng,
    timerMode: state.settings.timerMode,
    options: null, timeTotal: null, timeLeft: null, timerHandle: null, phase: 'question'
  };
  showQuestion();
}

function showQuestion() {
  const q = race.questions[race.index];
  race.options = E.buildOptions(q, race.rng);
  race.phase = 'question';
  race.timeTotal = E.timerFor(q.part, race.timerMode);
  race.timeLeft = race.timeTotal;
  race.lastTick = null;
  screenPlay();
  announce(`Question ${race.index + 1} of ${race.questions.length}. ${E.PART_LABELS[q.part]}. ${q.prompt}`);
}

function startTimer() {
  stopTimer();
  let last = performance.now();
  race.timerHandle = setInterval(() => {
    const now = performance.now();
    race.timeLeft = Math.max(0, race.timeLeft - (now - last) / 1000);
    last = now;
    const fill = document.getElementById('tfill');
    const secs = document.getElementById('tsecs');
    if (fill) {
      fill.style.width = `${(race.timeLeft / race.timeTotal) * 100}%`;
      fill.classList.toggle('low', race.timeLeft <= 5);
    }
    const whole = Math.ceil(race.timeLeft);
    if (secs && secs.textContent !== String(whole)) {
      secs.textContent = whole;
      if (whole <= 5 && whole > 0) sfx.tick();
    }
    if (race.timeLeft <= 0) answer(null);
  }, 100);
}

function stopTimer() {
  if (race && race.timerHandle) { clearInterval(race.timerHandle); race.timerHandle = null; }
}

function answer(idx) {
  if (!race || race.phase !== 'question') return;
  stopTimer();
  race.phase = 'feedback';
  const q = race.questions[race.index];
  const chosen = idx == null ? null : race.options[idx];
  const correct = !!(chosen && chosen.correct);
  const sc = E.scoreAnswer({ correct, timeLeft: race.timeLeft, timeTotal: race.timeTotal, streak: race.streak });
  race.streak = sc.streak;
  race.score += sc.points;
  const result = {
    id: q.id, part: q.part, correct, points: sc.points, speedPoints: sc.speedPoints, streakBonus: sc.streakBonus,
    chosen: idx, chosenText: chosen ? chosen.text : null, timedOut: idx == null
  };
  race.results.push(result);
  E.recordResult(state.progress, result);
  persist();
  if (correct) sfx.correct(); else sfx.wrong();
  const scoreEl = app.querySelector('.topbar .score');
  if (scoreEl) scoreEl.textContent = race.score.toLocaleString();
  const streakEl = app.querySelector('.topbar .streak');
  if (streakEl) streakEl.innerHTML = race.streak >= 2 ? `&#128293; ${race.streak}` : '';
  renderAfter(result);
}

function next() {
  if (!race || race.phase !== 'feedback') return;
  if (race.index + 1 >= race.questions.length) return finishRace();
  race.index += 1;
  showQuestion();
}

function finishRace() {
  stopTimer();
  lastSummary = E.summarize(race.results);
  state.history.push({
    date: new Date().toISOString(), score: lastSummary.score, accuracy: lastSummary.accuracy,
    count: lastSummary.total, code: race.code, timerMode: race.timerMode
  });
  if (state.history.length > 100) state.history = state.history.slice(-100);
  persist();
  sfx.done();
  race.phase = 'done';
  screenSummary();
  announce(`Race finished. ${lastSummary.score} points, ${lastSummary.accuracy} percent accuracy.`);
}

function quitRace() {
  if (!race || race.phase === 'done') { race = null; screenHome(); return; }
  const answered = race.results.length;
  const ok = window.confirm(answered ? `Quit this race? Your ${answered} answer${answered === 1 ? '' : 's'} so far still count toward progress.` : 'Quit this race?');
  if (!ok) return;
  stopTimer();
  if (answered) { finishRace(); return; }
  race = null;
  screenHome();
}

function shareScore() {
  const s = lastSummary;
  const lines = [
    `Galvanize: ${s.score.toLocaleString()} points, ${s.accuracy}% on ${s.total} Frankenstein questions`,
    race.code ? `Set code ${race.code}. Enter it to race the same questions.` : null,
    location.href.split('#')[0]
  ].filter(Boolean);
  const text = lines.join('\n');
  if (navigator.share) {
    navigator.share({ text }).catch(() => { /* user cancelled */ });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
  } else {
    window.prompt('Copy your score', text);
  }
}

function copyFlags() {
  const text = state.flags.map((f) => `${f.id} (${f.date.slice(0, 10)})${f.note ? ': ' + f.note : ''}`).join('\n');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Flags copied'));
  } else {
    window.prompt('Copy your flags', text);
  }
}

// Events ------------------------------------------------------------------

app.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  switch (action) {
    case 'home': race = null; screenHome(); break;
    case 'setup': race = null; screenSetup(); break;
    case 'settings': screenSettings(); break;
    case 'weak': screenWeak(); break;
    case 'count': setup.count = Number(el.dataset.count); screenSetup(); break;
    case 'timer':
      state.settings.timerMode = el.dataset.mode; persist();
      app.querySelectorAll('[data-action="timer"]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.mode === el.dataset.mode)));
      break;
    case 'sounds':
      state.settings.sounds = !state.settings.sounds; persist();
      el.setAttribute('aria-checked', String(state.settings.sounds));
      if (state.settings.sounds) sfx.correct();
      break;
    case 'make-code': {
      setup.code = E.makeSetCode();
      const input = document.getElementById('setcode');
      if (input) input.value = setup.code;
      break;
    }
    case 'start': {
      const input = document.getElementById('setcode');
      const raw = input ? input.value : '';
      const code = raw.trim() ? E.normalizeSetCode(raw) : null;
      if (raw.trim() && !code) { toast('Codes are 4 letters or digits'); return; }
      setup.code = code || '';
      beginRace({ count: code ? 15 : setup.count, code, title: 'Quiz race' });
      break;
    }
    case 'answer':
      if (el.getAttribute('aria-disabled') === 'true') return;
      answer(Number(el.dataset.idx));
      break;
    case 'next': next(); break;
    case 'quit': quitRace(); break;
    case 'summary': screenSummary(); break;
    case 'review': screenReview(); break;
    case 'replay-missed':
      beginRace({ count: 999, onlyIds: lastSummary.missed, title: 'Replay of missed', source: 'missed' });
      break;
    case 'practice-missed':
      beginRace({ count: 999, onlyIds: E.missedIds(state.progress), title: 'Missed questions', source: 'missed' });
      break;
    case 'topic': {
      const ids = content.questions.filter((q) => q.tags.includes(el.dataset.tag)).map((q) => q.id);
      beginRace({ count: Math.min(10, ids.length), onlyIds: ids, title: E.TAG_LABELS[el.dataset.tag] || 'Topic', source: 'topic' });
      break;
    }
    case 'share': shareScore(); break;
    case 'flag':
      stopTimer();
      flagging = { id: el.dataset.id, from: race && race.phase === 'feedback' ? 'play' : race && race.phase === 'done' ? 'review' : 'home' };
      screenFlag();
      break;
    case 'flag-save': {
      const note = (document.getElementById('flagnote').value || '').trim().slice(0, 500);
      state.flags.push({ id: flagging.id, note, date: new Date().toISOString() });
      persist();
      toast('Flagged. Thanks.');
      returnFromFlag();
      break;
    }
    case 'flag-cancel': returnFromFlag(); break;
    case 'copy-flags': copyFlags(); break;
    case 'clear-flags':
      if (window.confirm('Clear all flags on this device?')) { state.flags = []; persist(); screenSettings(); }
      break;
    case 'reset':
      if (window.confirm('Reset all progress, history and flags on this device? This cannot be undone.')) {
        clearState(); state = defaultState(); persist(); toast('Progress reset'); screenHome();
      }
      break;
    default: break;
  }
});

function returnFromFlag() {
  const from = flagging ? flagging.from : 'home';
  flagging = null;
  if (from === 'play' && race) {
    // Re-render the question in its answered state.
    screenPlay();
    stopTimer();
    renderAfter(race.results[race.results.length - 1]);
  } else if (from === 'review' && race) {
    screenReview();
  } else {
    screenHome();
  }
}

document.addEventListener('keydown', (ev) => {
  if (!race || flagging) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (race.phase === 'question' && /^[1-4]$/.test(ev.key)) {
    ev.preventDefault();
    answer(Number(ev.key) - 1);
  } else if (race.phase === 'feedback' && (ev.key === 'Enter' || ev.key === ' ') && !(ev.target && ev.target.closest('[data-action]'))) {
    ev.preventDefault();
    next();
  }
});

// Pause the countdown when the app goes to the background.
document.addEventListener('visibilitychange', () => {
  if (!race || race.phase !== 'question' || race.timeTotal == null) return;
  if (document.hidden) stopTimer(); else startTimer();
});

// Boot --------------------------------------------------------------------

async function init() {
  try {
    const res = await fetch('data/content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    content = await res.json();
  } catch (err) {
    render(`
      <section class="screen center">
        <h2>Could not load the questions</h2>
        <p class="muted">${esc(err.message)}</p>
        <button class="btn" data-action="reload" onclick="location.reload()">Try again</button>
      </section>`);
    return;
  }
  byId = Object.fromEntries(content.questions.map((q) => [q.id, q]));
  screenHome();
}

init();

// Local storage wrapper. Everything stays on this device. No personal data is stored.
import { defaultProgress } from './engine.js';

const KEY = 'galvanize.v1';

export function defaultState() {
  return {
    settings: { timerMode: 'normal', sounds: false },
    progress: defaultProgress(),
    history: [],
    flags: []
  };
}

export function loadState() {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return {
      settings: { ...base.settings, ...(saved.settings || {}) },
      progress: { ...base.progress, ...(saved.progress || {}) },
      history: Array.isArray(saved.history) ? saved.history : [],
      flags: Array.isArray(saved.flags) ? saved.flags : []
    };
  } catch {
    return base;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

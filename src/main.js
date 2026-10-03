// Elemental Blow — entry point: fixed-timestep loop, app states and wiring.
//
// App states: 'menu' | 'playing' | 'paused' | 'upgrade' | 'gameover'
// (the sim itself only knows 'playing' | 'upgrade' | 'gameover').

import { createGame, update, applyUpgrade } from './sim.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { audio } from './audio.js';
import { createInput } from './input.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.1; // clamp long frame gaps (tab switches, breakpoints) to at most 6 sim steps
const BEST_KEY = 'elemental-blow-best';
const MUTE_KEY = 'elemental-blow-muted';
const SCORES_KEY = 'elemental-blow-scores';
const NAME_KEY = 'elemental-blow-name';
const MAX_SCORES = 10;
const MAX_NAME = 12;

// ---------------------------------------------------------------------------
// Storage (localStorage may be unavailable: private mode, file://, sandboxed iframes)
// ---------------------------------------------------------------------------
function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function loadBest() {
  const raw = storageGet(BEST_KEY);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    if (b && Number.isFinite(b.score) && Number.isFinite(b.wave)) return { score: b.score, wave: b.wave };
  } catch {
    /* corrupt entry */
  }
  return null;
}

function loadScores() {
  try {
    const list = JSON.parse(storageGet(SCORES_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && Number.isFinite(s.score) && s.score > 0)
      .map((s) => ({ name: String(s.name || 'ANON').slice(0, MAX_NAME), score: s.score, wave: Number(s.wave) || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return []; // corrupt entry
  }
}

/** 0-based position `score` would take on the board, or -1 if it does not make it. */
function scoreRank(scores, score) {
  if (!(score > 0)) return -1;
  const i = scores.findIndex((s) => score > s.score);
  const rank = i === -1 ? scores.length : i;
  return rank < MAX_SCORES ? rank : -1;
}

// ---------------------------------------------------------------------------
// One failing subsystem must not kill the loop; report each failure site once.
// ---------------------------------------------------------------------------
const reported = new Set();
function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    if (!reported.has(label)) {
      reported.add(label);
      console.error(`[elemental-blow] ${label} failed:`, err);
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const input = createInput({ canvas, renderer });

let app = 'menu';
let state = null;
let acc = 0;
let last = performance.now();
let muted = storageGet(MUTE_KEY) === '1';
// Set while one of our own key handlers changes app state, so a UI key handler reacting to the
// same keypress (e.g. Esc on the pause screen) cannot immediately undo it.
let keyLock = false;
let pendingScore = null; // finished run waiting for a name on the game-over screen

const ui = createUI({
  onStart: () => startGame(),
  onResume: () => {
    if (!keyLock) resume();
  },
  onRestart: () => startGame(),
  onQuitToMenu: () => toMenu(),
  onPickUpgrade: (id) => pickUpgrade(id),
  onSubmitScore: (name) => submitScore(name),
  onToggleMute: () => {
    if (!keyLock) setMuted(!muted);
  },
});

function dispatch(events) {
  if (!events.length) return;
  safe('renderer.handleEvents', () => renderer.handleEvents(events));
  safe('audio.handleEvents', () => audio.handleEvents(events));
  safe('ui.handleEvents', () => ui.handleEvents(events));
}

function seedFromUrl() {
  try {
    const s = new URLSearchParams(window.location.search).get('seed');
    if (s !== null && s !== '') return Number.isFinite(Number(s)) ? Number(s) : s;
  } catch {
    /* ignore */
  }
  return undefined;
}

function resetClock() {
  acc = 0;
  last = performance.now();
}

// ---------------------------------------------------------------------------
// App state transitions
// ---------------------------------------------------------------------------
function startGame() {
  safe('audio.init', () => audio.init());
  state = createGame(seedFromUrl());
  app = 'playing';
  resetClock();
  input.reset();
  input.setActive(true);
  safe('ui.hideOverlays', () => ui.hideOverlays());
  // Drop wave banners / screen flash left over from the previous run (they self-expire, but not instantly).
  safe('ui.clearTransients', () => {
    const b = document.querySelector('.banners');
    if (b) b.textContent = '';
    const f = document.querySelector('.flash');
    if (f) f.classList.remove('go');
  });
  safe('ui.updateHUD', () => ui.updateHUD(state));
  safe('audio.startMusic', () => audio.startMusic());
}

function pause() {
  if (app !== 'playing') return;
  app = 'paused';
  input.setActive(false);
  safe('audio.stopMusic', () => audio.stopMusic());
  safe('ui.showPause', () => ui.showPause());
}

function resume() {
  if (app !== 'paused' || !state) return;
  app = 'playing';
  resetClock();
  input.reset();
  input.setActive(true);
  safe('ui.hideOverlays', () => ui.hideOverlays());
  safe('audio.startMusic', () => audio.startMusic());
}

function enterUpgrade() {
  app = 'upgrade';
  input.setActive(false);
  safe('ui.showUpgrade', () => ui.showUpgrade(state.upgradeChoices));
}

function pickUpgrade(id) {
  if (app !== 'upgrade' || !state) return;
  if (!applyUpgrade(state, id)) return;
  dispatch(state.events.slice()); // the 'upgrade' event
  app = 'playing';
  resetClock();
  input.reset();
  input.setActive(true);
  safe('ui.hideOverlays', () => ui.hideOverlays());
}

function enterGameOver() {
  app = 'gameover';
  input.setActive(false);
  const prev = loadBest();
  const isNewBest = state.score > 0 && (!prev || state.score > prev.score);
  const best = {
    score: Math.max(prev ? prev.score : 0, state.score),
    wave: Math.max(prev ? prev.wave : 0, state.wave),
  };
  storageSet(BEST_KEY, JSON.stringify(best));
  const scores = loadScores();
  const rank = scoreRank(scores, state.score);
  pendingScore = rank >= 0 ? { score: state.score, wave: state.wave } : null;
  safe('audio.stopMusic', () => audio.stopMusic());
  safe('ui.showGameOver', () =>
    ui.showGameOver({
      score: state.score, wave: state.wave, kills: state.kills, best, isNewBest,
      scores, rank, lastName: storageGet(NAME_KEY) || '',
    }),
  );
}

function submitScore(rawName) {
  if (!pendingScore) return;
  const name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'ANON';
  const entry = { name, ...pendingScore };
  pendingScore = null;
  const scores = loadScores();
  const rank = scoreRank(scores, entry.score);
  if (rank < 0) return;
  scores.splice(rank, 0, entry);
  scores.length = Math.min(scores.length, MAX_SCORES);
  storageSet(SCORES_KEY, JSON.stringify(scores));
  storageSet(NAME_KEY, name);
  safe('ui.setScores', () => ui.setScores(scores, rank));
}

function toMenu() {
  app = 'menu';
  state = null;
  input.setActive(false);
  safe('audio.stopMusic', () => audio.stopMusic());
  safe('ui.showMenu', () => ui.showMenu(loadBest(), loadScores()));
}

function setMuted(m) {
  muted = !!m;
  safe('audio.setMuted', () => audio.setMuted(muted));
  safe('ui.setMuted', () => ui.setMuted(muted));
  storageSet(MUTE_KEY, muted ? '1' : '0');
}

// ---------------------------------------------------------------------------
// Global keys / focus / audio unlock
// ---------------------------------------------------------------------------
function lockKeys() {
  keyLock = true;
  setTimeout(() => {
    keyLock = false;
  }, 0);
}

window.addEventListener(
  'keydown',
  (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (app === 'playing') {
        e.preventDefault();
        pause();
        lockKeys();
      } else if (app === 'paused') {
        e.preventDefault();
        resume();
        lockKeys();
      }
    } else if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement)) {
      setMuted(!muted);
      lockKeys();
    }
  },
  true, // capture: runs before any UI key handlers
);

const unlockAudio = () => safe('audio.init', () => audio.init());
window.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);
window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });

window.addEventListener('blur', () => {
  input.releaseAll();
  pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

const onResize = () => safe('renderer.resize', () => renderer.resize());
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// ---------------------------------------------------------------------------
// Main loop: fixed 1/60 s simulation steps with an accumulator, render once per frame.
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  const events = [];
  if (app === 'playing' && state) {
    acc += dt;
    while (acc >= STEP) {
      update(state, input.sample(state), STEP);
      for (const ev of state.events) events.push(ev);
      acc -= STEP;
      if (state.phase !== 'playing') {
        acc = 0;
        break;
      }
    }
  }
  dispatch(events);

  if (app === 'playing' && state) {
    if (state.phase === 'upgrade') enterUpgrade();
    else if (state.phase === 'gameover') enterGameOver();
  }

  safe('renderer.render', () => renderer.render(state, app === 'paused' ? 0 : dt));
  if (state && app !== 'menu') safe('ui.updateHUD', () => ui.updateHUD(state));
}

// Debug / automation handle (read-only view).
window.elementalBlow = {
  get app() {
    return app;
  },
  get state() {
    return state;
  },
};

onResize();
setMuted(muted);
safe('ui.showMenu', () => ui.showMenu(loadBest(), loadScores()));
resetClock();
requestAnimationFrame(frame);

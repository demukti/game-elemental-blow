// Elemental Blow — entry point: fixed-timestep loop, app states and wiring.
//
// App states: 'menu' | 'playing' | 'paused' | 'upgrade' | 'gameover'
// (the sim itself only knows 'playing' | 'upgrade' | 'gameover').

import { createGame, update, applyUpgrade } from './sim.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { createManual } from './manual.js';
import { audio } from './audio.js';
import { createInput } from './input.js';
import { botInput } from './bot.js';
import { createBoard, boardName } from './board.js';
import { createTouch } from './touch.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.1; // clamp long frame gaps (tab switches, breakpoints) to at most 6 sim steps
const BEST_KEY = 'elemental-blow-best';
const MUTE_KEY = 'elemental-blow-muted';
const SCORES_KEY = 'elemental-blow-scores';
const NAME_KEY = 'elemental-blow-name';
const MAX_SCORES = 10;
const MAX_NAME = 12;
const BOT_RESTART_MS = 2000; // autoplay: delay before a new run after game over

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
// Touch controls (src/touch.js): null unless this is a touch-first device or ?touch=1. Created before
// the UI so the menu can show touch controls.
const touch = createTouch({ onPause: () => pause() });
const board = createBoard(); // friends board (src/board.js); inactive unless configured

let app = 'menu';
let state = null;
let acc = 0;
let last = performance.now();
let muted = storageGet(MUTE_KEY) === '1';
// Set while one of our own key handlers changes app state, so a UI key handler reacting to the
// same keypress (e.g. Esc on the pause screen) cannot immediately undo it.
let keyLock = false;
let pendingScore = null; // finished run waiting for a name on the game-over screen
let pauseDrawn = false; // the paused frame is on screen; skip redraws until resume or resize

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
  onOpenManual: () => manual.open(),
  onOpenCredits: () => manual.open('credits'),
});
// Created before the app's own key handler below: while open, the manual's capture handler takes
// Esc / H and keeps the other keys from reaching the screen underneath it.
const manual = createManual();

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

// Autoplay for playtesting: `?bot=1` (smart bot) or `?bot=simple`. The bot replaces the sampled
// input every step, starts from the menu, takes the first upgrade and restarts after game over.
// Its runs are not written to the best / high-score storage.
function botFromUrl() {
  try {
    const b = new URLSearchParams(window.location.search).get('bot');
    if (b === null || b === '' || b === '0' || b === 'false' || b === 'off') return null;
    return b === 'simple' ? 'simple' : 'smart';
  } catch {
    return null;
  }
}
const botMode = botFromUrl();
let botRestart = 0; // pending restart timer id

function resetClock() {
  acc = 0;
  last = performance.now();
}

// ---------------------------------------------------------------------------
// App state transitions
// ---------------------------------------------------------------------------
function startGame() {
  safe('audio.init', () => audio.init());
  if (touch && !botMode) safe('touch.onStart', () => touch.onStart());
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
  pauseDrawn = false;
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
  if (botMode) safe('bot.pickUpgrade', () => pickUpgrade(state.upgradeChoices[0].id));
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
  if (botMode) {
    // bot runs are not records: show the screen, then start over
    pendingScore = null;
    safe('audio.stopMusic', () => audio.stopMusic());
    safe('ui.showGameOver', () =>
      ui.showGameOver({
        score: state.score, wave: state.wave, kills: state.kills, best: loadBest(), isNewBest: false,
        scores: loadScores(), rank: -1, lastName: '',
      }),
    );
    clearTimeout(botRestart);
    botRestart = setTimeout(() => {
      if (app === 'gameover' && botMode) startGame();
    }, BOT_RESTART_MS);
    return;
  }
  const prev = loadBest();
  const isNewBest = state.score > 0 && (!prev || state.score > prev.score);
  const best = {
    score: Math.max(prev ? prev.score : 0, state.score),
    wave: Math.max(prev ? prev.wave : 0, state.wave),
  };
  storageSet(BEST_KEY, JSON.stringify(best));
  const scores = loadScores();
  const rank = scoreRank(scores, state.score);
  // with a friends board every scoring run asks for a name; otherwise only runs that make the local board
  pendingScore = rank >= 0 || (board.active && state.score > 0) ? { score: state.score, wave: state.wave } : null;
  safe('audio.stopMusic', () => audio.stopMusic());
  safe('ui.showGameOver', () =>
    ui.showGameOver({
      score: state.score, wave: state.wave, kills: state.kills, best, isNewBest,
      scores, rank, lastName: storageGet(NAME_KEY) || '', askName: !!pendingScore, friends: board.active,
    }),
  );
  if (board.active) showFriends('gameover', board.top());
}

function submitScore(rawName) {
  if (!pendingScore) return;
  const typed = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  const entry = { name: typed || 'ANON', ...pendingScore };
  pendingScore = null;
  storageSet(NAME_KEY, entry.name);
  const scores = loadScores();
  const rank = scoreRank(scores, entry.score);
  if (rank >= 0) {
    scores.splice(rank, 0, entry);
    scores.length = Math.min(scores.length, MAX_SCORES);
    storageSet(SCORES_KEY, JSON.stringify(scores));
    safe('ui.setScores', () => ui.setScores(scores, rank));
  }
  const name = boardName(typed); // no name typed: nothing goes to the friends board
  if (board.active && name) {
    safe('ui.setFriends', () => ui.setFriends('gameover', 'loading'));
    showFriends('gameover', board.submit({ name, score: entry.score, wave: entry.wave }));
  }
}

// Friends board replies arrive late; only the newest request for each screen may paint it.
const friendsSeq = { menu: 0, gameover: 0 };
function showFriends(screen, request) {
  const seq = ++friendsSeq[screen];
  request.then(
    (data) => {
      if (seq === friendsSeq[screen]) safe('ui.setFriends', () => ui.setFriends(screen, 'ok', data));
    },
    () => {
      if (seq === friendsSeq[screen]) safe('ui.setFriends', () => ui.setFriends(screen, 'error'));
    },
  );
}

function showMenuScreen() {
  safe('ui.showMenu', () => ui.showMenu(loadBest(), loadScores(), board.active));
  if (board.active) showFriends('menu', board.top());
}

function toMenu() {
  app = 'menu';
  state = null;
  input.setActive(false);
  safe('audio.stopMusic', () => audio.stopMusic());
  showMenuScreen();
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
    if (e.repeat || e.ctrlKey || e.metaKey) return;
    if (e.altKey) {
      // Alt+Enter, the usual PC-game toggle. A bare F sat next to WASD and got hit mid-fight.
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        fullscreen.toggle();
        lockKeys();
      }
      return;
    }
    if (e.code === 'Escape' && fullscreen.active()) {
      // Esc leaves full screen first (the browser does this itself too). Leaving full screen
      // mid-run pauses via the fullscreenchange handler, so no need to pause here as well.
      e.preventDefault();
      fullscreen.exit();
      lockKeys();
    } else if ((e.code === 'KeyP' || e.code === 'Escape') && !manual.isOpen()) {
      if (app === 'playing') {
        e.preventDefault();
        pause();
        lockKeys();
      } else if (app === 'paused') {
        e.preventDefault();
        resume();
        lockKeys();
      }
    } else if (e.code === 'KeyH' && app === 'playing') {
      // the manual opens over the pause screen; closing it leaves the run paused
      e.preventDefault();
      pause();
      manual.open();
      lockKeys();
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
// Ctrl+W / Cmd+W sit next to Shift and Space: closing or reloading mid-run asks first.
window.addEventListener('beforeunload', (e) => {
  if (botMode || (app !== 'playing' && app !== 'paused' && app !== 'upgrade')) return;
  e.preventDefault();
  e.returnValue = true; // older browsers only prompt when this is set
});

const onResize = () => {
  pauseDrawn = false; // resizing clears the canvas
  safe('renderer.resize', () => renderer.resize());
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// ---------------------------------------------------------------------------
// Full screen: corner button or Alt+Enter toggles; Esc (ours or the browser's own) leaves.
// ---------------------------------------------------------------------------
const fullscreen = (() => {
  const doc = document;
  const el = doc.documentElement;
  const button = doc.getElementById('fullscreen');
  const supported = !!(el.requestFullscreen || el.webkitRequestFullscreen) && (doc.fullscreenEnabled !== false);
  const active = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  const enter = () => {
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  };
  const exit = () => {
    if (!active()) return;
    try {
      const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  };
  const toggle = () => (active() ? exit() : enter());

  const onChange = () => {
    const on = active();
    el.classList.toggle('is-fullscreen', on);
    if (button) button.title = on ? 'Leave full screen (Esc)' : 'Full screen (Alt+Enter)';
    // Leaving full screen mid-run (Esc, or the browser's own exit) pauses, like Esc always does.
    if (!on && app === 'playing') pause();
    onResize();
  };
  doc.addEventListener('fullscreenchange', onChange);
  doc.addEventListener('webkitfullscreenchange', onChange);

  if (!supported) el.classList.add('no-fullscreen');
  if (button) {
    button.addEventListener('click', () => {
      button.blur();
      toggle();
    });
  }
  return { active, enter, exit, toggle };
})();

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
    acc += dt * (touch ? touch.timeScale : 1);
    while (acc >= STEP) {
      let sampled = input.sample(state);
      if (touch) sampled = safe('touch.apply', () => touch.apply(sampled, state)) || sampled;
      const inp = botMode ? safe('bot.input', () => botInput(state, { smart: botMode !== 'simple' })) || sampled : sampled;
      update(state, inp, STEP);
      for (const ev of state.events) events.push(ev);
      acc -= STEP;
      if (state.phase !== 'playing') {
        acc = 0;
        break;
      }
    }
  }
  dispatch(events);
  if (touch) safe('touch.frame', () => touch.frame(app, state));

  if (app === 'playing' && state) {
    if (state.phase === 'upgrade') enterUpgrade();
    else if (state.phase === 'gameover') enterGameOver();
  }

  // Nothing changes while paused: draw the paused frame once, then idle until resume or resize.
  if (app === 'paused' && pauseDrawn) return;
  safe('renderer.render', () => renderer.render(state, app === 'paused' ? 0 : dt));
  if (state && app !== 'menu') safe('ui.updateHUD', () => ui.updateHUD(state));
  pauseDrawn = app === 'paused';
}

// Debug / automation handle (read-only view).
window.elementalBlow = {
  get app() {
    return app;
  },
  get state() {
    return state;
  },
  // Renderer resolution/frame-time stats: { quality, dpr, backing, frameMs }.
  get render() {
    return renderer.stats();
  },
  // true while the `?bot=` autoplay mode drives the input.
  get bot() {
    return !!botMode;
  },
  // Trigger a screen-shock effect from the console: shock(x, y, power 0..1, kind?: 'quake' | 'roar').
  shock(x, y, power, kind) {
    return renderer.debugShock(x, y, power, kind);
  },
};

onResize();
setMuted(muted);
showMenuScreen();
resetClock();
requestAnimationFrame(frame);
if (botMode) safe('bot.start', () => startGame());

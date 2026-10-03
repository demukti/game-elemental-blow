// Elemental Blow - synthesized audio (WebAudio only, zero assets, zero imports).
// Every method is a safe no-op when no AudioContext is available.

const MUTE_KEY = 'elemental-blow-muted';

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let noiseBuf = null;
let muted = false;
let wantMusic = false;
let musicTimer = null;
let musicStep = 0;
let musicNext = 0;

try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }

const MASTER_VOL = 0.85;
const MUSIC_VOL = 0.16;

// ---------------------------------------------------------------- context
function init() {
  try {
    if (!ctx) {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_VOL;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_VOL;
      sfxBus.connect(master);
      musicBus.connect(master);
      master.connect(comp);
      comp.connect(limiter);
      limiter.connect(ctx.destination);
      // 2s of white noise reused by every noise-based sound
      const len = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended' && ctx.resume) {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    if (wantMusic) startMusic();
  } catch (e) {
    ctx = null;
  }
}

function ready() {
  return !!ctx && ctx.state !== 'closed' && !muted;
}

// ---------------------------------------------------------------- primitives
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

// Oscillator with optional pitch slide + lowpass.
function tone(o) {
  const t = (o.t != null ? o.t : ctx.currentTime) + (o.delay || 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  const dur = o.dur || 0.2;
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
  if (o.detune) osc.detune.value = o.detune;
  env(g, t, o.a || 0.005, o.vol || 0.3, dur);
  let node = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(o.bus || sfxBus);
  osc.start(t);
  osc.stop(t + (o.a || 0.005) + dur + 0.05);
}

// Filtered noise burst with optional filter sweep.
function noise(o) {
  const t = (o.t != null ? o.t : ctx.currentTime) + (o.delay || 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.ft || 'lowpass';
  f.Q.value = o.q || 0.8;
  f.frequency.setValueAtTime(o.f0 || 1000, t);
  const dur = o.dur || 0.2;
  if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
  const g = ctx.createGain();
  env(g, t, o.a || 0.004, o.vol || 0.3, dur);
  src.connect(f);
  f.connect(g);
  g.connect(o.bus || sfxBus);
  src.start(t, Math.random() * 1.5);
  src.stop(t + (o.a || 0.004) + dur + 0.05);
}

// ---------------------------------------------------------------- sounds
const S = {
  shoot(ev) {
    switch (ev.element) {
      case 'fire':
        noise({ f0: 500, f1: 2600, dur: 0.22, vol: 0.28, q: 1.2 });
        tone({ f: 180, to: 90, type: 'sawtooth', dur: 0.2, vol: 0.12, lp: 900 });
        break;
      case 'water':
        tone({ f: 300, to: 760, type: 'sine', dur: 0.22, vol: 0.26 });
        tone({ f: 450, to: 1100, type: 'sine', dur: 0.16, vol: 0.12, delay: 0.03 });
        noise({ ft: 'bandpass', f0: 900, f1: 400, q: 2, dur: 0.18, vol: 0.1 });
        break;
      case 'earth':
        tone({ f: 120, to: 38, type: 'sine', dur: 0.3, vol: 0.5 });
        noise({ f0: 700, f1: 100, dur: 0.25, vol: 0.3 });
        break;
      case 'air':
        noise({ ft: 'bandpass', f0: 3000, f1: 6500, q: 3, dur: 0.07, vol: 0.14 });
        tone({ f: 1500, to: 2400, type: 'triangle', dur: 0.06, vol: 0.07 });
        break;
      default:
        tone({ f: 500, to: 300, type: 'square', dur: 0.08, vol: 0.1 });
    }
  },
  hit(ev) {
    const m = ev.mult;
    if (m > 1) {
      tone({ f: 880, to: 1320, type: 'square', dur: 0.1, vol: 0.14, lp: 5000 });
      tone({ f: 1320, to: 1760, type: 'sine', dur: 0.14, vol: 0.14, delay: 0.04 });
      noise({ ft: 'highpass', f0: 3000, dur: 0.05, vol: 0.12 });
    } else if (m < 1) {
      tone({ f: 130, to: 80, type: 'triangle', dur: 0.1, vol: 0.28 });
      noise({ f0: 350, f1: 150, dur: 0.07, vol: 0.12 });
    } else {
      tone({ f: 420, to: 220, type: 'square', dur: 0.07, vol: 0.12, lp: 2600 });
      noise({ ft: 'bandpass', f0: 1800, q: 1, dur: 0.05, vol: 0.12 });
    }
  },
  enemyDie(ev) {
    tone({ f: 340, to: 50, type: 'sawtooth', dur: 0.32, vol: 0.2, lp: 1800 });
    noise({ f0: 2400, f1: 200, dur: 0.3, vol: 0.2, q: 0.6 });
    if (ev.enemyType === 'boss') {
      tone({ f: 90, to: 25, type: 'sine', dur: 1.2, vol: 0.55 });
      noise({ f0: 1500, f1: 60, dur: 1.2, vol: 0.4 });
    } else if (ev.enemyType === 'brute') {
      tone({ f: 100, to: 35, type: 'sine', dur: 0.4, vol: 0.4 });
    }
  },
  playerHit() {
    tone({ f: 200, to: 60, type: 'sawtooth', dur: 0.3, vol: 0.36, lp: 1200 });
    noise({ f0: 1400, f1: 120, dur: 0.25, vol: 0.3 });
    tone({ f: 70, to: 40, type: 'sine', dur: 0.3, vol: 0.4 });
  },
  dash() {
    noise({ ft: 'bandpass', f0: 500, f1: 4500, q: 1.5, dur: 0.22, vol: 0.3 });
    tone({ f: 260, to: 700, type: 'sine', dur: 0.18, vol: 0.1 });
  },
  blow() {
    const t = ctx.currentTime;
    tone({ t, f: 140, to: 28, type: 'sine', dur: 1.1, vol: 0.8 });
    tone({ t, f: 55, to: 30, type: 'sawtooth', dur: 0.9, vol: 0.3, lp: 300 });
    noise({ t, f0: 5000, f1: 80, dur: 1.0, vol: 0.5, q: 0.5 });
    tone({ t, f: 200, to: 1200, type: 'triangle', dur: 0.5, vol: 0.18, delay: 0 });
    tone({ t, f: 880, type: 'sine', dur: 0.8, vol: 0.12, delay: 0.05 });
  },
  blowReady() {
    [660, 880, 1320].forEach((f, i) => {
      tone({ f, type: 'triangle', dur: 0.35, vol: 0.2, delay: i * 0.07 });
      tone({ f: f * 2, type: 'sine', dur: 0.25, vol: 0.06, delay: i * 0.07 });
    });
  },
  switch(ev) {
    const base = { fire: 330, water: 392, earth: 262, air: 523 }[ev.element] || 400;
    tone({ f: base, to: base * 1.5, type: 'square', dur: 0.07, vol: 0.09, lp: 3000 });
    noise({ ft: 'highpass', f0: 4000, dur: 0.03, vol: 0.06 });
  },
  pickup(ev) {
    if (ev.kind === 'heal') {
      tone({ f: 523, type: 'sine', dur: 0.15, vol: 0.2 });
      tone({ f: 784, type: 'sine', dur: 0.22, vol: 0.2, delay: 0.08 });
    } else {
      tone({ f: 700, to: 1400, type: 'triangle', dur: 0.15, vol: 0.2 });
      tone({ f: 1400, to: 2100, type: 'sine', dur: 0.12, vol: 0.1, delay: 0.07 });
    }
  },
  waveStart(ev) {
    if (ev.isBoss) {
      tone({ f: 110, type: 'sawtooth', dur: 0.9, vol: 0.2, lp: 500 });
      tone({ f: 164, type: 'sawtooth', dur: 0.9, vol: 0.14, lp: 500, delay: 0.25 });
    } else {
      tone({ f: 330, type: 'triangle', dur: 0.2, vol: 0.2 });
      tone({ f: 440, type: 'triangle', dur: 0.2, vol: 0.2, delay: 0.12 });
      tone({ f: 660, type: 'triangle', dur: 0.4, vol: 0.2, delay: 0.24 });
    }
  },
  waveClear() {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone({ f, type: 'triangle', dur: 0.5, vol: 0.18, delay: i * 0.1 });
      tone({ f: f / 2, type: 'sine', dur: 0.5, vol: 0.1, delay: i * 0.1 });
    });
  },
  bossSpawn() {
    const t = ctx.currentTime;
    tone({ t, f: 60, to: 45, type: 'sawtooth', dur: 1.8, vol: 0.4, lp: 260 });
    tone({ t, f: 90, to: 66, type: 'square', dur: 1.5, vol: 0.12, lp: 400 });
    tone({ t, f: 440, to: 415, type: 'sawtooth', dur: 1.3, vol: 0.1, lp: 1500, delay: 0.1 });
    noise({ t, f0: 200, f1: 1200, dur: 1.5, vol: 0.3, q: 1.5 });
    for (let i = 0; i < 3; i++) tone({ t, f: 55, to: 35, type: 'sine', dur: 0.35, vol: 0.5, delay: i * 0.45 });
  },
  explosion(ev) {
    const big = Math.min(1.5, Math.max(0.6, (ev.r || 80) / 90));
    tone({ f: 120 * (1.3 - big * 0.3), to: 30, type: 'sine', dur: 0.4 * big, vol: 0.5 });
    noise({ f0: 3200, f1: 100, dur: 0.45 * big, vol: 0.4, q: 0.5 });
  },
  slam(ev) {
    tone({ f: 85, to: 25, type: 'sine', dur: 0.5, vol: 0.7 });
    noise({ f0: 900, f1: 60, dur: 0.45, vol: 0.5 });
    tone({ f: 240, to: 60, type: 'square', dur: 0.12, vol: 0.14, lp: 600 });
  },
  enemyShoot(ev) {
    tone({ f: 600, to: 220, type: 'square', dur: 0.12, vol: 0.07, lp: 1800 });
  },
  upgrade() {
    [392, 523, 659, 784, 1047].forEach((f, i) => {
      tone({ f, type: 'triangle', dur: 0.25, vol: 0.16, delay: i * 0.055 });
    });
    noise({ ft: 'highpass', f0: 6000, dur: 0.4, vol: 0.06, delay: 0.1 });
  },
  gameOver() {
    [440, 392, 330, 262, 196].forEach((f, i) => {
      tone({ f, to: f * 0.97, type: 'sawtooth', dur: 0.55, vol: 0.14, lp: 1200, delay: i * 0.22 });
    });
    tone({ f: 70, to: 30, type: 'sine', dur: 1.6, vol: 0.5, delay: 0.9 });
  },
  denied() {
    tone({ f: 160, type: 'square', dur: 0.08, vol: 0.14, lp: 700 });
    tone({ f: 120, type: 'square', dur: 0.12, vol: 0.14, lp: 700, delay: 0.09 });
  },
  bossPhase() {
    tone({ f: 200, to: 60, type: 'sawtooth', dur: 0.7, vol: 0.3, lp: 900 });
    noise({ f0: 2500, f1: 150, dur: 0.6, vol: 0.3 });
  },
};

// Minimum seconds between two plays of the same sound, and a max-per-window cap.
const GAP = {
  shoot: 0.04, hit: 0.035, enemyDie: 0.05, playerHit: 0.1, dash: 0.15, blow: 0.3, blowReady: 0.5,
  switch: 0.05, pickup: 0.06, waveStart: 0.5, waveClear: 0.5, bossSpawn: 1, explosion: 0.06, slam: 0.1,
  enemyShoot: 0.07, upgrade: 0.2, gameOver: 1, denied: 0.15, bossPhase: 0.5,
};
const lastPlayed = {};
const burst = {}; // max 3 voices of a type in any 0.12s window
const BURSTY = { hit: 1, enemyDie: 1, shoot: 1, explosion: 1, enemyShoot: 1, pickup: 1 };

function play(type, ev) {
  const fn = S[type];
  if (!fn) return;
  const now = ctx.currentTime;
  const gap = GAP[type] || 0.03;
  if (now - (lastPlayed[type] || -1) < gap) return;
  if (BURSTY[type]) {
    const b = burst[type] || (burst[type] = { t: 0, n: 0 });
    if (now - b.t > 0.12) { b.t = now; b.n = 0; }
    if (++b.n > 3) return;
  }
  lastPlayed[type] = now;
  try { fn(ev || {}); } catch (e) { /* never throw from audio */ }
}

function handleEvents(events) {
  if (!ready() || !events || !events.length) return;
  if (ctx.state === 'suspended') return;
  // Per-frame dedupe: if 30 hits arrive, only the highest-multiplier one needs to sound.
  let bestHit = null;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || typeof ev.type !== 'string') continue;
    if (ev.type === 'hit') {
      if (!bestHit || ((ev.mult || 1) > 1 && (bestHit.mult || 1) <= 1)) bestHit = ev;
      continue;
    }
    play(ev.type, ev);
  }
  if (bestHit) play('hit', bestHit);
}

// ---------------------------------------------------------------- music
// Slow minor chord loop: detuned saw pad + sub bass + sparse plucked arpeggio.
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
const STEP = 0.5; // seconds per 8th-note step (60 bpm feel)

function scheduleMusic() {
  if (!ctx || !musicBus) return;
  while (musicNext < ctx.currentTime + 1.2) {
    const t = musicNext;
    const bar = Math.floor(musicStep / 8) % CHORDS.length;
    const s = musicStep % 8;
    const ch = CHORDS[bar];
    if (s === 0) {
      ch.forEach((n, i) => {
        [-6, 6].forEach((det) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          const f = ctx.createBiquadFilter();
          osc.type = 'sawtooth';
          osc.frequency.value = mtof(n);
          osc.detune.value = det + i * 2;
          f.type = 'lowpass';
          f.frequency.setValueAtTime(350, t);
          f.frequency.linearRampToValueAtTime(900, t + 2);
          f.frequency.linearRampToValueAtTime(350, t + 4);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.08, t + 1.2);
          g.gain.linearRampToValueAtTime(0.0001, t + 4.1);
          osc.connect(f); f.connect(g); g.connect(musicBus);
          osc.start(t); osc.stop(t + 4.2);
        });
      });
    }
    if (s === 0 || s === 4) {
      tone({ t, f: mtof(ch[0] - 12), type: 'sine', dur: 1.8, vol: 0.5, a: 0.02, bus: musicBus });
    }
    if (s % 2 === 1 || s === 2 || s === 6) {
      const n = ch[(s * 3 + bar) % 3] + 12;
      tone({ t, f: mtof(n), type: 'triangle', dur: 0.7, vol: 0.12, lp: 2200, bus: musicBus });
    }
    musicStep++;
    musicNext += STEP;
  }
}

function startMusic() {
  wantMusic = true;
  if (!ctx || musicTimer) return;
  try {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, ctx.currentTime + 1.5);
    musicStep = 0;
    musicNext = ctx.currentTime + 0.1;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 250);
  } catch (e) { /* ignore */ }
}

function stopMusic() {
  wantMusic = false;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (!ctx || !musicBus) return;
  try {
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    // already-scheduled notes fade with the bus; restore level for next start
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- mute
function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
  if (ctx && master) {
    try {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, t, 0.03);
    } catch (e) { /* ignore */ }
  }
}

function isMuted() { return muted; }

export const audio = { init, handleEvents, setMuted, isMuted, startMusic, stopMusic };

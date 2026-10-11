// Step 5 of the touch study: how much do touch constraints cost, measured with the bot?
//
//   node tools/touch-study/compare.mjs [seeds=30] [cap=30]
//
// Every variant plays the same seeds (no god mode) until it dies or clears wave `cap`.
// Reported: waves reached, share of runs that clear waves 5 / 10 / 15, damage taken per combat
// minute on waves 1-10, and how often a run dies on a boss wave.
// The models are in model.mjs. A difficulty proxy, not a fun measure.

import { createGame, update, applyUpgrade } from '../../src/sim.js';
import { makeModel } from './model.mjs';

const STEP = 1 / 60;
const SEEDS = Number(process.argv[2] || 30);
const CAP = Number(process.argv[3] || 30);
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;

// slow = game speed factor on touch (0.85 = the sim runs at 85% of real time), modelled by shrinking
// every human delay by the same factor in sim time
const slow = (o, f) => {
  const r = { ...o };
  for (const k of ['moveDelay', 'react', 'hop', 'reacquire', 'dashMotor', 'dashFireGap', 'aimLag']) if (r[k] !== undefined) r[k] *= f;
  return r;
};
import { PRESETS } from './model.mjs';
// touch screens add roughly 50 ms of input latency over a gaming keyboard, and a virtual stick wobbles
const TOUCHY = { moveDelay: 0.17, react: 0.25, moveNoise: 10 };

const VARIANTS = [
  ['bot (superhuman)', 'bot', {}],
  ['desktop proxy', 'desktop', {}],
  ['  desktop, no move delay', 'desktop', { moveDelay: 0 }],
  ['  desktop, react 0', 'desktop', { react: 0 }],
  ['  desktop, react 0.6 (slow switching)', 'desktop', { react: 0.6 }],
  ['  desktop, never switches element', 'desktop', { noSwitch: true }],
  ['  desktop, +50 ms move latency', 'desktop', { moveDelay: 0.17 }],
  ['touch twin-stick, manual aim', 'touchTwin', {}],
  ['  twin-stick, aim noise 3deg', 'touchTwin', { aimNoise: 3 }],
  ['  twin-stick, switching never stops fire', 'touchTwin', { hopFireGap: false, dashFireGap: 0 }],
  ['touch pads, hold to fire', 'touchPadsHold', {}],
  ['touch pads, auto-fire (proto)', 'touchPads', {}],
  ['  pads, optimistic (hop .12, mistap 2%)', 'touchPads', { hop: 0.12, mistap: 0.02 }],
  ['  pads, pessimistic (react .3, hop .35, mistap 10%)', 'touchPads', { react: 0.3, hop: 0.35, mistap: 0.1 }],
  ['  pads, dash not blocked by hops', 'touchPads', { dashBlockedBySwitch: false }],
  ['  pads + auto-lead', 'touchPads', { autoLead: true }],
  ['  pads + the prototype autoAim (touch.js)', 'touchPads', { aim: 'proto' }],
  ['  pads + proto autoAim + latency + noise', 'touchPads', { aim: 'proto', moveDelay: 0.17, react: 0.25, moveNoise: 10 }],
  ['  pads, game speed 0.85', 'touchPads', slow(PRESETS.touchPads, 0.85)],
  ['  pads + touch latency (+50 ms) + stick noise 10deg', 'touchPads', TOUCHY],
  ['  pads + latency + noise, game speed 0.85', 'touchPads', slow({ ...PRESETS.touchPads, ...TOUCHY }, 0.85)],
  ['lite: auto-aim + auto-element', 'touchLite', {}],
  ['  lite + latency + noise', 'touchLite', TOUCHY],
];

function run(model, seed) {
  const g = createGame(seed);
  const m = makeModel(model[1], model[2], seed);
  let guard = 0;
  let combat = 0;
  let early = { combat: 0, dmg: 0 };
  let prevTaken = 0;
  while (g.phase !== 'gameover' && g.wave <= CAP && guard++ < 60 * 60 * 60) {
    if (g.phase === 'upgrade') {
      applyUpgrade(g, g.upgradeChoices[0].id);
      continue;
    }
    update(g, m.input(g), STEP);
    const active = g.enemies.length > 0 && !(g.waveInfo.countdown > 0);
    if (active) combat += STEP;
    if (g.wave <= 10) {
      if (active) early.combat += STEP;
      early.dmg += g.stats.damageTaken - prevTaken;
    }
    prevTaken = g.stats.damageTaken;
  }
  const died = g.phase === 'gameover';
  const wi = g.waveInfo;
  const frac = died && wi.total ? Math.max(0, Math.min(1, 1 - wi.remaining / wi.total)) : 0;
  const cleared = died ? g.wave - 1 : CAP;
  return { wave: died ? g.wave : CAP + 1, cleared, progress: cleared + frac, died, bossDeath: died && g.wave % 5 === 0, combat, early };
}

const quant = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const rows = [];
for (const v of VARIANTS) {
  if (ONLY && !ONLY.has(v[1]) && !ONLY.has(v[0])) continue;
  const R = [];
  for (let s = 0; s < SEEDS; s++) R.push(run(v, 5000 + s));
  const cl = R.map((r) => r.cleared);
  const pg = R.map((r) => r.progress);
  const mean = pg.reduce((a, b) => a + b, 0) / pg.length;
  const sd = Math.sqrt(pg.reduce((a, b) => a + (b - mean) ** 2, 0) / (pg.length - 1));
  const ec = R.reduce((a, r) => a + r.early.combat, 0) / 60;
  const ed = R.reduce((a, r) => a + r.early.dmg, 0);
  const deaths = R.filter((r) => r.died);
  rows.push({
    variant: v[0],
    'waves (mean+-se)': `${mean.toFixed(2)} +- ${(sd / Math.sqrt(pg.length)).toFixed(2)}`,
    'cleared med': quant(cl, 0.5),
    'p25-p75': `${quant(cl, 0.25)}-${quant(cl, 0.75)}`,
    'clear W5': Math.round((100 * cl.filter((c) => c >= 5).length) / R.length) + '%',
    'clear W10': Math.round((100 * cl.filter((c) => c >= 10).length) / R.length) + '%',
    'clear W15': Math.round((100 * cl.filter((c) => c >= 15).length) / R.length) + '%',
    'dmg/min W1-10': (ed / ec).toFixed(0),
    'boss-wave deaths': deaths.length ? Math.round((100 * deaths.filter((r) => r.bossDeath).length) / deaths.length) + '%' : '-',
  });
}
console.log(`seeds=${SEEDS} cap=wave ${CAP} (no god mode; first upgrade card each time)`);
console.table(rows);

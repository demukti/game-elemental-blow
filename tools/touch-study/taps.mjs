// Touch study, follow-up: aim stick (fires while pushed) + element by tap series (2 taps = next element,
// 3 = the one after, 4 = the farthest), compared with pads and the auto-aim prototype on the same seeds.
//
//   node tools/touch-study/taps.mjs [seeds=60] [cap=30]
//
// Same run loop and difficulty proxy as compare.mjs. Not a fun measure.

import { createGame, update, applyUpgrade } from '../../src/sim.js';
import { makeModel, PRESETS } from './model.mjs';

const STEP = 1 / 60;
const SEEDS = Number(process.argv[2] || 60);
const CAP = Number(process.argv[3] || 30);

const KEYS = ['fire', 'water', 'earth', 'air']; // the 1-4 keys and Q / E
const CYCLE = ['water', 'fire', 'air', 'earth']; // the beats cycle: each beats the next
const T = { order: KEYS, think: 0.15, tapIv: 0.17, window: 0.25, immediate: false, thumb: 'right' };
const twin = PRESETS.touchTwin;
const taps = (t = {}, o = {}) => ({ ...twin, hopFireGap: false, taps: { ...T, ...t }, ...o });

const VARIANTS = [
  ['desktop proxy', 'desktop', {}],
  ['twin-stick + element pads (right thumb hops)', 'touchTwin', {}],
  ['auto-aim prototype + pads', 'touchPads', { aim: 'proto' }],
  ['aim stick + tap series (right thumb)', 'touchTwin', taps()],
  ['  taps: each tap applies at once (no end window)', 'touchTwin', taps({ immediate: true })],
  ['  taps: quick and sure (0.13 s/tap, think 0.05, miscount 2%)', 'touchTwin', taps({ tapIv: 0.13, think: 0.05, window: 0.2 }, { mistap: 0.02 })],
  ['  taps: under pressure (0.2 s/tap, think 0.3, miscount 10%)', 'touchTwin', taps({ tapIv: 0.2, think: 0.3 }, { mistap: 0.1 })],
  ['  taps along the beats cycle instead of 1-4 order', 'touchTwin', taps({ order: CYCLE })],
  ['  taps with the left thumb (movement stops, fire goes on)', 'touchTwin', taps({ thumb: 'left' })],
  ['auto-aim + tap series (reference)', 'touchPads', { aim: 'proto', taps: { ...T }, hop: 0 }],
];

function run(v, seed) {
  const g = createGame(seed);
  const m = makeModel(v[1], v[2], seed);
  let guard = 0;
  while (g.phase !== 'gameover' && g.wave <= CAP && guard++ < 60 * 60 * 60) {
    if (g.phase === 'upgrade') {
      applyUpgrade(g, g.upgradeChoices[0].id);
      continue;
    }
    update(g, m.input(g), STEP);
  }
  const died = g.phase === 'gameover';
  const wi = g.waveInfo;
  const frac = died && wi.total ? Math.max(0, Math.min(1, 1 - wi.remaining / wi.total)) : 0;
  const cleared = died ? g.wave - 1 : CAP;
  return { cleared, progress: cleared + frac, died, bossDeath: died && g.wave % 5 === 0, stats: m.model.stats, time: g.time };
}

const rows = [];
for (const v of VARIANTS) {
  const R = [];
  for (let s = 0; s < SEEDS; s++) R.push(run(v, 5000 + s));
  const pg = R.map((r) => r.progress);
  const mean = pg.reduce((a, b) => a + b, 0) / pg.length;
  const sd = Math.sqrt(pg.reduce((a, b) => a + (b - mean) ** 2, 0) / (pg.length - 1));
  const cl = R.map((r) => r.cleared);
  const dist = [0, 0, 0, 0];
  for (const r of R) if (r.stats.dist) r.stats.dist.forEach((c, i) => (dist[i] += c));
  const dn = dist.reduce((a, b) => a + b, 0);
  const sw = R.reduce((a, r) => a + r.stats.switches, 0);
  const mins = R.reduce((a, r) => a + r.time, 0) / 60;
  rows.push({
    variant: v[0],
    'waves (mean+-se)': `${mean.toFixed(2)} +- ${(sd / Math.sqrt(pg.length)).toFixed(2)}`,
    'clear W10': Math.round((100 * cl.filter((c) => c >= 10).length) / R.length) + '%',
    'switches/min': (sw / mins).toFixed(0),
    'steps 1/2/3': dn ? dist.slice(1).map((c) => Math.round((100 * c) / dn) + '%').join(' / ') : '-',
  });
}
console.log(`seeds=${SEEDS} cap=wave ${CAP}`);
console.table(rows);

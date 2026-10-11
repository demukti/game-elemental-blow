// Touch study, follow-up: tilt (gyroscope) to move, compared with the stick schemes on the same seeds.
//
//   node tools/touch-study/tilt.mjs [seeds=60] [cap=30]
//
// Same run loop and difficulty proxy as compare.mjs (waves cleared, no god mode, first upgrade card).
// It cannot model what tilt does to reading the screen (the display turns away from the eyes as you steer).

import { createGame, update, applyUpgrade } from '../../src/sim.js';
import { makeModel } from './model.mjs';

const STEP = 1 / 60;
const SEEDS = Number(process.argv[2] || 60);
const CAP = Number(process.argv[3] || 30);
const TOUCHY = { moveDelay: 0.17, react: 0.25, moveNoise: 10 }; // stick schemes: +50 ms latency, wobble

const VARIANTS = [
  ['desktop proxy', 'desktop', {}],
  ['stick move + stick aim (twin-stick)', 'touchTwin', {}],
  ['stick move + auto-aim (prototype) + latency + wobble', 'touchPads', { aim: 'proto', ...TOUCHY }],
  ['tilt move + stick aim', 'tiltAim', {}],
  ['  tilt + stick aim, quick tilt (lag 0.1 s)', 'tiltAim', { tiltLag: 0.1 }],
  ['  tilt + stick aim, slow tilt (lag 0.3 s)', 'tiltAim', { tiltLag: 0.3 }],
  ['  tilt + stick aim, steady hand (drift 0.05)', 'tiltAim', { tiltDrift: 0.05 }],
  ['  tilt + stick aim, unsteady hand (drift 0.2)', 'tiltAim', { tiltDrift: 0.2 }],
  ['  tilt + stick aim, aim noise 3 deg', 'tiltAim', { aimNoise: 3 }],
  ['tilt move + auto-aim', 'tiltAuto', {}],
  ['  tilt + auto-aim, quick tilt (lag 0.1 s)', 'tiltAuto', { tiltLag: 0.1 }],
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
  return { cleared, progress: cleared + frac, died, bossDeath: died && g.wave % 5 === 0, dmg: g.stats.damageTaken };
}

const rows = [];
for (const v of VARIANTS) {
  const R = [];
  for (let s = 0; s < SEEDS; s++) R.push(run(v, 5000 + s));
  const pg = R.map((r) => r.progress);
  const mean = pg.reduce((a, b) => a + b, 0) / pg.length;
  const sd = Math.sqrt(pg.reduce((a, b) => a + (b - mean) ** 2, 0) / (pg.length - 1));
  const cl = R.map((r) => r.cleared);
  const deaths = R.filter((r) => r.died);
  rows.push({
    variant: v[0],
    'waves (mean+-se)': `${mean.toFixed(2)} +- ${(sd / Math.sqrt(pg.length)).toFixed(2)}`,
    'clear W5': Math.round((100 * cl.filter((c) => c >= 5).length) / R.length) + '%',
    'clear W10': Math.round((100 * cl.filter((c) => c >= 10).length) / R.length) + '%',
    'boss-wave deaths': deaths.length ? Math.round((100 * deaths.filter((r) => r.bossDeath).length) / deaths.length) + '%' : '-',
  });
}
console.log(`seeds=${SEEDS} cap=wave ${CAP}`);
console.table(rows);

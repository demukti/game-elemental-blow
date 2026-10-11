// Shared run loop for the touch study's follow-up comparisons (tilt.mjs, taps.mjs, circle.mjs): every
// variant plays the same seeds (no god mode, first upgrade card) until it dies or clears wave `cap`.
// A difficulty proxy, not a fun measure.

import { createGame, update, applyUpgrade } from '../../src/sim.js';
import { makeModel } from './model.mjs';

const STEP = 1 / 60;

function run(v, seed, cap) {
  const g = createGame(seed);
  const m = makeModel(v[1], v[2], seed);
  let guard = 0;
  while (g.phase !== 'gameover' && g.wave <= cap && guard++ < 60 * 60 * 60) {
    if (g.phase === 'upgrade') {
      applyUpgrade(g, g.upgradeChoices[0].id);
      continue;
    }
    update(g, m.input(g), STEP);
  }
  const died = g.phase === 'gameover';
  const wi = g.waveInfo;
  const frac = died && wi.total ? Math.max(0, Math.min(1, 1 - wi.remaining / wi.total)) : 0;
  const cleared = died ? g.wave - 1 : cap;
  return { cleared, progress: cleared + frac, died, bossDeath: died && g.wave % 5 === 0, stats: m.model.stats, time: g.time };
}

/** Runs each [label, preset, overrides] variant over `seeds` seeds and prints one table row per variant. */
export function compare(variants, { seeds = 60, cap = 30, steps = false } = {}) {
  const rows = [];
  for (const v of variants) {
    const R = [];
    for (let s = 0; s < seeds; s++) R.push(run(v, 5000 + s, cap));
    const pg = R.map((r) => r.progress);
    const mean = pg.reduce((a, b) => a + b, 0) / pg.length;
    const sd = Math.sqrt(pg.reduce((a, b) => a + (b - mean) ** 2, 0) / (pg.length - 1));
    const cl = R.map((r) => r.cleared);
    const deaths = R.filter((r) => r.died);
    const mins = R.reduce((a, r) => a + r.time, 0) / 60;
    const row = {
      variant: v[0],
      'waves (mean+-se)': `${mean.toFixed(2)} +- ${(sd / Math.sqrt(pg.length)).toFixed(2)}`,
      'clear W5': Math.round((100 * cl.filter((c) => c >= 5).length) / R.length) + '%',
      'clear W10': Math.round((100 * cl.filter((c) => c >= 10).length) / R.length) + '%',
      'switches/min': (R.reduce((a, r) => a + r.stats.switches, 0) / mins).toFixed(0),
      'boss-wave deaths': deaths.length ? Math.round((100 * deaths.filter((r) => r.bossDeath).length) / deaths.length) + '%' : '-',
    };
    if (steps) {
      const dist = [0, 0, 0, 0];
      for (const r of R) if (r.stats.dist) r.stats.dist.forEach((c, i) => (dist[i] += c));
      const dn = dist.reduce((a, b) => a + b, 0);
      row['steps 1/2/3'] = dn ? dist.slice(1).map((c) => Math.round((100 * c) / dn) + '%').join(' / ') : '-';
    }
    rows.push(row);
  }
  console.log(`seeds=${seeds} cap=wave ${cap}`);
  console.table(rows);
}

export const args = () => ({ seeds: Number(process.argv[2] || 60), cap: Number(process.argv[3] || 30) });

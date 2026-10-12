// Quick baseline: how far does the unconstrained smart bot get, and how fast does the sim run?
import { createGame, update, applyUpgrade } from '../../src/sim.js';
import { botInput } from '../../src/bot.js';

const STEP = 1 / 60;
const t0 = Date.now();
const res = [];
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const g = createGame(seed);
  let steps = 0;
  while (g.phase !== 'gameover' && g.wave <= 15 && steps < 60 * 60 * 40) {
    if (g.phase === 'upgrade') {
      applyUpgrade(g, g.upgradeChoices[0].id);
      continue;
    }
    update(g, botInput(g), STEP);
    steps++;
  }
  res.push({ seed, wave: g.wave, phase: g.phase, min: (g.time / 60).toFixed(1), dmgTaken: Math.round(g.stats.damageTaken) });
}
console.table(res);
console.log('ms', Date.now() - t0);

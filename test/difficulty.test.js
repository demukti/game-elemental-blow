// Difficulty curve: the wave director's config-driven rules (budget, palette, unlocks, sponge cap,
// pressure and mercy spawn rules, enemy scaling) and a cheap "the weak bot survives the opening" soak.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, update, applyUpgrade, spawnEnemy } from '../src/sim.js';
import { ENEMIES, WAVE } from '../src/config.js';
import { STEP, botInput } from './helpers.js';

const isBoss = (n) => n % WAVE.bossEvery === 0;
const budgetOf = (n) =>
  (WAVE.budgetBase + WAVE.budgetPerWave * (n - 1)) * (n > 1 && isBoss(n - 1) ? WAVE.breather : 1);

/** Plans waves 1..last for a seed without playing them: [{ wave, queue }]. */
function planned(seed, last) {
  const g = createGame(seed);
  const out = [];
  for (let w = 1; w <= last; w++) {
    out.push({ wave: w, queue: g._queue.slice() });
    g.phase = 'upgrade';
    g.player.upgrades = []; // keep 'swift' pickable forever
    assert.equal(applyUpgrade(g, 'swift'), true);
  }
  return out;
}

const count = (queue, type) => queue.filter((e) => e.type === type).length;
const cost = (queue) => queue.reduce((s, e) => s + ENEMIES[e.type].cost, 0);

test('regular waves spend their budget (within one body of it) and the wave after a boss is a breather', () => {
  for (const seed of [1, 2, 3]) {
    let prev = 0;
    for (const { wave, queue } of planned(seed, 16)) {
      if (isBoss(wave)) continue;
      const b = budgetOf(wave);
      const c = cost(queue);
      assert.ok(c >= b - 0.2 - 1e-9 && c <= b + ENEMIES.brute.cost + 0.2, `seed ${seed} wave ${wave}: cost ${c} for budget ${b}`);
      if (wave > 1 && isBoss(wave - 1)) {
        assert.ok(budgetOf(wave) < WAVE.budgetBase + WAVE.budgetPerWave * (wave - 1), `wave ${wave} eases off`);
      } else if (wave > 1) {
        assert.ok(budgetOf(wave) > prev, `budget grows into wave ${wave}`);
      }
      prev = budgetOf(wave);
    }
  }
});

test('simultaneous elements follow WAVE.palette: 2 on waves 1-2, 3 on 3-5, 4 from 6', () => {
  assert.deepEqual(WAVE.palette.slice(0, 6), [2, 2, 3, 3, 3, 4]);
  for (const seed of [4, 5]) {
    const seen = {};
    for (const { wave, queue } of planned(seed, 9)) {
      if (isBoss(wave)) continue;
      const size = WAVE.palette[Math.min(WAVE.palette.length, wave) - 1];
      const els = new Set(queue.map((e) => e.element)).size;
      assert.ok(els <= size, `seed ${seed} wave ${wave}: ${els} elements > ${size}`);
      seen[wave] = els;
    }
    // swarm packs share one element, so a wave may draw fewer than its palette; across a few waves it uses it all
    assert.equal(Math.max(seen[1], seen[2]), 2, `seed ${seed}: waves 1-2 use both elements`);
    assert.equal(Math.max(seen[3], seen[4]), 3, `seed ${seed}: waves 3-4 reach 3 elements`);
    assert.equal(Math.max(seen[6], seen[7], seen[8], seen[9]), 4, `seed ${seed}: waves 6-9 reach 4 elements`);
  }
  // data-driven: a one-element opening wave
  const saved = WAVE.palette[0];
  try {
    WAVE.palette[0] = 1;
    const g = createGame(7);
    assert.equal(new Set(g._queue.map((e) => e.element)).size, 1);
  } finally {
    WAVE.palette[0] = saved;
  }
});

test('types unlock on WAVE.unlock waves; spitters stay solo through WAVE.spitterSolo; brutes are rationed', () => {
  assert.deepEqual(WAVE.unlock, { swarm: 2, spitter: 3, brute: 4 });
  for (const seed of [1, 2, 3, 4]) {
    for (const { wave, queue } of planned(seed, 12)) {
      if (isBoss(wave)) continue;
      for (const type of ['swarm', 'spitter', 'brute']) {
        if (wave < WAVE.unlock[type]) assert.equal(count(queue, type), 0, `seed ${seed} wave ${wave}: early ${type}`);
      }
      const spitterLimit = wave <= WAVE.spitterSolo ? 1 : 1 + Math.floor((wave - WAVE.spitterSolo) * WAVE.spitterPerWave);
      assert.ok(count(queue, 'spitter') <= spitterLimit, `seed ${seed} wave ${wave}: ${count(queue, 'spitter')} spitters`);
      assert.ok(count(queue, 'brute') <= Math.floor(wave / WAVE.brutePer), `seed ${seed} wave ${wave}: too many brutes`);
      assert.notEqual(queue[0] && queue[0].type, 'brute', 'a wave never opens with a brute');
      if (wave === 1) assert.ok(queue.every((e) => e.type === 'grunt') && queue.length <= 5);
    }
  }
});

test('budget the body cap cannot spend becomes HP, capped at WAVE.spongeCap', () => {
  const saved = WAVE.maxPerWave;
  try {
    WAVE.maxPerWave = 3;
    const plans = planned(9, 12);
    const g = createGame(9);
    g.phase = 'upgrade';
    g.wave = 11;
    applyUpgrade(g, 'swift');
    assert.equal(g.wave, 12);
    assert.equal(g._queue.length, 3);
    assert.equal(g._waveHp, WAVE.spongeCap);
    assert.ok(plans.filter((p) => !isBoss(p.wave)).every((p) => p.queue.length <= 3), 'regular waves obey the body cap');
  } finally {
    WAVE.maxPerWave = saved;
  }
  assert.equal(createGame(9)._waveHp, 1, 'no sponge when the budget fits');
});

/** A live wave-1 arena: countdown over, queue waiting, nothing spawned yet. */
function liveWave(seed = 3) {
  const g = createGame(seed);
  g.waveInfo.countdown = 0;
  g._waveActive = true;
  return g;
}

test('pressure rule: an arena emptier than one spawn group pulls the next group forward', () => {
  const g = liveWave();
  g._spawnTimer = WAVE.spawnIntervalBase;
  update(g, null, STEP);
  assert.equal(g.enemies.length, 0, 'not spawned yet');
  assert.ok(g._spawnTimer <= WAVE.pressureInterval, `timer ${g._spawnTimer} pulled to the pressure interval`);
  for (let i = 0; i < 60 && g.enemies.length === 0; i++) update(g, null, STEP);
  assert.equal(g.enemies.length, 1, 'group spawned within the pressure interval');
  assert.ok(Math.abs(g._spawnTimer - WAVE.spawnIntervalBase) < STEP + 1e-9, 'then the regular interval applies');
  // one enemy alive on a 1-group wave: no pressure, the timer just counts down
  const before = g._spawnTimer;
  update(g, null, STEP);
  assert.ok(Math.abs(g._spawnTimer - (before - STEP)) < 1e-9);
});

test('mercy rule: below WAVE.mercyHp on an early wave the spawn interval stretches by WAVE.mercySlow', () => {
  const interval = (wave, hpFrac) => {
    const g = liveWave();
    g.wave = wave;
    g.player.hp = g.player.maxHp * hpFrac;
    g._spawnTimer = 0;
    update(g, null, STEP);
    assert.ok(g.enemies.length >= 1, 'a group spawned');
    return g._spawnTimer;
  };
  const base = WAVE.spawnIntervalBase;
  assert.equal(interval(1, 1), base);
  assert.equal(interval(1, WAVE.mercyHp - 0.05), base * WAVE.mercySlow);
  assert.equal(interval(WAVE.mercyUntil, WAVE.mercyHp - 0.05), (base - WAVE.spawnIntervalPerWave * (WAVE.mercyUntil - 1)) * WAVE.mercySlow);
  const late = WAVE.mercyUntil + 1;
  assert.equal(interval(late, WAVE.mercyHp - 0.05), base - WAVE.spawnIntervalPerWave * (late - 1), 'no mercy past mercyUntil');
  // mercy also stretches the pressure interval
  const g = liveWave();
  g.player.hp = 1;
  g._spawnTimer = base;
  update(g, null, STEP);
  assert.ok(Math.abs(g._spawnTimer - WAVE.pressureInterval * WAVE.mercySlow) < 1e-9);
});

test('enemy scaling: HP and damage follow WAVE.scale, speed saturates below 1 + speedMax', () => {
  const at = (wave) => {
    const g = createGame(1);
    g._queue = [];
    g.wave = wave;
    return spawnEnemy(g, 'grunt', 'fire', 300, 300);
  };
  const def = ENEMIES.grunt;
  const sc = WAVE.scale;
  const e1 = at(1);
  assert.equal(e1.maxHp, def.hp);
  assert.equal(e1._speed, def.speed);
  assert.equal(e1._dmg, def.dmg);
  const e10 = at(10);
  const k = 9;
  assert.ok(Math.abs(e10.maxHp - def.hp * (1 + sc.hp * k + sc.hpQuad * k * k)) < 1e-6);
  assert.ok(Math.abs(e10._dmg - def.dmg * (1 + sc.dmg * k)) < 1e-6);
  assert.ok(e10._speed > e1._speed && e10._speed < def.speed * (1 + sc.speedMax));
  const e100 = at(100);
  assert.ok(e100._speed > at(30)._speed && e100._speed < def.speed * (1 + sc.speedMax), 'soft cap never reached');
  assert.ok(e100._speed > def.speed * (1 + sc.speedMax * 0.8), 'but approached');
});

test('the opening is gentle: the plain bot clears waves 1 and 2 without dying', () => {
  // The plain bot kites a lone melee enemy forever while it holds earth (its counter), so only seeds whose
  // first two waves end without that stand-off are usable here; the bound is generous for the same reason.
  for (const seed of [1, 2, 4, 5]) {
    const g = createGame(seed);
    let cleared = 0;
    let minHp = g.player.hp;
    for (let i = 0; i < 60 * 150 && cleared < 2; i++) {
      if (g.phase === 'upgrade') {
        applyUpgrade(g, g.upgradeChoices[0].id);
        continue;
      }
      update(g, botInput(g, { smart: false }), STEP);
      minHp = Math.min(minHp, g.player.hp);
      if (g.events.some((e) => e.type === 'waveClear')) cleared++;
      if (g.phase === 'gameover') break;
    }
    assert.equal(cleared, 2, `seed ${seed}: cleared ${cleared} waves (phase ${g.phase}, wave ${g.wave}, t ${g.time.toFixed(0)} s)`);
    assert.ok(minHp >= g.player.maxHp * 0.5, `seed ${seed}: dipped to ${minHp} HP`);
  }
});

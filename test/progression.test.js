import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, update, applyUpgrade } from '../src/sim.js';
import { ELEMENTS } from '../src/config.js';
import { IDLE, STEP, botInput } from './helpers.js';

/** Run a god-mode bot until `pred(state, events)` is true; returns all events seen. */
function runUntil(g, pred, maxSteps, { god = true, pick = (c) => c[0].id } = {}) {
  const all = [];
  for (let i = 0; i < maxSteps; i++) {
    if (g.phase === 'upgrade' && !pred(g, [])) {
      applyUpgrade(g, pick(g.upgradeChoices));
      all.push(...g.events);
      continue;
    }
    if (god) g.player.hp = g.player.maxHp;
    update(g, botInput(g), STEP);
    all.push(...g.events);
    if (pred(g, g.events)) return all;
    if (g.phase === 'gameover') break;
  }
  return all;
}

test('a wave clears into the upgrade phase and the next wave starts', () => {
  const g = createGame(7);
  const ev = runUntil(g, (s) => s.phase === 'upgrade', 60 * 120);
  assert.equal(g.phase, 'upgrade', 'reached the upgrade phase');
  assert.ok(ev.some((e) => e.type === 'waveStart' && e.wave === 1 && e.isBoss === false));
  assert.ok(ev.some((e) => e.type === 'waveClear' && e.wave === 1));
  assert.ok(ev.filter((e) => e.type === 'enemyDie').length >= 3);
  assert.ok(g.score > 0 && g.kills >= 3);
  assert.equal(g.waveInfo.remaining, 0);
  assert.equal(g.enemies.length, 0);

  const choices = g.upgradeChoices;
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map((c) => c.id)).size, 3);
  for (const c of choices) {
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.desc, 'string');
    assert.ok(c.element === null || ELEMENTS.includes(c.element));
  }

  // frozen while choosing
  const t = g.time;
  update(g, IDLE, STEP);
  assert.equal(g.time, t);

  assert.equal(applyUpgrade(g, choices[1].id), true);
  assert.equal(g.phase, 'playing');
  assert.equal(g.wave, 2);
  assert.ok(g.waveInfo.countdown > 0);
  assert.ok(g.waveInfo.total > 0);
  assert.equal(g.upgradeChoices.length, 0);

  const ev2 = runUntil(g, (s, e) => e.some((x) => x.type === 'waveStart'), 60 * 10);
  const ws = ev2.find((e) => e.type === 'waveStart');
  assert.deepEqual(ws, { type: 'waveStart', wave: 2, isBoss: false });
  assert.equal(g.waveInfo.countdown, 0);
  runUntil(g, (s) => s.enemies.length > 0, 60 * 5);
  assert.ok(g.enemies.length > 0, 'wave 2 enemies spawn');
});

test('the boss arrives on wave 5, shifts element, uses several patterns and can be beaten', () => {
  // seed chosen so the first boss shows all three patterns inside the window (the wave plan's RNG use changed
  // when the director became config-driven, and seed 2024's boss then skipped a pattern)
  const g = createGame(2027);
  const ev = runUntil(g, (s, e) => e.some((x) => x.type === 'bossSpawn'), 60 * 600);
  const start = ev.filter((e) => e.type === 'waveStart');
  assert.deepEqual(start.map((e) => e.wave), [1, 2, 3, 4, 5]);
  assert.equal(start[4].isBoss, true);
  assert.ok(start.slice(0, 4).every((e) => !e.isBoss));
  assert.equal(g.wave, 5);
  assert.equal(g.waveInfo.isBoss, true);
  assert.equal(g.player.upgrades.reduce((a, u) => a + u.count, 0), 4, 'one upgrade per cleared wave');

  const boss = g.enemies.find((e) => e.type === 'boss');
  assert.ok(boss, 'boss is on the field');
  assert.ok(boss.maxHp >= 1000);
  const firstElement = boss.element;

  const patterns = new Set();
  const elements = new Set([firstElement]);
  const all = [];
  for (let i = 0; i < 60 * 240 && g.phase === 'playing'; i++) {
    g.player.hp = g.player.maxHp;
    update(g, botInput(g), STEP);
    all.push(...g.events);
    const b = g.enemies.find((e) => e.type === 'boss');
    if (b) {
      patterns.add(b._ai.replace(/Wind$/, ''));
      elements.add(b.element);
      // 'telegraph' only carries directional (charge) wind-ups; area wind-ups use effects + windup
      if (b._ai === 'burstWind' || b._ai === 'summonWind') {
        assert.equal(b.telegraph, 0);
        assert.ok(b.windup >= 0 && (b.telegraphKind === 'burst' || b.telegraphKind === 'summon'));
        assert.ok(g.effects.some((f) => f.kind === 'telegraph'), 'area wind-up shows a telegraph effect');
      }
      if (b._ai === 'chargeWind' && b.windup > 0) assert.equal(b.telegraph, b.windup);
    }
  }
  const phases = all.filter((e) => e.type === 'bossPhase');
  assert.equal(phases.length, 2, 'two element shifts (66% / 33%)');
  assert.ok(elements.size >= 2, 'boss changed element');
  for (const p of phases) assert.ok(ELEMENTS.includes(p.element));
  // shared patterns (summon becomes 'echo' turrets from phase 2) plus the element signature ('sig' wind-up, then 'winded')
  assert.ok(['burst', 'summon', 'echo', 'charge', 'spiral'].filter((p) => patterns.has(p)).length >= 3, `patterns: ${[...patterns]}`);
  assert.ok(patterns.has('sig') && patterns.has('winded'), `signature pattern + winded window seen: ${[...patterns]}`);
  assert.ok(all.some((e) => e.type === 'enemyDie' && e.enemyType === 'boss'), 'boss defeated');
  assert.ok(all.some((e) => e.type === 'waveClear' && e.wave === 5));
  assert.equal(g.phase, 'upgrade');
});

test('waves scale up: more enemies and tougher ones later', () => {
  const g = createGame(99);
  const totals = {};
  const hp = {};
  runUntil(g, (s) => {
    totals[s.wave] = s.waveInfo.total;
    for (const e of s.enemies) if (e.type === 'grunt') hp[s.wave] = e.maxHp;
    return s.wave >= 9;
  }, 60 * 900);
  assert.ok(g.wave >= 9, `reached wave ${g.wave}`);
  assert.ok(totals[8] > totals[1] * 2, `wave 8 has ${totals[8]} vs wave 1 ${totals[1]}`);
  assert.ok(hp[8] > hp[1] * 1.5);
});

test('the player can die: phase gameover with a gameOver event, then the sim freezes', () => {
  const g = createGame(3);
  const ev = [];
  for (let i = 0; i < 60 * 300 && g.phase === 'playing'; i++) {
    update(g, IDLE, STEP);
    ev.push(...g.events);
  }
  assert.equal(g.phase, 'gameover');
  assert.equal(g.player.hp, 0);
  assert.ok(ev.some((e) => e.type === 'playerHit' && e.dmg > 0));
  const over = ev.filter((e) => e.type === 'gameOver');
  assert.equal(over.length, 1);
  assert.equal(over[0].score, g.score);
  assert.equal(over[0].wave, g.wave);
  const t = g.time;
  update(g, { ...IDLE, fire: true }, STEP);
  assert.equal(g.time, t);
  assert.equal(g.events.length, 0);
});

test('wave 1 is easy: the simple bot clears it without dying', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = createGame(seed);
    runUntil(g, (s) => s.phase === 'upgrade', 60 * 60, { god: false });
    assert.equal(g.phase, 'upgrade', `seed ${seed}`);
    assert.ok(g.player.hp > g.player.maxHp * 0.6, `seed ${seed}: hp ${g.player.hp}`);
  }
});

test('same seed + same inputs -> identical runs; different seed -> different run', () => {
  const run = (seed) => {
    const g = createGame(seed);
    runUntil(g, () => false, 4000, { god: false });
    return JSON.stringify(g);
  };
  assert.equal(run(12345), run(12345));
  assert.notEqual(run(12345), run(54321));
});

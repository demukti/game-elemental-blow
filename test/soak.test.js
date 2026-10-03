import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, update, applyUpgrade } from '../src/sim.js';
import { ARENA, CAPS } from '../src/config.js';
import { STEP, botInput, findNonFinite } from './helpers.js';

function checkState(g, where) {
  const bad = findNonFinite(g);
  assert.equal(bad, null, `non-finite number at ${bad} (${where})`);
  assert.ok(g.enemies.length <= CAPS.enemies, `enemy cap (${where})`);
  assert.ok(g.projectiles.length <= CAPS.playerProjectiles + CAPS.enemyProjectiles, `projectile cap (${where})`);
  assert.ok(g.effects.length <= CAPS.effects, `effect cap (${where})`);
  assert.ok(g.pickups.length <= CAPS.pickups, `pickup cap (${where})`);
  for (const e of g.enemies) {
    assert.ok(e.x >= e.r - 1e-9 && e.x <= ARENA.w - e.r + 1e-9 && e.y >= e.r - 1e-9 && e.y <= ARENA.h - e.r + 1e-9,
      `enemy ${e.id} (${e.type}) outside arena at ${e.x},${e.y} (${where})`);
    assert.ok(e.hp > 0, `dead enemy left in state (${where})`);
  }
  const p = g.player;
  assert.ok(p.x >= p.r && p.x <= ARENA.w - p.r && p.y >= p.r && p.y <= ARENA.h - p.r, `player outside arena (${where})`);
  assert.ok(p.hp >= 0 && p.hp <= p.maxHp, `player hp ${p.hp}/${p.maxHp} (${where})`);
  assert.ok(p.blow >= 0 && p.blow <= 100);
  for (const v of Object.values(p.cooldowns)) assert.ok(v >= 0 && v <= 1);
  assert.ok(g.combo >= 1 && g.comboTimer >= 0 && g.comboTimer <= 1);
  for (const ev of g.events) {
    assert.equal(typeof ev.type, 'string');
    assert.equal(findNonFinite(ev), null, `non-finite in ${ev.type} event (${where})`);
  }
}

/**
 * Soak: run the bot for many steps across restarts, picking upgrades as they come.
 * `simple` is the plain bot (flee nearest, aim at it, counter element, hold fire);
 * `god` keeps the player topped up so long runs reach late waves, bosses and caps.
 */
function soak({ seed, steps, smart, god }) {
  let g = createGame(seed);
  let maxWave = 1;
  let games = 1;
  for (let i = 0; i < steps; i++) {
    if (g.phase === 'gameover') {
      g = createGame(seed + games * 101);
      games++;
    }
    if (g.phase === 'upgrade') {
      const c = g.upgradeChoices;
      assert.equal(c.length, 3);
      assert.equal(applyUpgrade(g, c[i % 3].id), true);
    }
    if (god) g.player.hp = g.player.maxHp;
    update(g, botInput(g, { smart }), STEP);
    maxWave = Math.max(maxWave, g.wave);
    if (i % 7 === 0 || g.events.length) checkState(g, `seed ${seed} step ${i} wave ${g.wave}`);
  }
  checkState(g, `seed ${seed} end`);
  return { maxWave, games };
}

test('soak: simple bot over several thousand steps, no NaN/Infinity, no exceptions', () => {
  for (const seed of [1, 7, 31337]) {
    const r = soak({ seed, steps: 6000, smart: false, god: false });
    assert.ok(r.maxWave >= 1);
  }
});

test('soak: smarter bot with restarts', () => {
  const r = soak({ seed: 77, steps: 12000, smart: true, god: false });
  assert.ok(r.maxWave >= 3, `reached wave ${r.maxWave}`);
});

test('soak: god-mode bot into the late waves (bosses, big crowds, caps)', () => {
  const r = soak({ seed: 2025, steps: 60 * 60 * 9, smart: true, god: true });
  assert.ok(r.maxWave >= 11, `reached wave ${r.maxWave}`);
});

test('soak: garbage input is tolerated', () => {
  const g = createGame(5);
  const inputs = [
    null,
    undefined,
    {},
    { moveX: NaN, moveY: Infinity, aimX: -Infinity, aimY: NaN, fire: 'yes', dash: 1, blow: {}, switchTo: 'plasma', cycle: 7 },
    { moveX: 5, moveY: -5, aimX: 1e9, aimY: -1e9, fire: true, cycle: -3 },
    { aimX: 800, aimY: 450 }, // aim exactly at the player
  ];
  for (let i = 0; i < 3000; i++) {
    g.player.hp = g.player.maxHp;
    if (g.phase === 'upgrade') applyUpgrade(g, g.upgradeChoices[0].id);
    update(g, inputs[i % inputs.length], STEP);
    if (i % 10 === 0) checkState(g, `garbage step ${i}`);
  }
  update(g, null, NaN);
  update(g, null, -1);
  update(g, null, 10);
  checkState(g, 'bad dt');
});

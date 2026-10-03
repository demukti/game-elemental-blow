import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, update, applyUpgrade, elementMultiplier, spawnEnemy } from '../src/sim.js';
import { ARENA, ELEMENTS, BEATS, UPGRADES, WAVE } from '../src/config.js';
import { IDLE, STEP } from './helpers.js';

/** A game with the wave director switched off: an empty arena to stage scenarios in. */
function arena(seed = 1) {
  const g = createGame(seed);
  g._queue = [];
  g.waveInfo.countdown = 0;
  g._waveActive = false;
  return g;
}

function step(g, input = IDLE, n = 1) {
  const events = [];
  for (let i = 0; i < n; i++) {
    update(g, input, STEP);
    events.push(...g.events);
  }
  return events;
}

const aimAt = (g, x, y, extra = {}) => ({ ...IDLE, aimX: x, aimY: y, ...extra });
const neutralTarget = (el) => ELEMENTS.find((t) => elementMultiplier(el, t) === 1);

test('element multiplier table (water > fire > air > earth > water)', () => {
  const expected = {
    fire: { fire: 0.5, water: 0.5, earth: 1, air: 2 },
    water: { fire: 2, water: 0.5, earth: 0.5, air: 1 },
    earth: { fire: 1, water: 2, earth: 0.5, air: 0.5 },
    air: { fire: 0.5, water: 1, earth: 2, air: 0.5 },
  };
  for (const a of ELEMENTS) {
    for (const t of ELEMENTS) {
      assert.equal(elementMultiplier(a, t), expected[a][t], `${a} -> ${t}`);
    }
  }
  for (const [a, b] of Object.entries(BEATS)) assert.equal(elementMultiplier(a, b), 2);
});

test('createGame exposes the contracted state shape', () => {
  const g = createGame(42);
  assert.equal(g.phase, 'playing');
  assert.equal(g.wave, 1);
  for (const k of ['time', 'score', 'combo', 'comboTimer', 'kills']) assert.equal(typeof g[k], 'number', k);
  assert.ok(g.combo >= 1);
  assert.ok(g.waveInfo.countdown > 0, 'wave 1 is about to start');
  assert.ok(g.waveInfo.total > 0 && g.waveInfo.remaining === g.waveInfo.total);
  assert.equal(g.waveInfo.isBoss, false);
  const p = g.player;
  for (const k of ['x', 'y', 'r', 'hp', 'maxHp', 'angle', 'vx', 'vy', 'dashCd', 'dashCdMax', 'dashing', 'invuln', 'blow', 'hitFlash']) {
    assert.equal(typeof p[k], 'number', `player.${k}`);
  }
  assert.ok(ELEMENTS.includes(p.element));
  assert.deepEqual(Object.keys(p.cooldowns).sort(), [...ELEMENTS].sort());
  assert.ok(Array.isArray(p.upgrades));
  for (const k of ['enemies', 'projectiles', 'effects', 'pickups', 'upgradeChoices', 'events']) assert.ok(Array.isArray(g[k]), k);
});

test('wave 1 is a handful of grunts', () => {
  const g = createGame(5);
  assert.ok(g._queue.length >= 3 && g._queue.length <= 5);
  assert.ok(g._queue.every((q) => q.type === 'grunt'));
});

test('update clears events each step and is a no-op outside phase playing', () => {
  const g = arena();
  step(g, { ...IDLE, switchTo: 'water' });
  assert.ok(g.events.some((e) => e.type === 'switch' && e.element === 'water'));
  step(g);
  assert.equal(g.events.length, 0);
  g.phase = 'upgrade';
  const t = g.time;
  update(g, { ...IDLE, fire: true }, STEP);
  assert.equal(g.time, t);
  assert.equal(g.events.length, 0);
});

for (const el of ELEMENTS) {
  test(`${el} blow damages an enemy`, () => {
    const g = arena(11);
    const p = g.player;
    const target = neutralTarget(el);
    const dist = el === 'earth' ? 60 : 180;
    const e = spawnEnemy(g, 'brute', target, p.x + dist, p.y, { instant: true });
    e._chargeCd = 999; // keep it still for the test
    g.player.element = el;
    const hp0 = e.hp;
    const events = [];
    for (let i = 0; i < 60 && !events.some((ev) => ev.type === 'hit'); i++) {
      events.push(...step(g, aimAt(g, e.x, e.y, { fire: true })));
    }
    const hit = events.find((ev) => ev.type === 'hit');
    assert.ok(hit, 'a hit event is emitted');
    assert.equal(hit.element, el);
    assert.equal(hit.mult, 1);
    assert.ok(e.hp < hp0, 'enemy lost HP');
    assert.ok(events.some((ev) => ev.type === 'shoot' && ev.element === el));
    if (el === 'fire') {
      assert.ok(events.some((ev) => ev.type === 'explosion'));
      assert.ok(e.burn > 0, 'fire applies burn');
      const burnHp = e.hp;
      step(g, IDLE, 40);
      assert.ok(e.hp < burnHp, 'burn deals damage over time');
    }
    if (el === 'water') assert.ok(e.slow > 0, 'water slows');
    if (el === 'earth') {
      assert.ok(e.stun > 0, 'earth stuns');
      assert.ok(events.some((ev) => ev.type === 'slam'));
    }
  });
}

test('each blow has its own cooldown and they differ', () => {
  const g = arena();
  const cds = {};
  for (const el of ELEMENTS) {
    g.player.element = el;
    step(g, aimAt(g, 1500, 450, { fire: true }));
    assert.equal(g.player.cooldowns[el], 1, `${el} cooldown starts full`);
    for (const other of ELEMENTS) if (other !== el) assert.ok(g.player.cooldowns[other] < 1);
    let n = 0;
    while (g.player.cooldowns[el] > 0 && n < 600) {
      step(g);
      n++;
    }
    cds[el] = n;
  }
  assert.equal(new Set(Object.values(cds)).size, 4, `distinct cooldowns: ${JSON.stringify(cds)}`);
  assert.ok(cds.air < cds.fire && cds.fire < cds.earth, 'air is the fastest, earth the slowest');
});

test('air fires a 3-dart spread', () => {
  const g = arena();
  g.player.element = 'air';
  step(g, aimAt(g, 1500, 450, { fire: true }));
  const darts = g.projectiles.filter((p) => p.kind === 'dart');
  assert.equal(darts.length, 3);
  assert.equal(new Set(darts.map((d) => d.angle.toFixed(3))).size, 3);
});

test('water wave pierces several enemies and knocks them back', () => {
  const g = arena();
  const p = g.player;
  g.player.element = 'water';
  const es = [0, 1, 2].map((i) => spawnEnemy(g, 'grunt', 'air', p.x + 120 + i * 40, p.y, { instant: true }));
  const xs = es.map((e) => e.x);
  const events = step(g, aimAt(g, 1500, p.y, { fire: true }), 45);
  const hitIds = new Set(events.filter((e) => e.type === 'hit').map((e) => e.enemyId));
  assert.ok(hitIds.size >= 2, `pierced ${hitIds.size}`);
  assert.ok(es.some((e, i) => e.x > xs[i] + 5), 'knocked back');
});

test('super-effective hits deal double, resisted hits half', () => {
  const dmgFor = (target) => {
    const g = arena(3);
    const p = g.player;
    const e = spawnEnemy(g, 'brute', target, p.x + 150, p.y, { instant: true });
    e._chargeCd = 999;
    g.player.element = 'fire';
    for (let i = 0; i < 60; i++) {
      const ev = step(g, aimAt(g, e.x, e.y, { fire: true })).find((x) => x.type === 'hit' && !x.dot);
      if (ev) return ev;
    }
    return null;
  };
  const strong = dmgFor('air');
  const neutral = dmgFor('earth');
  const weak = dmgFor('water');
  assert.equal(strong.mult, 2);
  assert.equal(neutral.mult, 1);
  assert.equal(weak.mult, 0.5);
  assert.ok(Math.abs(strong.dmg - neutral.dmg * 2) <= 1);
  assert.ok(Math.abs(weak.dmg - neutral.dmg / 2) <= 1);
});

test('kills score with a combo multiplier that grows and decays', () => {
  const g = arena();
  const p = g.player;
  g.player.element = 'earth';
  for (let i = 0; i < 5; i++) {
    const e = spawnEnemy(g, 'swarm', 'water', p.x + 50, p.y + (i - 2) * 14, { instant: true });
    e.hp = 1;
  }
  const events = step(g, aimAt(g, p.x + 100, p.y, { fire: true }), 3);
  const dies = events.filter((e) => e.type === 'enemyDie');
  assert.equal(dies.length, 5);
  assert.ok(dies.every((d) => d.superEffective && d.enemyType === 'swarm' && d.score > 0));
  assert.equal(g.kills, 5);
  assert.ok(g.combo > 1, `combo ${g.combo}`);
  assert.ok(g.comboTimer > 0.9);
  assert.ok(dies[4].score >= dies[0].score, 'later kills in a chain score more');
  step(g, IDLE, 60 * 6);
  assert.equal(g.combo, 1);
  assert.equal(g.comboTimer, 0);
});

test('dash moves fast, grants i-frames and has a cooldown', () => {
  const g = arena();
  const x0 = g.player.x;
  const ev = step(g, { ...IDLE, moveX: 1, dash: true });
  assert.ok(ev.some((e) => e.type === 'dash'));
  assert.ok(g.player.dashing > 0 && g.player.invuln > 0);
  assert.ok(g.player.dashCd > 0 && g.player.dashCd === g.player.dashCdMax);
  step(g, { ...IDLE, moveX: 1 }, 9);
  assert.ok(g.player.x - x0 > 120, `dashed ${g.player.x - x0}px`);
  const again = step(g, { ...IDLE, moveX: 1, dash: true });
  assert.ok(!again.some((e) => e.type === 'dash'), 'cooldown blocks a second dash');
  // i-frames: an enemy bolt passes through a dashing player
  const g2 = arena();
  const p = g2.player;
  step(g2, { ...IDLE, moveX: 1, dash: true });
  g2.projectiles.push({ id: 9999, owner: 'enemy', kind: 'bolt', element: 'fire', x: p.x, y: p.y, vx: 0, vy: 0, r: 7, angle: 0, life: 1, maxLife: 1, _dmg: 50, _dead: false });
  const hpBefore = p.hp;
  step(g2);
  assert.equal(p.hp, hpBefore);
});

test('Blow ultimate: denied until full, then a damaging nova', () => {
  const g = arena();
  const p = g.player;
  let ev = step(g, { ...IDLE, blow: true });
  assert.ok(ev.some((e) => e.type === 'denied'));
  const near = spawnEnemy(g, 'brute', 'air', p.x + 150, p.y, { instant: true });
  const far = spawnEnemy(g, 'brute', 'air', p.x + 600, p.y, { instant: true });
  const nearHp = near.hp;
  const farHp = far.hp;
  p.blow = 99.9;
  // filling the meter fires blowReady once
  g._mods.blowRate = 100;
  p.element = 'water';
  ev = [];
  for (let i = 0; i < 120 && !ev.some((e) => e.type === 'blowReady'); i++) ev.push(...step(g, aimAt(g, near.x, near.y, { fire: true })));
  assert.ok(ev.some((e) => e.type === 'blowReady'));
  assert.equal(p.blow, 100);
  g._mods.blowRate = 1;
  g.projectiles.length = 0;
  near.hp = near.maxHp = 5000; // survive the nova (kills would refill the meter a little)
  p.element = 'fire';
  const hpMid = near.hp;
  ev = step(g, { ...IDLE, blow: true });
  const b = ev.find((e) => e.type === 'blow');
  assert.ok(b && b.element === 'fire' && b.r > 100);
  assert.equal(p.blow, 0);
  assert.ok(near.hp < hpMid, 'nova damages enemies in range');
  assert.ok(near.hp < near.maxHp && nearHp > 0);
  assert.equal(far.hp, farHp, 'out of range enemies are untouched');
  assert.ok(near.burn > 0, 'a fire nova burns');
  assert.ok(g.effects.some((f) => f.kind === 'nova'));
});

test('pickups are collected and heal / charge', () => {
  const g = arena();
  const p = g.player;
  p.hp = 50;
  g.pickups.push({ id: 1, kind: 'heal', x: p.x + 40, y: p.y, r: 10, life: 5, maxLife: 10, vx: 0, vy: 0, _dead: false });
  g.pickups.push({ id: 2, kind: 'blow', x: p.x - 40, y: p.y, r: 10, life: 5, maxLife: 10, vx: 0, vy: 0, _dead: false });
  const ev = step(g, IDLE, 30);
  assert.equal(ev.filter((e) => e.type === 'pickup').length, 2);
  assert.ok(p.hp > 50);
  assert.ok(p.blow > 0);
  assert.equal(g.pickups.length, 0);
  // and they expire
  g.pickups.push({ id: 3, kind: 'heal', x: 100, y: 100, r: 10, life: 0.5, maxLife: 10, vx: 0, vy: 0, _dead: false });
  step(g, IDLE, 40);
  assert.equal(g.pickups.length, 0);
});

test('enemies separate instead of stacking and stay inside the arena', () => {
  const g = arena();
  for (let i = 0; i < 30; i++) spawnEnemy(g, i % 3 ? 'grunt' : 'swarm', 'fire', 30, 30, { instant: true });
  g.player.x = 1500;
  g.player.y = 800;
  step(g, IDLE, 90);
  let worst = 0;
  for (let i = 0; i < g.enemies.length; i++) {
    for (let j = i + 1; j < g.enemies.length; j++) {
      const a = g.enemies[i];
      const b = g.enemies[j];
      const ov = (a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y)) / Math.min(a.r, b.r);
      worst = Math.max(worst, ov);
    }
  }
  assert.ok(worst < 0.6, `worst overlap ${worst.toFixed(2)} radii`);
  for (const e of g.enemies) {
    assert.ok(e.x >= e.r && e.x <= ARENA.w - e.r && e.y >= e.r && e.y <= ARENA.h - e.r);
  }
});

test('spitters keep distance and shoot; brutes telegraph then charge', () => {
  const g = arena(9);
  const p = g.player;
  const s = spawnEnemy(g, 'spitter', 'fire', p.x + 120, p.y, { instant: true });
  const b = spawnEnemy(g, 'brute', 'water', p.x - 300, p.y, { instant: true });
  b._chargeCd = 0;
  let sawTelegraph = false;
  let sawTelegraphEffect = false;
  let sawCharge = false;
  const ev = [];
  for (let i = 0; i < 60 * 5; i++) {
    p.invuln = 1; // keep the player alive and still
    ev.push(...step(g));
    if (b.telegraph > 0) sawTelegraph = true;
    if (g.effects.some((f) => f.kind === 'telegraph')) sawTelegraphEffect = true;
    if (b._ai === 'charge') sawCharge = true;
  }
  assert.ok(ev.some((e) => e.type === 'enemyShoot' && e.element === 'fire'));
  assert.ok(g.projectiles.some((pr) => pr.owner === 'enemy' && pr.kind === 'bolt') || ev.some((e) => e.type === 'enemyShoot'));
  assert.ok(Math.hypot(s.x - p.x, s.y - p.y) > 200, 'spitter backed off');
  assert.ok(sawTelegraph && sawTelegraphEffect && sawCharge);
});

test('upgrades: three distinct choices, every upgrade applies and stacks', () => {
  assert.ok(UPGRADES.length >= 12);
  assert.equal(new Set(UPGRADES.map((u) => u.id)).size, UPGRADES.length);
  for (const u of UPGRADES) {
    const g = arena(4);
    g.phase = 'upgrade';
    const snap = (s) => JSON.stringify({ maxHp: s.player.maxHp, hp: s.player.hp, dash: s.player.dashCdMax, mods: s._mods });
    g.player.hp = 50;
    const before = snap(g);
    assert.equal(applyUpgrade(g, u.id), true, u.id);
    assert.notEqual(snap(g), before, `${u.id} changes something`);
    assert.equal(g.phase, 'playing');
    assert.equal(g.wave, 2);
    assert.equal(g.waveInfo.countdown, WAVE.countdown);
    assert.ok(g.events.some((e) => e.type === 'upgrade' && e.id === u.id));
    assert.deepEqual(g.player.upgrades.find((x) => x.id === u.id), { id: u.id, name: u.name, count: 1 });
    g.phase = 'upgrade';
    applyUpgrade(g, u.id);
    assert.equal(g.player.upgrades.find((x) => x.id === u.id).count, 2, `${u.id} stacks`);
  }
  // rejected outside the upgrade phase / unknown ids
  const g = arena();
  assert.equal(applyUpgrade(g, 'vitality'), false);
  g.phase = 'upgrade';
  assert.equal(applyUpgrade(g, 'nope'), false);
  assert.equal(g.phase, 'upgrade');
});

test('upgrades change gameplay numbers', () => {
  const g = arena();
  g.phase = 'upgrade';
  applyUpgrade(g, 'vitality');
  assert.equal(g.player.maxHp, 125);
  g.phase = 'upgrade';
  applyUpgrade(g, 'gale');
  g.waveInfo.countdown = 0;
  g._queue = [];
  g.player.element = 'air';
  step(g, aimAt(g, 1500, 450, { fire: true }));
  assert.equal(g.projectiles.filter((p) => p.kind === 'dart').length, 4);

  const run = (ups) => {
    const h = arena();
    for (const id of ups) {
      h.phase = 'upgrade';
      applyUpgrade(h, id);
    }
    h.waveInfo.countdown = 0;
    h._queue = [];
    const x0 = h.player.x;
    step(h, { ...IDLE, moveX: 1 }, 30);
    return h.player.x - x0;
  };
  assert.ok(run(['swift', 'swift']) > run([]) * 1.1, 'swift makes you faster');

  const d = arena();
  d.phase = 'upgrade';
  applyUpgrade(d, 'phasestep');
  assert.ok(d.player.dashCdMax < 1.1);
});

test('like resists like: an enemy of the player\'s current element deals half damage', () => {
  const taken = (playerEl, bolt) => {
    const g = arena();
    const p = g.player;
    p.element = playerEl;
    if (bolt) {
      g.projectiles.push({
        id: 9001, owner: 'enemy', kind: 'bolt', element: 'earth', x: p.x + 60, y: p.y, vx: -300, vy: 0,
        r: 7, angle: Math.PI, life: 4, _dmg: 10, _dead: false,
      });
    } else {
      spawnEnemy(g, 'grunt', 'earth', p.x + 20, p.y, { instant: true });
    }
    const ev = step(g, IDLE, 120).find((x) => x.type === 'playerHit');
    assert.ok(ev, 'player was hit');
    assert.equal(ev.resisted, playerEl === 'earth');
    return g.stats.damageTaken;
  };
  for (const bolt of [false, true]) {
    const same = taken('earth', bolt);
    for (const other of ['fire', 'water', 'air']) {
      assert.ok(Math.abs(same - taken(other, bolt) / 2) < 1e-9, `earth vs ${other}, bolt=${bolt}`);
    }
  }
});

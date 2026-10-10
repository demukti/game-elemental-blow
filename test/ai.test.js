import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, update, spawnEnemy, random } from '../src/sim.js';
import { PLAYER, ENEMIES, ULT } from '../src/config.js';
import { IDLE, STEP, botInput, nearestEnemy } from './helpers.js';
import * as bot from '../src/bot.js';

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

test('grunts lunge when close: a directional lunge telegraph, then a speed burst (not on wave 1)', () => {
  const run = (wave) => {
    const g = arena(3);
    g.wave = wave;
    const p = g.player;
    const e = spawnEnemy(g, 'grunt', 'water', p.x + 70, p.y, { instant: true });
    e._lungeCd = 0;
    let sawWind = false;
    let sawLunge = false;
    let topSpeed = 0;
    let maxTelegraph = 0;
    for (let i = 0; i < 90; i++) {
      p.invuln = 1;
      step(g);
      if (e.telegraphKind === 'lunge') {
        sawWind = true;
        assert.ok(e.telegraph >= 0 && e.telegraph <= 1 && e.telegraph === e.windup, 'lunge is a directional wind-up');
        maxTelegraph = Math.max(maxTelegraph, e.telegraph);
      }
      if (e._ai === 'lunge') sawLunge = true;
      topSpeed = Math.max(topSpeed, Math.hypot(e._mx, e._my));
    }
    return { sawWind, sawLunge, topSpeed, maxTelegraph, e };
  };
  const w2 = run(2);
  assert.ok(w2.sawWind && w2.sawLunge, 'wave 2 grunt lunges');
  assert.ok(w2.maxTelegraph > 0.5, 'telegraph progressed during the wind-up');
  assert.ok(w2.topSpeed > w2.e._speed * 2, `lunge is a burst (${w2.topSpeed.toFixed(0)} px/s)`);
  assert.equal(w2.e.telegraphKind, null, 'wind-up cleared afterwards');
  const w1 = run(1);
  assert.ok(!w1.sawWind && !w1.sawLunge, 'wave 1 grunts never lunge');
});

test('grunts flank: a group approaches from spread-out angles instead of one line', () => {
  const g = arena(5);
  const p = g.player;
  p.x = 1300;
  p.y = 450;
  const es = [];
  for (let i = 0; i < 6; i++) es.push(spawnEnemy(g, 'grunt', 'water', 200, 440 + i * 4, { instant: true }));
  const flanks = new Set(es.map((e) => e._flank.toFixed(2)));
  assert.equal(flanks.size, es.length, 'every grunt has its own flank offset');
  for (let i = 0; i < 120; i++) {
    p.invuln = 1;
    step(g);
  }
  const ys = es.map((e) => e.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 80, `spread ${Math.max(...ys) - Math.min(...ys)}px after 2 s`);
});

test('swarm packs flock: packmates stay tighter than loose swarms and commit together', () => {
  const spread = (pack) => {
    const g = arena(8);
    const p = g.player;
    p.x = 1400;
    p.y = 800;
    const es = [];
    for (let i = 0; i < 7; i++) {
      const a = random(g) * Math.PI * 2;
      const d = 40 + random(g) * 140;
      es.push(spawnEnemy(g, 'swarm', 'fire', 300 + Math.cos(a) * d, 300 + Math.sin(a) * d, { instant: true, pack }));
    }
    for (let i = 0; i < 150; i++) {
      p.invuln = 1;
      step(g);
    }
    const cx = es.reduce((s, e) => s + e.x, 0) / es.length;
    const cy = es.reduce((s, e) => s + e.y, 0) / es.length;
    return { g, es, spread: es.reduce((s, e) => s + Math.hypot(e.x - cx, e.y - cy), 0) / es.length };
  };
  const loose = spread(0);
  const packed = spread(1);
  assert.ok(packed.es.every((e) => e.pack === 1));
  assert.ok(packed.spread < loose.spread * 0.8, `pack spread ${packed.spread.toFixed(0)} vs loose ${loose.spread.toFixed(0)}`);
  const ps = packed.g._packs[1];
  assert.ok(ps && ['approach', 'orbit', 'dive'].includes(ps.mode), 'pack has a shared commit state');
  // once near the player the pack orbits for a while before diving
  const g = packed.g;
  const modes = new Set();
  for (let i = 0; i < 60 * 6; i++) {
    g.player.invuln = 1;
    step(g);
    if (g._packs[1]) modes.add(g._packs[1].mode);
  }
  assert.ok(modes.has('orbit') && modes.has('dive'), `pack modes seen: ${[...modes]}`);
});

test('spitters lead their shots ahead of a moving player (clamped)', () => {
  const g = arena(9);
  g.wave = 6; // the lead ramps in over the first waves; test it at full strength
  const p = g.player;
  p.x = 500;
  p.y = 200;
  const s = spawnEnemy(g, 'spitter', 'fire', p.x + 320, p.y, { instant: true });
  s._fireT = 0;
  const run = { moveY: 1, aimX: 0, aimY: 200 }; // run straight down, looking away from the spitter
  let bolt = null;
  let px = 0;
  let py = 0;
  for (let i = 0; i < 120 && !bolt; i++) {
    p.invuln = 1;
    step(g, { ...IDLE, ...run });
    bolt = g.projectiles.find((pr) => pr.owner === 'enemy' && pr.kind === 'bolt');
    px = p.x;
    py = p.y;
  }
  assert.ok(bolt, 'spitter fired');
  // the player runs down (+y): the bolt direction has a larger downward component than the direct line
  const d = Math.hypot(px - s.x, py - s.y);
  const directY = (py - s.y) / d;
  const aimedY = bolt.vy / Math.hypot(bolt.vx, bolt.vy);
  assert.ok(aimedY > directY + 0.1, `aims ahead of the player: direct ${directY.toFixed(2)} aimed ${aimedY.toFixed(2)}`);
  // the lead is clamped so the bolt is still dodgeable
  const direct = Math.atan2(py - s.y, px - s.x);
  const aimed = Math.atan2(bolt.vy, bolt.vx);
  const leadPx = Math.abs(Math.tan(aimed - direct)) * d;
  assert.ok(leadPx < ENEMIES.spitter.lead * 1.5, `lead ${leadPx.toFixed(0)} px is clamped`);
});

test('brute shield stance: raised against the counter element at range, halves frontal damage', () => {
  const g = arena(4);
  const p = g.player;
  const b = spawnEnemy(g, 'brute', 'water', p.x + 330, p.y, { instant: true });
  b._chargeCd = 999;
  b._guardCd = 0;
  p.element = 'earth'; // beats water
  let raised = false;
  for (let i = 0; i < 60 && !raised; i++) {
    step(g, aimAt(g, b.x, b.y));
    raised = b.guard > 0;
  }
  assert.ok(raised && b._ai === 'guard', 'brute raised its guard');
  assert.ok(b.guard <= 1);
  // same dart, guarded vs unguarded
  const dmgWith = (guard) => {
    const h = arena(4);
    const q = h.player;
    const t = spawnEnemy(h, 'brute', 'water', q.x + 200, q.y, { instant: true });
    t._chargeCd = 999;
    t._guardCd = 999;
    t.guard = guard;
    t.angle = Math.PI; // facing the player
    q.element = 'air';
    for (let i = 0; i < 60; i++) {
      const ev = step(h, aimAt(h, t.x, t.y, { fire: true })).find((x) => x.type === 'hit' && !x.dot);
      if (ev) return ev;
    }
    return null;
  };
  const open = dmgWith(0);
  const guarded = dmgWith(1);
  assert.ok(open && guarded);
  assert.equal(open.guarded, undefined);
  assert.equal(guarded.guarded, true);
  assert.ok(Math.abs(guarded.dmg - open.dmg / 2) <= 1, `guarded ${guarded.dmg} vs open ${open.dmg}`);
  // the stance ends on its own and goes on cooldown
  step(g, aimAt(g, b.x, b.y), 90);
  assert.equal(b.guard, 0);
  assert.ok(b._guardCd > 0);
});

test('brute charges lead the player and a miss leaves it recovering longer than a hit', () => {
  const g = arena(6);
  const p = g.player;
  p.x = 400;
  p.y = 450;
  const b = spawnEnemy(g, 'brute', 'water', p.x + 300, p.y, { instant: true });
  b._chargeCd = 0;
  for (let i = 0; i < 40 && b._ai !== 'windup'; i++) step(g, { ...IDLE, moveY: 1 });
  assert.equal(b._ai, 'windup');
  for (let i = 0; i < 30 && b._ai === 'windup' && b.windup < 0.6; i++) step(g, { ...IDLE, moveY: 1 });
  assert.ok(b._dirY > 0.05, `charge aims ahead of a player running down (dirY ${b._dirY.toFixed(2)})`);
  // miss: player steps far away, the brute charges into empty space
  p.x = 100;
  p.y = 100;
  while (b._ai !== 'recover') {
    p.invuln = 1;
    step(g);
  }
  const missRecover = b._aiT;
  assert.ok(missRecover > ENEMIES.brute.recover * 1.1, `missed charge recovers ${missRecover.toFixed(2)}s`);
  // hit: the player stands in the lane
  const h = arena(6);
  const q = h.player;
  const c = spawnEnemy(h, 'brute', 'water', q.x + 200, q.y, { instant: true });
  c._chargeCd = 0;
  let hit = false;
  for (let i = 0; i < 240 && c._ai !== 'recover'; i++) {
    step(h);
    if (h.events.some((e) => e.type === 'playerHit')) hit = true;
  }
  assert.ok(hit && c._ai === 'recover');
  assert.ok(c._aiT < ENEMIES.brute.recover, `landed charge recovers ${c._aiT.toFixed(2)}s`);
});

test('dash nicks and shoves enemies it passes through, once per enemy per dash', () => {
  const g = arena();
  const p = g.player;
  p.element = 'water';
  const e = spawnEnemy(g, 'grunt', 'fire', p.x + 70, p.y, { instant: true });
  const hp0 = e.hp;
  const x0 = e.x;
  const ev = step(g, { ...IDLE, moveX: 1, dash: true }, 12);
  const hits = ev.filter((x) => x.type === 'hit' && x.enemyId === e.id);
  assert.equal(hits.length, 1, 'exactly one dash hit');
  assert.equal(hits[0].element, 'water');
  assert.equal(hits[0].mult, 2);
  assert.ok(Math.abs(hp0 - e.hp - PLAYER.dashDamage * 2) < 1e-6, `dash dealt ${hp0 - e.hp}`);
  assert.ok(e.x > x0 + 5 || e._kx > 0, 'enemy shoved');
  assert.deepEqual(p._dashHit, [e.id]);
});

test('perfect dodge: a bolt or a charge that would land during dash i-frames feeds the meter', () => {
  const g = arena();
  const p = g.player;
  step(g, { ...IDLE, moveX: 1, dash: true });
  g.projectiles.push({ id: 9999, owner: 'enemy', kind: 'bolt', element: 'fire', x: p.x, y: p.y, vx: 0, vy: 0, r: 7, angle: 0, life: 1, maxLife: 1, _dmg: 50, _dead: false });
  const blow0 = p.blow;
  const hp0 = p.hp;
  const ev = step(g);
  assert.equal(p.hp, hp0);
  assert.ok(Math.abs(p.blow - blow0 - PLAYER.perfectDodgeBlow) < 1e-9);
  const pd = ev.find((x) => x.type === 'perfectDodge');
  assert.ok(pd && Number.isFinite(pd.x) && Number.isFinite(pd.y));
  assert.ok(!g.projectiles.some((pr) => pr.id === 9999), 'the bolt is consumed');
  // charging brute: dash through it
  const h = arena();
  const q = h.player;
  const b = spawnEnemy(h, 'brute', 'air', q.x + 60, q.y, { instant: true });
  b._ai = 'charge';
  b._aiT = 0.6;
  b._dirX = -1;
  b._dirY = 0;
  const bl = q.blow;
  const ev2 = step(h, { ...IDLE, moveX: 1, dash: true }, 6);
  assert.ok(ev2.some((x) => x.type === 'perfectDodge'));
  assert.ok(q.blow > bl);
  assert.equal(h.stats.damageTaken, 0);
});

test('dash input is buffered for a moment', () => {
  const g = arena();
  const p = g.player;
  step(g, { ...IDLE, moveX: 1, dash: true });
  // wait until just before the cooldown ends, press, then release
  while (p.dashCd > PLAYER.dashBuffer * 0.6) step(g);
  step(g, { ...IDLE, dash: true });
  assert.ok(p._dashBuf > 0 && p.dashing === 0, 'press buffered while on cooldown');
  const ev = step(g, IDLE, 12);
  assert.ok(ev.some((e) => e.type === 'dash'), 'buffered dash fired when the cooldown ended');
  // a press long before the cooldown ends is forgotten
  while (p.dashing > 0) step(g);
  step(g, { ...IDLE, dash: true });
  const late = step(g, IDLE, 60);
  assert.ok(!late.some((e) => e.type === 'dash'));
});

test('blow surge: holding the meter full accrues blowSurge, boosts speed and the nova; nova rush follows', () => {
  const g = arena();
  const p = g.player;
  assert.equal(p.blowSurge, 0);
  p.blow = 100;
  step(g, IDLE, 300); // 5 s
  assert.ok(Math.abs(p.blowSurge - 5 / PLAYER.surgeCapTime) < 0.01, `surge ${p.blowSurge}`);
  const fast = step(g, { ...IDLE, moveX: 1 }, 60);
  const xs = g.player.x;
  const h = arena();
  step(h, { ...IDLE, moveX: 1 }, 60);
  assert.ok(xs > h.player.x + 5, 'surging player is faster');
  assert.ok(fast.length >= 0);
  step(g, IDLE, 60 * 20);
  assert.equal(p.blowSurge, 1, 'capped');
  // nova damage scales with the surge
  const novaDmg = (surgeSeconds) => {
    const a = arena(2);
    const q = a.player;
    const t = spawnEnemy(a, 'brute', 'earth', q.x + 100, q.y, { instant: true });
    t.hp = t.maxHp = 1e6;
    t._chargeCd = 999;
    q.blow = 100;
    q.invuln = 100; // the brute walks into the player while we wait
    step(a, IDLE, Math.round(surgeSeconds * 60));
    const ev = step(a, { ...IDLE, blow: true }).find((x) => x.type === 'hit');
    return { dmg: ev.dmg, a };
  };
  const base = novaDmg(0).dmg;
  const r = novaDmg(PLAYER.surgeCapTime + 1);
  assert.ok(Math.abs(r.dmg - base * (1 + ULT.surgeBonus)) <= 2, `nova ${r.dmg} vs ${base}`);
  assert.equal(r.a.player.blowSurge, 0, 'surge resets after the nova');
  assert.ok(r.a.player.novaRush > 0 && r.a.player.novaRush <= PLAYER.novaRush);
  // nova rush: cooldowns tick faster for a moment
  const q = r.a.player;
  q.element = 'earth';
  q.cooldowns.earth = 1;
  step(r.a, IDLE, 30);
  const rushed = q.cooldowns.earth;
  const c = arena(2);
  c.player.cooldowns.earth = 1;
  step(c, IDLE, 30);
  assert.ok(rushed < c.player.cooldowns.earth - 0.02, `rushed ${rushed} vs ${c.player.cooldowns.earth}`);
});

test('a fire nova spreads burn to enemies next to a burning victim; survivors scatter', () => {
  const g = arena();
  const p = g.player;
  p.element = 'fire';
  p.blow = 100;
  const inRange = spawnEnemy(g, 'brute', 'earth', p.x + ULT.radius, p.y, { instant: true });
  const neighbour = spawnEnemy(g, 'brute', 'earth', p.x + ULT.radius + 110, p.y, { instant: true }); // outside the nova
  const far = spawnEnemy(g, 'brute', 'earth', p.x + ULT.radius + 400, p.y, { instant: true });
  for (const e of [inRange, neighbour, far]) {
    e.hp = e.maxHp = 1e6;
    e._chargeCd = 999;
  }
  step(g, { ...IDLE, blow: true });
  assert.ok(inRange.burn > 0);
  assert.ok(neighbour.burn > 0, 'burn jumped to the neighbour outside the nova');
  assert.equal(far.burn, 0);
  assert.ok(inRange._fleeT > 0 && neighbour._fleeT > 0 && far._fleeT === 0, 'nearby survivors flee');
});

test('a 3-kill burst scatters the survivors for a moment', () => {
  const g = arena();
  const p = g.player;
  p.element = 'earth';
  for (let i = 0; i < 3; i++) {
    const e = spawnEnemy(g, 'swarm', 'water', p.x + 50, p.y + (i - 1) * 14, { instant: true });
    e.hp = 1;
  }
  const survivor = spawnEnemy(g, 'grunt', 'fire', p.x + 220, p.y, { instant: true });
  step(g, aimAt(g, p.x + 100, p.y, { fire: true }), 2);
  assert.equal(g.kills, 3);
  assert.ok(survivor._fleeT > 0, 'survivor scatters');
  const d0 = Math.hypot(survivor.x - p.x, survivor.y - p.y);
  step(g, IDLE, 20);
  assert.ok(Math.hypot(survivor.x - p.x, survivor.y - p.y) > d0 + 10, 'it backs off');
  step(g, IDLE, 60);
  assert.equal(survivor._fleeT, 0, 'and then returns');
});

test('the bot module exists and the test helpers re-export it', () => {
  assert.equal(typeof bot.botInput, 'function');
  assert.equal(typeof bot.nearestEnemy, 'function');
  assert.equal(botInput, bot.botInput);
  assert.equal(nearestEnemy, bot.nearestEnemy);
  const g = createGame(1);
  const inp = botInput(g, { smart: true });
  for (const k of ['moveX', 'moveY', 'aimX', 'aimY']) assert.equal(typeof inp[k], 'number');
  assert.equal(nearestEnemy(g), null);
});

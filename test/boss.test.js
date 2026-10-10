import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGame, update, spawnEnemy } from '../src/sim.js';
import { BOSS, CAPS, ELEMENTS, PLAYER } from '../src/config.js';
import { IDLE, STEP, botInput, findNonFinite } from './helpers.js';

const SIGNATURE = { fire: 'meteor', water: 'tide', earth: 'quake', air: 'gale' };
const SIG_KINDS = ['meteor', 'tide', 'quake', 'gale'];

/** A boss wave arena with the wave director switched off: the boss (and whatever it spawns) is all there is. */
function bossArena(el, { seed = 11, wave = 5, instant = true, bx = 800, by = 300, px = 800, py = 650 } = {}) {
  const g = createGame(seed);
  g._queue = [];
  g.waveInfo.countdown = 0;
  g._waveActive = false;
  g.wave = wave;
  g.waveInfo.isBoss = true;
  const p = g.player;
  p.x = px;
  p.y = py;
  p.vx = 0;
  p.vy = 0;
  const b = spawnEnemy(g, 'boss', el, bx, by, { instant });
  return { g, b, p };
}

const boss = (g) => g.enemies.find((e) => e.type === 'boss');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Step with god-mode HP until pred(g, events) holds (or maxSteps); returns every event seen. */
function run(g, pred, maxSteps, input = () => IDLE) {
  const all = [];
  for (let i = 0; i < maxSteps; i++) {
    g.player.hp = g.player.maxHp;
    update(g, input(g, i), STEP);
    all.push(...g.events);
    if (pred(g, g.events, all)) break;
  }
  return all;
}

const sawDamage = (events) => events.some((e) => e.type === 'playerHit');

test('every element has a signature: the first pattern of a first boss, telegraphed before any damage', () => {
  for (const el of ELEMENTS) {
    const { g, b } = bossArena(el);
    const ev = run(g, (s, e) => e.some((x) => x.type === 'bossAttack' && x.kind === SIGNATURE[el]), 60 * 6);
    const start = ev.find((x) => x.type === 'bossAttack' && x.kind === SIGNATURE[el]);
    assert.ok(start, `${el}: signature ${SIGNATURE[el]} is the opening pattern`);
    assert.deepEqual(Object.keys(start).sort(), ['element', 'kind', 'type', 'x', 'y'].sort());
    assert.equal(start.element, el);
    assert.ok(!sawDamage(ev), `${el}: no damage before the pattern starts`);
    assert.equal(b._ai, 'sigWind');
    assert.equal(b.telegraphKind, SIGNATURE[el]);
    assert.ok(g.effects.some((f) => f.kind === 'telegraph' || f.kind === 'tidewarn'), `${el}: a telegraph effect is up`);
    const tele = g.effects.find((f) => f._follow === b.id);
    assert.ok(tele && tele.maxLife >= 0.6, `${el}: wind-up lasts at least 0.6 s (${tele && tele.maxLife})`);
    // the wind-up itself hurts nobody
    const wind = run(g, (s) => s.enemies.find((e) => e.type === 'boss')._ai !== 'sigWind', 60 * 3);
    assert.ok(!sawDamage(wind), `${el}: nothing lands during the wind-up`);
    if (el === 'water') assert.equal(b.telegraph, b.windup === 0 ? 0 : b.telegraph, 'tide is a directional wind-up');
    else assert.equal(wind.length >= 0 && b.telegraph, 0, `${el}: area wind-up keeps telegraph at 0`);
  }
});

test('fire boss: meteor rain lands on a standing player, leaves a burning patch, and a dash through the impact is a perfect dodge', () => {
  const landed = (dash) => {
    const { g, p } = bossArena('fire');
    run(g, (s) => s.effects.some((f) => f.kind === 'meteor'), 60 * 6);
    const ms = g.effects.filter((f) => f.kind === 'meteor');
    assert.ok(ms.length >= BOSS.meteor.count && ms.length <= BOSS.meteor.countMax, `meteor count ${ms.length}`);
    for (const m of ms) assert.ok(m._hazard && m.r === BOSS.meteor.radius && m.maxLife >= BOSS.meteor.fuse);
    // the first meteor is aimed at where the (standing) player will be
    assert.ok(dist(ms[0], p) < 5, 'first meteor targets the player');
    const target = ms[0];
    let dashed = false;
    const ev = run(g, (s) => !s.effects.includes(target), 60 * 3, (s) => {
      if (dash && !dashed && target.life <= 0.05) {
        dashed = true;
        return { ...IDLE, dash: true, aimX: p.x + 10, aimY: p.y };
      }
      return IDLE;
    });
    return { g, ev, dashed };
  };
  const hit = landed(false);
  assert.ok(sawDamage(hit.ev), 'a standing player is hit by the meteor');
  assert.ok(hit.ev.some((e) => e.type === 'shock' && e.kind === 'meteor' && e.power === BOSS.meteor.shock && e.element === 'fire'));
  assert.ok(hit.ev.some((e) => e.type === 'explosion' && e.element === 'fire'));
  const patches = hit.g.effects.filter((f) => f.kind === 'burnpatch');
  assert.ok(patches.length >= 1, 'burning patches are left behind');
  // standing in the fire keeps hurting (ticks are paced by the hit invulnerability)
  const more = run(hit.g, () => false, Math.round(60 * BOSS.meteor.burnLife));
  assert.ok(more.filter((e) => e.type === 'playerHit').length >= 1, 'the burning patch ticks on a player standing in it');
  const dodged = landed(true);
  assert.ok(dodged.dashed, 'dash was triggered');
  assert.ok(!dodged.ev.some((e) => e.type === 'playerHit'), 'dash i-frames beat the impact');
  assert.ok(dodged.ev.some((e) => e.type === 'perfectDodge'), 'a meteor dodged inside its circle is a perfect dodge');
});

test('winded: after a signature pattern the boss stands still, takes 1.5x damage and hits carry winded:true', () => {
  const { g, b, p } = bossArena('fire');
  run(g, (s, e) => e.some((x) => x.type === 'bossAttack' && x.kind === 'winded'), 60 * 6);
  assert.equal(b._ai, 'winded');
  assert.ok(b.winded > 0 && b.winded <= BOSS.winded, `winded window ${b.winded}`);
  assert.equal(b._mx, 0);
  const x0 = b.x;
  // water (counter) wave from 160 px: base 20 x2 = 40, winded x1.5 = 60
  p.x = b.x;
  p.y = b.y + 160;
  const aim = () => ({ ...IDLE, aimX: b.x, aimY: b.y, fire: true, switchTo: 'water' });
  const ev1 = run(g, (s, e) => e.some((x) => x.type === 'hit' && x.enemyId === b.id), 60 * 2, aim);
  const h1 = ev1.find((x) => x.type === 'hit' && x.enemyId === b.id);
  assert.ok(h1 && h1.winded === true, 'hit during the window is flagged');
  assert.equal(h1.dmg, 60);
  assert.equal(b.x, x0, 'the boss does not move while winded');
  run(g, (s) => b.winded <= 0 && b._ai !== 'winded', 60 * 3, aim);
  const ev2 = run(g, (s, e) => e.some((x) => x.type === 'hit' && x.enemyId === b.id), 60 * 3, aim);
  const h2 = ev2.find((x) => x.type === 'hit' && x.enemyId === b.id);
  assert.ok(h2 && !h2.winded, 'later hits are not flagged');
  assert.equal(h2.dmg, 40);
});

test('water boss: the tide sweeps a standing player, spares one in the gap, and a dash through a wall is a perfect dodge', () => {
  const setup = () => {
    const { g, b, p } = bossArena('water');
    run(g, (s) => s.effects.some((f) => f.kind === 'tidewarn'), 60 * 6);
    const warn = g.effects.find((f) => f.kind === 'tidewarn');
    assert.ok(warn && Number.isFinite(warn._off) && warn._gap === BOSS.tide.gap && warn.maxLife >= 0.6);
    const launch = run(g, (s) => s.projectiles.some((pr) => pr.kind === 'tide'), 60 * 3);
    assert.ok(launch.some((e) => e.type === 'shock' && e.kind === 'roar' && e.power === BOSS.tide.shock), 'tide launch roars');
    const walls = g.projectiles.filter((pr) => pr.kind === 'tide');
    assert.equal(walls.length, 2, 'two walls with a gap between them');
    for (const w of walls) assert.ok(w.owner === 'enemy' && w._half === BOSS.tide.half && w.element === 'water');
    return { g, b, p, warn, walls };
  };
  // standing on the aim line: one wall is centred on the player
  const a = setup();
  const evA = run(a.g, (s) => !s.projectiles.some((pr) => pr.kind === 'tide'), 60 * 6);
  assert.ok(sawDamage(evA), 'a standing player is swept');
  assert.equal(evA.filter((e) => e.type === 'playerHit').length, 1, 'each wall hits once');
  // in the gap: safe
  const bb = setup();
  const ang = bb.warn.angle;
  const perpX = -Math.sin(ang);
  const perpY = Math.cos(ang);
  bb.p.x = bb.b.x + Math.cos(ang) * 350 + perpX * bb.warn._off;
  bb.p.y = bb.b.y + Math.sin(ang) * 350 + perpY * bb.warn._off;
  const evB = run(bb.g, (s) => !s.projectiles.some((pr) => pr.kind === 'tide'), 60 * 6);
  assert.ok(!sawDamage(evB), 'the gap is safe');
  // dash through the wall as it arrives
  const c = setup();
  let dashed = false;
  const evC = run(c.g, (s) => !s.projectiles.some((pr) => pr.kind === 'tide'), 60 * 6, (s) => {
    const w = s.projectiles.find((pr) => pr.kind === 'tide' && !pr._hitP);
    if (!dashed && w) {
      const along = (c.p.x - w.x) * Math.cos(w.angle) + (c.p.y - w.y) * Math.sin(w.angle);
      if (along < 70 && along > 0) {
        dashed = true;
        return { ...IDLE, dash: true, aimX: c.b.x, aimY: c.b.y };
      }
    }
    return IDLE;
  });
  assert.ok(dashed);
  assert.ok(!sawDamage(evC), 'dashing through the wall takes no damage');
  assert.ok(evC.some((e) => e.type === 'perfectDodge'), 'and counts as a perfect dodge');
});

test('earth boss: the quake sends gapped ring hazards and raises pillars; rings hurt on crossing unless dashed through or passed in the gap', () => {
  const setup = () => {
    const { g, b, p } = bossArena('earth');
    const ev = run(g, (s) => s.effects.some((f) => f.kind === 'quakering'), 60 * 6);
    assert.ok(ev.some((e) => e.type === 'shock' && e.kind === 'quake' && e.power === BOSS.quake.shock && e.element === 'earth'));
    assert.ok(ev.some((e) => e.type === 'bossAttack' && e.kind === 'quake'));
    const rings = g.effects.filter((f) => f.kind === 'quakering');
    const pillars = g.effects.filter((f) => f.kind === 'pillar');
    assert.equal(rings.length, BOSS.quake.rings);
    assert.equal(pillars.length, BOSS.quake.pillars);
    for (const r of rings) assert.ok(r._hazard && r._delay >= 0 && r._gapW > 0 && Number.isFinite(r._gapA));
    for (const q of pillars) assert.ok(q._hazard && q.maxLife === BOSS.quake.pillarLife && dist(q, p) > BOSS.quake.pillarClear - 1);
    return { g, b, p, rings, pillars };
  };
  // place the player at `ang` from the first ring's centre, 300 px out, off any pillar
  const place = (p, ring, pillars, ang) => {
    for (const d of [300, 340, 380, 260]) {
      const x = ring.x + Math.cos(ang) * d;
      const y = ring.y + Math.sin(ang) * d;
      if (pillars.every((q) => Math.hypot(q.x - x, q.y - y) > q.r + p.r + 30)) {
        p.x = x;
        p.y = y;
        p.vx = 0;
        p.vy = 0;
        return;
      }
    }
    assert.fail('no pillar-free spot');
  };
  const passed = (ring, p) => !ring._hazard || ring.life <= 0 || ring._R > Math.hypot(p.x - ring.x, p.y - ring.y) + 40;
  // opposite the gap: the first ring hits
  const a = setup();
  place(a.p, a.rings[0], a.pillars, a.rings[0]._gapA + Math.PI);
  const evA = run(a.g, () => passed(a.rings[0], a.p), 60 * 3);
  assert.ok(sawDamage(evA), 'crossing the ring hurts');
  assert.ok(a.rings[0]._hitP);
  // in the gap of the first ring: it passes harmlessly
  const bb = setup();
  place(bb.p, bb.rings[0], bb.pillars, bb.rings[0]._gapA);
  const evB = run(bb.g, () => passed(bb.rings[0], bb.p), 60 * 3);
  assert.ok(!sawDamage(evB), 'the gap is a safe passage');
  // dash through the first ring as it arrives
  const c = setup();
  place(c.p, c.rings[0], c.pillars, c.rings[0]._gapA + Math.PI);
  let dashed = false;
  const evC = run(c.g, () => passed(c.rings[0], c.p), 60 * 3, (s) => {
    const R = c.rings[0]._R;
    if (!dashed && R > 0 && Math.hypot(c.p.x - c.rings[0].x, c.p.y - c.rings[0].y) - R < 60) {
      dashed = true;
      return { ...IDLE, dash: true, aimX: c.rings[0].x, aimY: c.rings[0].y };
    }
    return IDLE;
  });
  assert.ok(dashed);
  assert.ok(!sawDamage(evC), 'dash i-frames beat the ring');
  assert.ok(evC.some((e) => e.type === 'perfectDodge'));
  // pillars hurt on contact once risen
  const d = setup();
  const q = d.pillars[0];
  d.p.x = q.x + q.r + d.p.r - 4;
  d.p.y = q.y;
  const evD = run(d.g, (s, e) => sawDamage(e), 60 * 1);
  assert.ok(sawDamage(evD), 'a pillar hurts on contact');
});

test('air boss: the gale drags the player in while firing bolt pairs; a dash ignores the pull', () => {
  const { g, b, p } = bossArena('air', { py: 700 });
  run(g, (s) => b._ai === 'gale', 60 * 6);
  assert.equal(b._ai, 'gale');
  assert.ok(g.effects.some((f) => f.kind === 'gale' && f._follow === b.id), 'gale effect follows the boss');
  const d0 = dist(b, p);
  let shots = 0;
  run(g, (s, e) => {
    for (const x of e) if (x.type === 'enemyShoot') shots++;
    return b._ai !== 'gale';
  }, 60 * 3);
  const d1 = dist(b, p);
  assert.ok(d1 < d0 - 100, `pulled in: ${d0.toFixed(0)} -> ${d1.toFixed(0)}`);
  assert.ok(shots >= BOSS.gale.pairs, `bolt pairs fired: ${shots}`);
  assert.equal(b._ai, 'winded', 'the gale ends in the weak-point window');
  // a dash ignores the pull: during the dash the knockback velocity only decays
  const g2 = bossArena('air', { py: 700 });
  run(g2.g, (s) => g2.b._ai === 'gale', 60 * 6);
  run(g2.g, () => false, 10);
  update(g2.g, { ...IDLE, dash: true, moveX: 0, moveY: 1 }, STEP);
  assert.ok(g2.p.dashing > 0);
  const k0 = Math.hypot(g2.p._kx, g2.p._ky);
  update(g2.g, IDLE, STEP);
  const k1 = Math.hypot(g2.p._kx, g2.p._ky);
  assert.ok(k1 <= k0 + 1e-9, `no pull while dashing (${k0.toFixed(1)} -> ${k1.toFixed(1)})`);
});

test('phase 3: the boss enrages (flag, roar, event) and chains patterns without the idle gap', () => {
  const { g, b, p } = bossArena('fire', { py: 820 });
  b.hp = b.maxHp * 0.3;
  p.x = b.x;
  p.y = b.y + 160;
  const aim = () => ({ ...IDLE, aimX: b.x, aimY: b.y, fire: true, switchTo: 'air' });
  const ev = run(g, (s, e) => e.some((x) => x.type === 'bossPhase'), 60 * 3, aim);
  assert.ok(b.enraged === true, 'enraged flag');
  assert.equal(b._phase, 2);
  assert.ok(ev.some((e) => e.type === 'bossAttack' && e.kind === 'enrage'));
  assert.ok(ev.some((e) => e.type === 'shock' && e.kind === 'roar' && e.power === BOSS.enrage.shock));
  // watch state transitions: a pattern that ends straight in another wind-up (no 'move') is a chain
  const WIND = ['burstWind', 'summonWind', 'echoWind', 'chargeWind', 'spiral', 'sigWind'];
  let prev = b._ai;
  let chains = 0;
  let idleT = 0;
  let maxIdle = 0;
  p.x = 200;
  p.y = 800;
  run(g, () => {
    if (b._dead) return true;
    if (b._ai === 'move') {
      idleT += STEP;
      maxIdle = Math.max(maxIdle, idleT);
    } else idleT = 0;
    if (b._ai !== prev) {
      if (prev !== 'move' && WIND.includes(b._ai) && !WIND.includes(prev)) chains++;
      prev = b._ai;
    }
    return false;
  }, 60 * 20, () => ({ ...IDLE, moveX: 0, moveY: 0 }));
  assert.ok(chains >= 1, `chained patterns: ${chains}`);
  assert.ok(maxIdle <= BOSS.enrage.idle + 0.1, `enraged idle gap ${maxIdle.toFixed(2)} s`);
});

test('phase 2 echo turrets: capped, stationary, short-lived, and cleaned up with the boss', () => {
  const { g, b, p } = bossArena('water', { seed: 4 });
  b._phase = 1;
  p.x = 150;
  p.y = 800;
  run(g, (s) => b._ai === 'echoWind', 60 * 40);
  assert.equal(b._ai, 'echoWind', 'echo pattern used in phase 2');
  assert.equal(b.telegraph, 0);
  run(g, (s) => b._ai !== 'echoWind', 60 * 2);
  const turrets = g.enemies.filter((e) => e.life !== undefined);
  assert.equal(turrets.length, BOSS.echo.count);
  for (const t of turrets) {
    assert.equal(t.type, 'spitter');
    assert.equal(t.element, b.element);
    assert.ok(t._minion && t._speed === 0 && t.life <= BOSS.echo.life && t.life > 0);
  }
  const minions = () => g.enemies.filter((e) => e._minion).length;
  assert.ok(minions() <= BOSS.maxMinions);
  const score0 = g.score;
  const kills0 = g.kills;
  const x0 = turrets[0].x;
  const ev = run(g, () => !g.enemies.some((e) => e.life !== undefined), Math.round(60 * (BOSS.echo.life + 1)));
  assert.equal(turrets[0].x, x0, 'turrets do not walk');
  const died = ev.filter((e) => e.type === 'enemyDie' && e.expired);
  assert.equal(died.length, BOSS.echo.count, 'turrets expire');
  assert.equal(g.score, score0, 'expiry scores nothing');
  assert.equal(g.kills, kills0);
  // boss death takes minions and hazards with it
  const h = bossArena('earth', { seed: 9 });
  run(h.g, (s) => s.effects.some((f) => f.kind === 'pillar'), 60 * 6);
  h.b._phase = 1;
  h.b.hp = 1;
  h.p.x = h.b.x;
  h.p.y = h.b.y + 150;
  const ev2 = run(h.g, (s, e) => e.some((x) => x.type === 'enemyDie' && x.enemyType === 'boss'), 60 * 3, () => ({ ...IDLE, aimX: h.b.x, aimY: h.b.y, fire: true, switchTo: 'air' }));
  assert.ok(ev2.some((x) => x.type === 'enemyDie' && x.enemyType === 'boss'));
  update(h.g, IDLE, STEP);
  assert.equal(h.g.enemies.filter((e) => e._minion).length, 0);
  assert.equal(h.g.effects.filter((f) => f._hazard).length, 0, 'hazards cleared on boss death');
  assert.equal(h.g.projectiles.filter((pr) => pr.owner === 'enemy').length, 0);
});

test('the boss is shielded while it arrives', () => {
  const { g, b, p } = bossArena('fire', { instant: false, py: 450 });
  assert.ok(b.spawnT > 0);
  const hp = b.hp;
  const ev = run(g, (s) => b.spawnT <= 0, 60 * 3, () => ({ ...IDLE, aimX: b.x, aimY: b.y, fire: true, switchTo: 'water' }));
  assert.equal(b.hp, hp, 'no damage during the arrival');
  assert.ok(!ev.some((e) => e.type === 'hit' && e.enemyId === b.id));
  const ev2 = run(g, (s, e) => e.some((x) => x.type === 'hit' && x.enemyId === b.id), 60 * 2, () => ({ ...IDLE, aimX: b.x, aimY: b.y, fire: true, switchTo: 'water' }));
  assert.ok(ev2.some((x) => x.type === 'hit' && x.enemyId === b.id), 'vulnerable once landed');
});

test('later bosses: open with a shared pattern, scale their signatures, and wind-ups never drop below the floor', () => {
  const { g, b } = bossArena('fire', { wave: 10 });
  run(g, (s) => b._ai !== 'move', 60 * 4);
  assert.ok(!SIG_KINDS.includes(b._sig), `wave 10 opens with a shared pattern (${b._ai})`);
  const tele = g.effects.find((f) => f._follow === b.id);
  assert.ok(tele && tele.maxLife >= BOSS.windupMin - 1e-9);
  // force the signature by waiting for it
  run(g, (s, e) => e.some((x) => x.type === 'bossAttack' && x.kind === 'meteor'), 60 * 60, (s) => ({ ...IDLE, moveX: 0 }));
  run(g, (s) => s.effects.some((f) => f.kind === 'meteor'), 60 * 3);
  const ms = g.effects.filter((f) => f.kind === 'meteor');
  assert.equal(ms.length, BOSS.meteor.count + BOSS.meteor.perBoss, 'one more meteor on the second boss');
  // a far-future boss: floor holds
  const far = bossArena('earth', { wave: 100 });
  run(far.g, (s) => far.b._ai === 'sigWind', 60 * 4);
  const t2 = far.g.effects.find((f) => f._follow === far.b.id && f.kind === 'telegraph');
  assert.ok(t2 && Math.abs(t2.maxLife - BOSS.windupMin) < 1e-9, `floor ${t2 && t2.maxLife}`);
  assert.ok(PLAYER.dashInvuln < BOSS.windupMin, 'a wind-up always outlasts the dash i-frames (readable, not reaction-only)');
});

test('full fights: the smart bot (god mode) beats every element boss in bounded time with no NaN and within caps', () => {
  for (const el of ELEMENTS) {
    const { g } = bossArena(el, { seed: 100 + ELEMENTS.indexOf(el) });
    const t0 = g.time;
    let dead = false;
    let maxEffects = 0;
    const kinds = new Set();
    for (let i = 0; i < 60 * 120 && !dead; i++) {
      g.player.hp = g.player.maxHp;
      update(g, botInput(g), STEP);
      maxEffects = Math.max(maxEffects, g.effects.length);
      for (const ev of g.events) {
        if (ev.type === 'bossAttack') kinds.add(ev.kind);
        if (ev.type === 'enemyDie' && ev.enemyType === 'boss') dead = true;
      }
      if (i % 20 === 0) {
        const bad = findNonFinite(g);
        assert.equal(bad, null, `${el}: non-finite at ${bad}`);
        assert.ok(g.effects.length <= CAPS.effects && g.enemies.length <= CAPS.enemies);
        assert.ok(g.projectiles.length <= CAPS.playerProjectiles + CAPS.enemyProjectiles);
      }
    }
    const dur = g.time - t0;
    assert.ok(dead, `${el}: boss defeated`);
    assert.ok(dur > 5 && dur < 120, `${el}: fight lasted ${dur.toFixed(1)} s`);
    assert.ok(kinds.has(SIGNATURE[el]) && kinds.has('winded'), `${el}: signature + winded seen (${[...kinds]})`);
    assert.equal(findNonFinite(g), null);
    assert.equal(g.enemies.length, 0, `${el}: nothing left after the boss`);
  }
});

// Step 1 of the touch study: how much input does a run ask for?
//
//   node tools/touch-study/demand.mjs [seeds=12] [model=bot]
//
// Runs the model (default: the raw smart bot) through waves 1-15 with its HP topped up, so every seed
// covers every wave, and reports per wave group: element switches / min, how often the optimal element
// changes, dashes / min, distinct elements alive, 0.5 s windows that need move+aim+fire+switch together,
// and how precise aim has to be.

import { createGame, update, applyUpgrade, counterOf } from '../../src/sim.js';
import { nearestEnemy } from '../../src/bot.js';
import { ARENA, BLOWS, ENEMIES } from '../../src/config.js';
import { makeModel } from './model.mjs';

const STEP = 1 / 60;
const SEEDS = Number(process.argv[2] || 12);
const MODEL = process.argv[3] || 'bot';
const DEG = 180 / Math.PI;

const GROUPS = [
  ['W1-4', (w) => w <= 4],
  ['W5 boss', (w) => w === 5],
  ['W6-9', (w) => w >= 6 && w <= 9],
  ['W10 boss', (w) => w === 10],
  ['W11-14', (w) => w >= 11 && w <= 14],
  ['W15 boss', (w) => w === 15],
];
const groupOf = (w) => (GROUPS.find(([, f]) => f(w)) || ['W16+'])[0];

function blank() {
  return {
    combat: 0, switches: 0, optRaw: 0, optDeb: 0, dashes: 0, novas: 0, shots: 0, playerHits: 0,
    elTime: [0, 0, 0, 0, 0], elNearTime: [0, 0, 0, 0, 0], windows: 0, wAll4: 0, wSwitchFire: 0, wSwitchMoveFire: 0,
    wDash: 0, wDashSwitch: 0, sigs: 0, enemyBolts: 0,
  };
}

const agg = {};
for (const [g] of GROUPS) agg[g] = blank();
const shots = []; // { el, tol, lead, dist, type, hit }

for (let s = 0; s < SEEDS; s++) {
  const seed = 1000 + s;
  const g = createGame(seed);
  const model = makeModel(MODEL, {}, seed);
  let lastOpt = null;
  let candOpt = null;
  let debOpt = null;
  let candSince = 0;
  let win = null;
  const tracked = [];
  let guard = 0;
  while (g.phase !== 'gameover' && g.wave <= 15 && guard++ < 60 * 60 * 30) {
    if (g.phase === 'upgrade') {
      applyUpgrade(g, g.upgradeChoices[0].id);
      continue;
    }
    g.player.hp = g.player.maxHp; // god mode: every seed covers waves 1-15
    const inp = model.input(g);
    const nBefore = nearestEnemy(g);
    const projBefore = new Set(g.projectiles);
    update(g, inp, STEP);
    const A = agg[groupOf(g.wave)];
    if (!A) continue;
    const active = g.enemies.length > 0 && !(g.waveInfo.countdown > 0);
    // new player projectiles
    for (const pr of g.projectiles) if (pr.owner === 'player' && !projBefore.has(pr)) tracked.push({ pr, shot: null });
    for (const ev of g.events) {
      if (ev.type === 'switch') A.switches++;
      else if (ev.type === 'dash') A.dashes++;
      else if (ev.type === 'blow') A.novas++;
      else if (ev.type === 'playerHit') A.playerHits++;
      else if (ev.type === 'bossAttack' && ev.kind === 'winded') A.sigs++;
      else if (ev.type === 'enemyShoot') A.enemyBolts++;
      else if (ev.type === 'shoot' && nBefore) {
        A.shots++;
        if (ev.element === 'earth') continue;
        const e = nBefore.e;
        const p = g.player;
        const d = Math.max(1, Math.hypot(e.x - p.x, e.y - p.y));
        const B = BLOWS[ev.element];
        const pr = ev.element === 'water' ? B.r : B.r;
        const tol = Math.atan((e.r + pr) / d);
        // lateral speed of the target relative to the shot line -> lead angle the shot needs
        const ux = (e.x - p.x) / d;
        const uy = (e.y - p.y) / d;
        const vperp = Math.abs(-uy * e.vx + ux * e.vy);
        const lead = Math.asin(Math.min(1, vperp / B.speed));
        const rec = { el: ev.element, tol, lead, dist: d, type: e.type, hit: null, wave: g.wave };
        shots.push(rec);
        // attach to the projectile(s) spawned this step
        for (const t of tracked) if (t.shot === null && t.pr.element === ev.element) t.shot = rec;
      }
    }
    // resolve tracked projectiles
    for (let i = tracked.length - 1; i >= 0; i--) {
      const t = tracked[i];
      if (!t.pr._dead && g.projectiles.includes(t.pr)) continue;
      const pr = t.pr;
      let hit;
      if (pr.kind === 'wave') hit = pr._hit.length > 0;
      else hit = pr.life > 0 && pr.x >= 0 && pr.x <= ARENA.w && pr.y >= 0 && pr.y <= ARENA.h;
      if (t.shot) t.shot.hit = t.shot.hit || hit;
      tracked.splice(i, 1);
    }
    if (!active) {
      win = null;
      continue;
    }
    A.combat += STEP;
    // optimal element = counter of the nearest enemy; raw changes and changes that persist 0.5 s
    const n = nearestEnemy(g);
    const opt = n ? counterOf(n.e.element) : null;
    if (opt !== lastOpt) {
      if (lastOpt !== null) A.optRaw++;
      lastOpt = opt;
    }
    if (opt !== candOpt) {
      candOpt = opt;
      candSince = g.time;
    } else if (g.time - candSince >= 0.5 && candOpt !== null && candOpt !== debOpt) {
      if (debOpt !== null) A.optDeb++;
      debOpt = candOpt;
    }
    // distinct elements alive, and within 350 px
    const all = new Set();
    const near = new Set();
    for (const e of g.enemies) {
      all.add(e.element);
      if (Math.hypot(e.x - g.player.x, e.y - g.player.y) < 350) near.add(e.element);
    }
    A.elTime[all.size] += STEP;
    A.elNearTime[near.size] += STEP;
    // 0.5 s windows
    if (!win) win = { n: 0, moved: false, a0: g.player.angle, amin: 0, amax: 0, fired: false, switched: false, dashed: false };
    win.n++;
    if (Math.hypot(inp.moveX, inp.moveY) > 0.3) win.moved = true;
    let da = g.player.angle - win.a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    win.amin = Math.min(win.amin, da);
    win.amax = Math.max(win.amax, da);
    for (const ev of g.events) {
      if (ev.type === 'shoot') win.fired = true;
      if (ev.type === 'switch') win.switched = true;
      if (ev.type === 'dash') win.dashed = true;
    }
    if (win.n >= 30) {
      A.windows++;
      const aimed = (win.amax - win.amin) * DEG > 15;
      if (win.moved && aimed && win.fired && win.switched) A.wAll4++;
      if (win.switched && win.fired) A.wSwitchFire++;
      if (win.switched && win.fired && win.moved) A.wSwitchMoveFire++;
      if (win.dashed) A.wDash++;
      if (win.dashed && win.switched) A.wDashSwitch++;
      win = null;
    }
  }
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '-');
const rows = [];
for (const [gname] of GROUPS) {
  const A = agg[gname];
  const min = A.combat / 60;
  const tot = A.elTime.reduce((a, b) => a + b, 0);
  const totN = A.elNearTime.reduce((a, b) => a + b, 0);
  const meanEl = A.elTime.reduce((a, t, k) => a + t * k, 0) / (tot || 1);
  const meanNear = A.elNearTime.reduce((a, t, k) => a + t * k, 0) / (totN || 1);
  rows.push({
    group: gname,
    'combat min': f1(min),
    'switch/min': f1(A.switches / min),
    'opt chg/min': f1(A.optRaw / min),
    'opt chg/min (0.5s)': f1(A.optDeb / min),
    'dash/min': f1(A.dashes / min),
    'nova/min': f1(A.novas / min),
    'els alive avg': f1(meanEl),
    '>=3 alive': pct(A.elTime[3] + A.elTime[4], tot),
    'els <350px': f1(meanNear),
    'win sw+fire': pct(A.wSwitchFire, A.windows),
    'win mv+aim+fire+sw': pct(A.wAll4, A.windows),
    'win dash': pct(A.wDash, A.windows),
    'win dash+sw': pct(A.wDashSwitch, A.windows),
    'bolts/min': f1(A.enemyBolts / min),
  });
}
console.log(`model=${MODEL} seeds=${SEEDS} (god mode, waves 1-15)`);
console.table(rows);

// aim precision
function quant(arr, q) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const arows = [];
for (const el of ['fire', 'air', 'water']) {
  for (const type of ['all', 'swarm', 'grunt', 'spitter', 'brute', 'boss']) {
    const S = shots.filter((s) => s.el === el && (type === 'all' || s.type === type));
    if (S.length < 30) continue;
    const tol = S.map((s) => s.tol * DEG);
    const needLead = S.filter((s) => s.lead > s.tol).length;
    const resolved = S.filter((s) => s.hit !== null);
    arows.push({
      el, target: type, shots: S.length,
      'tol med deg': f1(quant(tol, 0.5)), 'tol p10 deg': f1(quant(tol, 0.1)),
      'dist med px': f1(quant(S.map((s) => s.dist), 0.5)),
      'lead>tol': pct(needLead, S.length),
      'center-aim hit rate': pct(resolved.filter((s) => s.hit).length, resolved.length),
    });
  }
}
console.log('aim: angular half-width of the target at the moment of the shot (tol), and how often a moving target needs more lead than that');
console.table(arows);

// on-screen target sizes
const screens = { 'Pixel 7 landscape': [863, 360], 'iPhone 13 landscape': [750, 342], 'iPhone portrait': [390, 664], 'iPad landscape': [1180, 820], 'laptop 1440x900': [1440, 820] };
const srows = [];
for (const [name, [w, h]] of Object.entries(screens)) {
  const sc = Math.min(w / ARENA.w, h / ARENA.h);
  srows.push({
    screen: name, scale: sc.toFixed(3), arena: `${Math.round(ARENA.w * sc)}x${Math.round(ARENA.h * sc)}`,
    'swarm d px': f1(2 * ENEMIES.swarm.r * sc), 'grunt d px': f1(2 * ENEMIES.grunt.r * sc),
    'spitter d px': f1(2 * ENEMIES.spitter.r * sc), 'bolt d px': f1(2 * ENEMIES.spitter.boltR * sc),
    'player d px': f1(36 * sc),
  });
}
console.log('on-screen sizes (CSS px)');
console.table(srows);

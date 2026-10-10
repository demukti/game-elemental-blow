// Elemental Blow — pure, deterministic simulation (no DOM / window / audio; runs in node).
//
// Contract API:
//   createGame(seed?) -> state
//   update(state, input, dt)       mutates state; state.events is reset at the start of every call
//   applyUpgrade(state, upgradeId) valid in phase 'upgrade'; returns true when applied
//   elementMultiplier(attackEl, targetEl) -> 2 | 1 | 0.5
//
// Extra exports (tests / tooling): spawnEnemy, counterOf, random.
// Private state fields are prefixed with "_".

import {
  ARENA, ELEMENTS, BEATS, PLAYER, BLOWS, ULT, ENEMIES, BOSS, WAVE, PICKUPS, COMBO, CAPS, UPGRADES,
} from './config.js';

const TAU = Math.PI * 2;
const W = ARENA.w;
const H = ARENA.h;
const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
const COUNTER = Object.fromEntries(Object.entries(BEATS).map(([a, b]) => [b, a])); // COUNTER[x] beats x

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
const emit = (state, ev) => {
  state.events.push(ev);
};

function compact(arr, keep) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (keep(o)) arr[j++] = o;
  }
  arr.length = j;
}

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32); the generator state lives in state._rng.
// ---------------------------------------------------------------------------
function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(seed) >>> 0;
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function random(state) {
  state._rng = (state._rng + 0x6d2b79f5) >>> 0;
  let t = state._rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (state, a, b) => a + (b - a) * random(state);
const ri = (state, n) => Math.floor(random(state) * n);
const pick = (state, arr) => arr[ri(state, arr.length)];

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
export function elementMultiplier(attackEl, targetEl) {
  if (!attackEl || !targetEl) return 1;
  if (BEATS[attackEl] === targetEl) return 2;
  if (attackEl === targetEl) return 0.5;
  if (BEATS[targetEl] === attackEl) return 0.5;
  return 1;
}

/** The element that deals 2x to `el`. */
export function counterOf(el) {
  return COUNTER[el] || null;
}

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------
/** Per-wave enemy multipliers (see WAVE.scale). Speed saturates smoothly at 1 + speedMax. */
function waveScale(n) {
  const k = Math.max(0, n - 1);
  const sc = WAVE.scale;
  return {
    hp: 1 + sc.hp * k + sc.hpQuad * k * k,
    speed: 1 + sc.speedMax * (1 - Math.exp((-sc.speed * k) / sc.speedMax)),
    dmg: 1 + sc.dmg * k,
  };
}
const bossIndex = (n) => Math.max(1, Math.floor(n / WAVE.bossEvery));
const isBossWave = (n) => n % WAVE.bossEvery === 0;
const maxAlive = (n) => Math.min(CAPS.enemies, WAVE.aliveBase + WAVE.alivePerWave * n);
const spawnGroups = (n) => Math.min(WAVE.groupMax, 1 + Math.floor(n / WAVE.groupEvery));
/** Budget a regular wave spends on bodies; the wave after a boss is a breather. */
const waveBudget = (n) =>
  (WAVE.budgetBase + WAVE.budgetPerWave * (n - 1)) * (n > 1 && isBossWave(n - 1) ? WAVE.breather : 1);
/** Seconds between spawn groups; stretched by the mercy rule (low HP on an early wave). */
function spawnInterval(state, n) {
  const base = Math.max(WAVE.spawnIntervalMin, WAVE.spawnIntervalBase - WAVE.spawnIntervalPerWave * (n - 1));
  return base * mercyFactor(state);
}
function mercyFactor(state) {
  const p = state.player;
  return state.wave <= WAVE.mercyUntil && p.hp < p.maxHp * WAVE.mercyHp ? WAVE.mercySlow : 1;
}
const blowCooldown = (state, el) => BLOWS[el].cooldown * state._mods.cd;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------
function freshMods() {
  return {
    speed: 1,
    dmg: { fire: 1, water: 1, earth: 1, air: 1 },
    cd: 1,
    dashCd: 1,
    blowRate: 1,
    fireRadius: 1,
    burn: 1,
    wavePierce: 0,
    waveKb: 1,
    waveWidth: 1,
    darts: 0,
    lifesteal: 0,
    magnet: 0,
    slamRadius: 1,
    stun: 0,
    armor: 1,
    healBonus: 1,
    healDrop: 1,
  };
}

function makePlayer() {
  return {
    x: W / 2,
    y: H / 2,
    r: PLAYER.r,
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    element: PLAYER.startElement,
    angle: 0,
    vx: 0,
    vy: 0,
    dashCd: 0,
    dashCdMax: PLAYER.dashCd,
    dashing: 0,
    invuln: 0,
    cooldowns: { fire: 0, water: 0, earth: 0, air: 0 },
    blow: 0,
    hitFlash: 0,
    upgrades: [],
    blowSurge: 0, // extra: 0..1, how long the meter has been held full (nova damage bonus, see PLAYER.surgeCapTime)
    novaRush: 0, // extra: seconds of faster blow cooldowns left after a nova
    _kx: 0,
    _ky: 0,
    _dashX: 1,
    _dashY: 0,
    _surgeT: 0,
    _dashBuf: 0, // buffered dash press (seconds left)
    _dashHit: [], // enemy ids already nicked by the current dash
    _stillT: 0, // seconds the player has been standing still
  };
}

export function createGame(seed) {
  const s = seed === undefined || seed === null ? (Date.now() ^ 0x5bd1e995) >>> 0 : hashSeed(seed);
  const state = {
    phase: 'playing',
    time: 0,
    wave: 1,
    score: 0,
    combo: 1,
    comboTimer: 0,
    kills: 0,
    waveInfo: { remaining: 0, total: 0, countdown: 0, isBoss: false },
    player: makePlayer(),
    enemies: [],
    projectiles: [],
    effects: [],
    pickups: [],
    upgradeChoices: [],
    events: [],
    // extras (not in the contract, safe to read)
    seed: s,
    stats: { damageDealt: 0, damageTaken: 0, bestCombo: 1, superKills: 0, blowsUsed: 0 },
    // private
    _rng: s,
    _nextId: 1,
    _mods: freshMods(),
    _queue: [],
    _spawnTimer: 0,
    _waveActive: false,
    _clearTimer: 0,
    _comboKills: 0,
    _comboTime: 0,
    _comboDecay: 0,
    _waveHp: 1,
    _pack: 0,
    _packs: {}, // swarm pack id -> { mode: 'approach' | 'orbit' | 'dive', t, side }
    _killBurstT: 0,
    _killBurstN: 0,
  };
  setupWave(state, 1, WAVE.firstCountdown);
  return state;
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------
function elementPalette(state, n) {
  const sizes = WAVE.palette;
  const size = clamp(sizes[Math.min(sizes.length, Math.max(1, n)) - 1], 1, ELEMENTS.length);
  const pool = ELEMENTS.slice();
  const out = [];
  while (out.length < size) out.push(pool.splice(ri(state, pool.length), 1)[0]);
  return out;
}

function planWave(state, n) {
  const q = [];
  const pal = elementPalette(state, n);
  state._waveHp = 1;

  if (isBossWave(n)) {
    const k = bossIndex(n);
    q.push({ type: 'boss', element: pick(state, ELEMENTS) });
    // Later bosses bring an escort.
    const escorts = (k - 1) * 4;
    for (let i = 0; i < escorts; i++) {
      q.push({ type: i % 3 === 2 ? 'spitter' : 'grunt', element: pick(state, pal) });
    }
    return q;
  }

  let budget = waveBudget(n);
  const total = budget;
  const un = WAVE.unlock;
  const limits = {
    brute: Math.floor(n / WAVE.brutePer),
    spitter: n <= WAVE.spitterSolo ? 1 : 1 + Math.floor((n - WAVE.spitterSolo) * WAVE.spitterPerWave),
  };
  const counts = { grunt: 0, swarm: 0, spitter: 0, brute: 0 };
  while (budget > 0.2 && q.length < WAVE.maxPerWave) {
    const opts = [['grunt', 3]];
    if (n >= un.swarm) opts.push(['swarm', 1.5]);
    if (n >= un.spitter && counts.spitter < limits.spitter) opts.push(['spitter', 2]);
    if (n >= un.brute && counts.brute < limits.brute && budget >= ENEMIES.brute.cost) opts.push(['brute', 1]);
    let sum = 0;
    for (const o of opts) sum += o[1];
    let roll = random(state) * sum;
    let type = opts[0][0];
    for (const o of opts) {
      roll -= o[1];
      if (roll <= 0) {
        type = o[0];
        break;
      }
    }
    if (type === 'swarm') {
      const sp = WAVE.swarmPack;
      const size = Math.min(sp.max, sp.min + ri(state, sp.extra + Math.floor(n / sp.per)));
      const pack = ++state._pack;
      const el = pick(state, pal);
      for (let i = 0; i < size && q.length < WAVE.maxPerWave; i++) q.push({ type, element: el, pack });
      budget -= size * ENEMIES.swarm.cost;
      counts.swarm += size;
    } else {
      q.push({ type, element: pick(state, pal) });
      budget -= ENEMIES[type].cost;
      counts[type]++;
    }
  }
  // Whatever budget could not be spent on bodies (count cap) becomes extra HP, capped so late waves are not sponges.
  if (budget > 0.2) state._waveHp = Math.min(WAVE.spongeCap, 1 + budget / Math.max(1, total - budget));
  // Never open a wave with a brute: move the first non-brute entry to the front.
  if (q.length && q[0].type === 'brute') {
    const i = q.findIndex((e) => e.type !== 'brute');
    if (i > 0) q.unshift(q.splice(i, 1)[0]);
  }
  return q;
}

function setupWave(state, n, countdown) {
  state.wave = n;
  state._queue = planWave(state, n);
  state._waveActive = false;
  state._spawnTimer = 0;
  state._clearTimer = 0;
  const wi = state.waveInfo;
  wi.total = state._queue.length;
  wi.remaining = state._queue.length;
  wi.countdown = countdown;
  wi.isBoss = isBossWave(n);
  if (wi.isBoss && n > 1) {
    const p = state.player;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * BOSS.preHeal);
  }
}

function spawnPoint(state, r) {
  const p = state.player;
  const m = r + 24;
  let best = null;
  let bestD = -1;
  for (let i = 0; i < 12; i++) {
    const side = ri(state, 4);
    let x;
    let y;
    if (side === 0) {
      x = rr(state, m, W - m);
      y = m;
    } else if (side === 1) {
      x = rr(state, m, W - m);
      y = H - m;
    } else if (side === 2) {
      x = m;
      y = rr(state, m, H - m);
    } else {
      x = W - m;
      y = rr(state, m, H - m);
    }
    const d = dist2(x, y, p.x, p.y);
    if (d >= 380 * 380) return { x, y };
    if (d > bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

function spawnFromQueue(state) {
  let groups = spawnGroups(state.wave);
  while (groups > 0 && state._queue.length && state.enemies.length < CAPS.enemies) {
    const entry = state._queue[0];
    if (entry.pack) {
      const pt = spawnPoint(state, 40);
      while (state._queue.length && state._queue[0].pack === entry.pack && state.enemies.length < CAPS.enemies) {
        const en = state._queue.shift();
        const a = random(state) * TAU;
        const d = rr(state, 8, 46);
        spawnEnemy(state, en.type, en.element, pt.x + Math.cos(a) * d, pt.y + Math.sin(a) * d, { pack: en.pack });
      }
    } else {
      state._queue.shift();
      if (entry.type === 'boss') {
        spawnEnemy(state, 'boss', entry.element, W / 2, ENEMIES.boss.r + 70);
      } else {
        const pt = spawnPoint(state, ENEMIES[entry.type].r);
        spawnEnemy(state, entry.type, entry.element, pt.x, pt.y);
      }
    }
    groups--;
  }
}

function updateWave(state, dt) {
  const wi = state.waveInfo;
  if (wi.countdown > 0) {
    wi.countdown = Math.max(0, wi.countdown - dt);
    if (wi.countdown === 0) {
      state._waveActive = true;
      state._spawnTimer = 0;
      emit(state, { type: 'waveStart', wave: state.wave, isBoss: wi.isBoss });
    }
    return;
  }
  if (state._waveActive && state._queue.length) {
    state._spawnTimer -= dt;
    // pressure: the arena holds fewer enemies than one spawn group, so the next group comes sooner
    if (state.enemies.length < spawnGroups(state.wave)) {
      state._spawnTimer = Math.min(state._spawnTimer, WAVE.pressureInterval * mercyFactor(state));
    }
    if (state._spawnTimer <= 0 && state.enemies.length < maxAlive(state.wave)) {
      spawnFromQueue(state);
      state._spawnTimer = spawnInterval(state, state.wave);
    }
  }
}

function checkWaveClear(state, dt) {
  if (state.phase !== 'playing') return;
  if (state._clearTimer > 0) {
    state._clearTimer -= dt;
    if (state._clearTimer <= 0) {
      state._clearTimer = 0;
      state.phase = 'upgrade';
      state.upgradeChoices = rollUpgrades(state, 3);
    }
    return;
  }
  if (state._waveActive && state._queue.length === 0 && state.enemies.length === 0) {
    state._waveActive = false;
    state._clearTimer = WAVE.clearDelay;
    const p = state.player;
    p.hp = Math.min(p.maxHp, p.hp + WAVE.clearHeal);
    for (const pr of state.projectiles) if (pr.owner === 'enemy') pr._dead = true;
    emit(state, { type: 'waveClear', wave: state.wave });
  }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
/** Spawn an enemy (used by the wave director, boss summons and tests). */
export function spawnEnemy(state, type, element, x, y, opts = {}) {
  const def = ENEMIES[type];
  if (!def) throw new Error(`unknown enemy type: ${type}`);
  const el = ELEMENTS.includes(element) ? element : 'fire';
  const sc = waveScale(state.wave);
  const dmgScale = type === 'boss' ? 1 + BOSS.dmgPerWave * (state.wave - 1) : sc.dmg;
  let hp;
  if (type === 'boss') hp = def.hp * (1 + BOSS.hpPerBoss * (bossIndex(state.wave) - 1));
  else hp = def.hp * sc.hp * (opts.minion ? 1 : state._waveHp);
  const p = state.player;
  const ex = clamp(Number.isFinite(x) ? x : W / 2, def.r, W - def.r);
  const ey = clamp(Number.isFinite(y) ? y : H / 2, def.r, H - def.r);
  const e = {
    id: state._nextId++,
    type,
    element: el,
    x: ex,
    y: ey,
    r: def.r,
    hp,
    maxHp: hp,
    angle: Math.atan2(p.y - ey, p.x - ex),
    vx: 0,
    vy: 0,
    hitFlash: 0,
    burn: 0,
    slow: 0,
    stun: 0,
    telegraph: 0,
    telegraphKind: null, // extra: 'charge' | 'shoot' | 'burst' | 'summon' while winding up
    windup: 0, // extra: wind-up progress for every kind (telegraph is only set for directional ones)
    spawnT: opts.instant ? 0 : 1,
    pack: opts.pack || 0, // extra: swarm pack id (0 = none); packmates flock and commit together
    guard: 0, // extra: 0..1 brute shield stance (frontal damage halved while > 0)
    _spawnDur: def.spawnTime,
    _speed: def.speed * sc.speed,
    _dmg: def.dmg * dmgScale,
    _boltDmg: (def.boltDmg || 0) * dmgScale,
    _kx: 0,
    _ky: 0,
    _mx: 0,
    _my: 0,
    _atkCd: 0.4,
    _ai: 'move',
    _aiT: type === 'boss' ? 1.2 : 0,
    _fireT: rr(state, 0.8, def.fireEvery || 2),
    _chargeCd: rr(state, 0.8, 2.2),
    _dirX: 1,
    _dirY: 0,
    _burnDps: 0,
    _burnTick: 0,
    _lastMult: 1,
    _dead: false,
    _minion: !!opts.minion,
    _wob: random(state) * TAU,
    _strafe: random(state) < 0.5 ? -1 : 1,
    _phase: 0,
    _rings: 0,
    _spiralA: 0,
    _spiralCd: 0,
    _lastPattern: null,
    _fleeT: 0, // scatter timer: 'move'-state enemies back off while > 0
    _flank: rr(state, -0.6, 0.6), // grunt approach angle offset (radians) so groups envelop
    _lungeCd: rr(state, 1.5, 3.5),
    _guardCd: rr(state, 2, 5),
    _chargeHit: false, // brute: did the current charge connect?
  };
  state.enemies.push(e);
  if (type === 'boss') emit(state, { type: 'bossSpawn', x: e.x, y: e.y, element: e.element });
  return e;
}

function addProjectile(state, pr) {
  const owner = pr.owner;
  let n = 0;
  for (const o of state.projectiles) if (o.owner === owner && !o._dead) n++;
  const cap = owner === 'player' ? CAPS.playerProjectiles : CAPS.enemyProjectiles;
  if (n >= cap) return null;
  pr.id = state._nextId++;
  pr.maxLife = pr.life;
  pr._dead = false;
  state.projectiles.push(pr);
  return pr;
}

function addEffect(state, kind, element, x, y, r, life, extra) {
  if (state.effects.length >= CAPS.effects) state.effects.shift();
  const f = { id: state._nextId++, kind, element, x, y, r, life, maxLife: life };
  if (extra) Object.assign(f, extra);
  state.effects.push(f);
  return f;
}

function dropPickup(state, kind, x, y) {
  if (state.pickups.length >= CAPS.pickups) state.pickups.shift();
  const a = random(state) * TAU;
  const sp = rr(state, 40, 160);
  state.pickups.push({
    id: state._nextId++,
    kind,
    x: clamp(x, 20, W - 20),
    y: clamp(y, 20, H - 20),
    r: PICKUPS.r,
    life: PICKUPS.life,
    maxLife: PICKUPS.life,
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp,
    _dead: false,
  });
}

function fireBolt(state, e, angle, speed, r) {
  return addProjectile(state, {
    owner: 'enemy',
    kind: 'bolt',
    element: e.element,
    x: e.x + Math.cos(angle) * (e.r + 4),
    y: e.y + Math.sin(angle) * (e.r + 4),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    angle,
    life: 4,
    _dmg: e._boltDmg,
  });
}

// ---------------------------------------------------------------------------
// Damage, kills, scoring
// ---------------------------------------------------------------------------
function addBlow(state, amount) {
  const p = state.player;
  const before = p.blow;
  p.blow = Math.min(100, p.blow + amount);
  if (before < 100 && p.blow >= 100) emit(state, { type: 'blowReady' });
}

function perfectDodge(state, x, y) {
  addBlow(state, PLAYER.perfectDodgeBlow);
  emit(state, { type: 'perfectDodge', x, y });
}

/** Nearby non-boss enemies that are not mid-attack break off for a moment. */
function scatter(state, x, y, r, time) {
  for (const e of state.enemies) {
    if (e._dead || e.type === 'boss') continue;
    const rs = r + e.r;
    if (dist2(x, y, e.x, e.y) < rs * rs) e._fleeT = Math.max(e._fleeT, time);
  }
}

/** Aim angle from e to the player, leading by the player's velocity over the flight time (lead clamped). */
function leadAngle(e, p, speed, maxLead) {
  const d = Math.hypot(p.x - e.x, p.y - e.y);
  const t = d / (speed || 1);
  let lx = p.vx * t;
  let ly = p.vy * t;
  const ll = Math.hypot(lx, ly);
  if (ll > maxLead) {
    lx *= maxLead / ll;
    ly *= maxLead / ll;
  }
  return Math.atan2(p.y + ly - e.y, p.x + lx - e.x);
}

function knock(e, dx, dy, amount) {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const k = (amount * ENEMIES[e.type].kb) / d;
  e._kx += dx * k;
  e._ky += dy * k;
}

function applyBurn(state, e, time, dps) {
  if (e._dead) return;
  if (e.burn <= 0) e._burnTick = 0.4;
  e.burn = Math.max(e.burn, time);
  e._burnDps = Math.max(e._burnDps, dps);
}

function hurtEnemy(state, e, base, element, opts) {
  if (e._dead || !(base > 0)) return 0;
  const mult = elementMultiplier(element, e.element);
  let dmg = base * mult * state._mods.dmg[element];
  let guarded = false;
  if (e.guard > 0 && !(opts && opts.dot)) {
    // shield stance: hits from the front are halved (every direct player attack comes from the player)
    const p = state.player;
    const tx = p.x - e.x;
    const ty = p.y - e.y;
    const tl = Math.hypot(tx, ty) || 1;
    if ((Math.cos(e.angle) * tx + Math.sin(e.angle) * ty) / tl > 0.2) {
      dmg *= 1 - 0.5 * clamp(e.guard, 0, 1);
      guarded = true;
    }
  }
  e.hp -= dmg;
  e.hitFlash = 0.12;
  e._lastMult = mult;
  state.stats.damageDealt += dmg;
  const ev = { type: 'hit', x: e.x, y: e.y, element, dmg: Math.max(1, Math.round(dmg)), mult, enemyId: e.id };
  if (opts && opts.dot) ev.dot = true;
  if (guarded) ev.guarded = true;
  emit(state, ev);
  if (!(opts && opts.noCharge)) {
    // normalised by the wave's HP scaling so the meter fills at a similar pace on every wave
    const hpScale = e.type === 'boss' ? 1 + BOSS.hpPerBoss * (bossIndex(state.wave) - 1) : waveScale(state.wave).hp;
    addBlow(state, ((dmg * PLAYER.blowPerDamage) / hpScale) * state._mods.blowRate);
  }
  if (e.hp <= 0) killEnemy(state, e);
  else if (e.type === 'boss') checkBossPhase(state, e);
  return dmg;
}

function killEnemy(state, e) {
  if (e._dead) return;
  e._dead = true;
  e.hp = 0;
  const def = ENEMIES[e.type];
  const sup = e._lastMult === 2;
  const p = state.player;
  const m = state._mods;

  state._comboKills++;
  state._comboTime = COMBO.window;
  state._comboDecay = COMBO.decayStep;
  state.comboTimer = 1;
  state.combo = comboValue(state._comboKills);
  if (state.combo > state.stats.bestCombo) state.stats.bestCombo = state.combo;

  // 3 kills inside a second: the survivors around the player scatter for a moment
  if (state.time - state._killBurstT > 1) {
    state._killBurstT = state.time;
    state._killBurstN = 0;
  }
  state._killBurstN++;
  if (state._killBurstN === 3) scatter(state, p.x, p.y, 300, ULT.scatter);

  const score = Math.round(
    def.score * (1 + 0.1 * (state.wave - 1)) * state.combo * (sup ? COMBO.superBonus : 1) * (e._minion ? 0.5 : 1),
  );
  state.score += score;
  state.kills++;
  if (sup) state.stats.superKills++;
  emit(state, { type: 'enemyDie', x: e.x, y: e.y, element: e.element, enemyType: e.type, score, superEffective: sup });

  addBlow(state, PLAYER.blowPerKill * (sup ? 2 : 1) * m.blowRate);
  if (m.lifesteal > 0 && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + m.lifesteal);

  if (e.type === 'boss') {
    for (let i = 0; i < BOSS.drops.heal; i++) dropPickup(state, 'heal', e.x, e.y);
    for (let i = 0; i < BOSS.drops.blow; i++) dropPickup(state, 'blow', e.x, e.y);
    // The titan's death takes its minions with it.
    for (const o of state.enemies) if (!o._dead && o._minion) killEnemy(state, o);
    for (const pr of state.projectiles) if (pr.owner === 'enemy') pr._dead = true;
  } else if (!e._minion || random(state) < 0.5) {
    const r = random(state);
    const heal = def.healDrop * m.healDrop;
    if (r < heal) dropPickup(state, 'heal', e.x, e.y);
    else if (r < heal + def.blowDrop) dropPickup(state, 'blow', e.x, e.y);
  }
}

function comboValue(k) {
  return Math.min(COMBO.max, Math.round((1 + k * COMBO.perKill) * 10) / 10);
}

function damagePlayer(state, dmg, sx, sy, kb, element) {
  const p = state.player;
  if (state.phase !== 'playing' || p.hp <= 0 || p.invuln > 0 || p.dashing > 0) return false;
  // like resists like: an attacker of the player's current element deals reduced damage
  const resisted = !!element && element === p.element;
  const d = dmg * state._mods.armor * (resisted ? PLAYER.sameElementTaken : 1);
  p.hp = Math.max(0, p.hp - d);
  p.invuln = PLAYER.hitInvuln;
  p.hitFlash = PLAYER.hitFlash;
  state.stats.damageTaken += d;
  if (kb) {
    const dx = p.x - sx;
    const dy = p.y - sy;
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) {
      p._kx += (dx / l) * kb;
      p._ky += (dy / l) * kb;
    }
  }
  emit(state, { type: 'playerHit', x: p.x, y: p.y, dmg: Math.max(1, Math.round(d)), resisted });
  if (p.hp <= 0) {
    state.phase = 'gameover';
    emit(state, { type: 'gameOver', score: state.score, wave: state.wave });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
function normInput(inp, p) {
  const i = inp || {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    moveX: clamp(num(i.moveX, 0), -1, 1),
    moveY: clamp(num(i.moveY, 0), -1, 1),
    aimX: num(i.aimX, p.x + Math.cos(p.angle) * 100),
    aimY: num(i.aimY, p.y + Math.sin(p.angle) * 100),
    fire: !!i.fire,
    dash: !!i.dash,
    blow: !!i.blow,
    switchTo: ELEMENTS.includes(i.switchTo) ? i.switchTo : null,
    cycle: i.cycle > 0 ? 1 : i.cycle < 0 ? -1 : 0,
  };
}

function setElement(state, el) {
  const p = state.player;
  if (p.element === el) return;
  p.element = el;
  emit(state, { type: 'switch', element: el });
}

function updatePlayer(state, inp, dt) {
  const p = state.player;
  const m = state._mods;

  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.novaRush = Math.max(0, p.novaRush - dt);
  p._dashBuf = Math.max(0, p._dashBuf - dt);
  if (inp.dash) p._dashBuf = PLAYER.dashBuffer;

  // surge: the meter has no decay, so holding it full is rewarded (speed now, a bigger nova later)
  if (p.blow >= 100) p._surgeT = Math.min(PLAYER.surgeCapTime, p._surgeT + dt);
  else p._surgeT = 0;
  p.blowSurge = clamp(p._surgeT / PLAYER.surgeCapTime, 0, 1);

  // element
  if (inp.switchTo) setElement(state, inp.switchTo);
  else if (inp.cycle) {
    const i = ELEMENTS.indexOf(p.element);
    setElement(state, ELEMENTS[(i + inp.cycle + ELEMENTS.length) % ELEMENTS.length]);
  }

  // aim
  const ax = inp.aimX - p.x;
  const ay = inp.aimY - p.y;
  if (ax * ax + ay * ay > 1) p.angle = Math.atan2(ay, ax);

  // movement
  let mx = inp.moveX;
  let my = inp.moveY;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }

  if (p._dashBuf > 0 && p.dashCd <= 0 && p.dashing <= 0) {
    p._dashBuf = 0;
    p._dashHit.length = 0;
    let dx = mx;
    let dy = my;
    if (Math.hypot(dx, dy) < 0.1) {
      dx = Math.cos(p.angle);
      dy = Math.sin(p.angle);
    }
    const l = Math.hypot(dx, dy);
    p._dashX = dx / l;
    p._dashY = dy / l;
    p.dashing = PLAYER.dashTime;
    p.invuln = Math.max(p.invuln, PLAYER.dashInvuln);
    p.dashCdMax = PLAYER.dashCd * m.dashCd;
    p.dashCd = p.dashCdMax;
    emit(state, { type: 'dash', x: p.x, y: p.y });
  }

  if (p.dashing > 0) {
    p.vx = p._dashX * PLAYER.dashSpeed;
    p.vy = p._dashY * PLAYER.dashSpeed;
    p.dashing = Math.max(0, p.dashing - dt);
    if (p.dashing === 0) {
      p.vx *= 0.3;
      p.vy *= 0.3;
    }
  } else {
    const sp = PLAYER.speed * m.speed * (p.blow >= 100 ? 1 + PLAYER.surgeSpeed : 1);
    const k = Math.min(1, PLAYER.accel * dt);
    p.vx += (mx * sp - p.vx) * k;
    p.vy += (my * sp - p.vy) * k;
  }
  const kd = Math.exp(-9 * dt);
  p._kx *= kd;
  p._ky *= kd;
  p.x = clamp(p.x + (p.vx + p._kx) * dt, p.r, W - p.r);
  p.y = clamp(p.y + (p.vy + p._ky) * dt, p.r, H - p.r);
  p._stillT = Math.hypot(p.vx, p.vy) > 20 ? 0 : Math.min(10, p._stillT + dt);

  // cooldowns (stored as 0..1 fraction remaining); a fresh nova speeds them up briefly
  const cdRate = p.novaRush > 0 ? 1 + PLAYER.novaRushCd : 1;
  for (const el of ELEMENTS) {
    if (p.cooldowns[el] > 0) p.cooldowns[el] = Math.max(0, p.cooldowns[el] - (dt * cdRate) / blowCooldown(state, el));
  }

  if (inp.fire && p.cooldowns[p.element] <= 0) castBlow(state, p.element);

  if (inp.blow) {
    if (p.blow >= 100) castNova(state);
    else emit(state, { type: 'denied' });
  }
}

function castBlow(state, el) {
  const p = state.player;
  const m = state._mods;
  const B = BLOWS[el];
  const ca = Math.cos(p.angle);
  const sa = Math.sin(p.angle);
  const mx = p.x + ca * (p.r + 6);
  const my = p.y + sa * (p.r + 6);

  if (el === 'fire') {
    addProjectile(state, {
      owner: 'player', kind: 'fireball', element: 'fire', x: mx, y: my,
      vx: ca * B.speed, vy: sa * B.speed, r: B.r, angle: p.angle, life: B.range / B.speed, _dmg: B.damage,
    });
  } else if (el === 'water') {
    const r = B.r * m.waveWidth;
    addProjectile(state, {
      owner: 'player', kind: 'wave', element: 'water', x: mx, y: my,
      vx: ca * B.speed, vy: sa * B.speed, r, angle: p.angle, life: B.range / B.speed,
      _dmg: B.damage, _rMax: r + B.grow * m.waveWidth, _grow: B.grow * 1.5 * m.waveWidth,
      _pierce: B.pierce + m.wavePierce, _hit: [],
    });
  } else if (el === 'earth') {
    const R = B.radius * m.slamRadius;
    const cx = clamp(p.x + ca * B.reach, 0, W);
    const cy = clamp(p.y + sa * B.reach, 0, H);
    addEffect(state, 'slam', 'earth', cx, cy, R, 0.4);
    emit(state, { type: 'slam', x: cx, y: cy, r: R, element: 'earth' });
    const stun = B.stun + m.stun;
    for (const e of state.enemies) {
      if (e._dead) continue;
      const rr2 = R + e.r * 0.6;
      if (dist2(cx, cy, e.x, e.y) > rr2 * rr2) continue;
      e.stun = Math.max(e.stun, stun * ENEMIES[e.type].stun);
      knock(e, e.x - p.x, e.y - p.y, B.knockback);
      hurtEnemy(state, e, B.damage, 'earth');
    }
    // the slam also crushes incoming bolts
    for (const pr of state.projectiles) {
      if (pr.owner === 'enemy' && dist2(cx, cy, pr.x, pr.y) < R * R) pr._dead = true;
    }
  } else {
    const n = B.darts + m.darts;
    for (let i = 0; i < n; i++) {
      const a = p.angle + (i - (n - 1) / 2) * B.spread;
      addProjectile(state, {
        owner: 'player', kind: 'dart', element: 'air', x: mx, y: my,
        vx: Math.cos(a) * B.speed, vy: Math.sin(a) * B.speed, r: B.r, angle: a, life: B.range / B.speed,
        _dmg: B.damage,
      });
    }
  }
  p.cooldowns[el] = 1;
  emit(state, { type: 'shoot', element: el, x: mx, y: my, angle: p.angle });
}

function castNova(state) {
  const p = state.player;
  const el = p.element;
  const R = ULT.radius;
  const surge = p.blowSurge;
  p.blow = 0;
  p._surgeT = 0;
  p.blowSurge = 0;
  p.novaRush = PLAYER.novaRush;
  p.invuln = Math.max(p.invuln, ULT.invuln);
  state.stats.blowsUsed++;
  addEffect(state, 'nova', el, p.x, p.y, R, 0.6);
  emit(state, { type: 'blow', x: p.x, y: p.y, r: R, element: el });
  const dmg = ULT.damage * (1 + ULT.perWave * (state.wave - 1)) * (1 + ULT.surgeBonus * surge);
  const burnTime = ULT.burnTime * state._mods.burn;
  const victims = [];
  for (const e of state.enemies) {
    if (e._dead) continue;
    const rr2 = R + e.r;
    if (dist2(p.x, p.y, e.x, e.y) > rr2 * rr2) continue;
    knock(e, e.x - p.x, e.y - p.y, ULT.knockback * (el === 'air' ? 1.6 : 1));
    if (el === 'fire') applyBurn(state, e, burnTime, BLOWS.fire.burnDps * 1.5);
    else if (el === 'water') e.slow = Math.max(e.slow, ULT.slowTime);
    else if (el === 'earth') e.stun = Math.max(e.stun, ULT.stun * ENEMIES[e.type].stun);
    hurtEnemy(state, e, dmg, el, { noCharge: true });
    if (!e._dead) victims.push(e);
  }
  if (el === 'fire') {
    // the blaze jumps to anything standing right next to a burning victim
    for (const o of state.enemies) {
      if (o._dead || o.burn > 0) continue;
      for (const v of victims) {
        const rs = ULT.fireSpread + o.r + v.r;
        if (dist2(o.x, o.y, v.x, v.y) < rs * rs) {
          applyBurn(state, o, burnTime, BLOWS.fire.burnDps);
          break;
        }
      }
    }
  }
  scatter(state, p.x, p.y, R + 160, ULT.scatter);
  for (const pr of state.projectiles) {
    if (pr.owner === 'enemy' && dist2(p.x, p.y, pr.x, pr.y) < R * R) pr._dead = true;
  }
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------
function aiGrunt(state, e, dt, sm, ux, uy, d) {
  const def = ENEMIES.grunt;
  const sp = e._speed * sm;
  if (e._ai === 'lungeWind') {
    e._aiT -= dt;
    setWindup(e, 'lunge', 1 - e._aiT / def.lungeWindup);
    e._mx = ux * sp * 0.3;
    e._my = uy * sp * 0.3;
    e.angle = Math.atan2(uy, ux);
    if (e._aiT <= 0) {
      e._ai = 'lunge';
      e._aiT = def.lungeTime;
      e._dirX = ux;
      e._dirY = uy;
      clearWindup(e);
    }
    return;
  }
  if (e._ai === 'lunge') {
    e._aiT -= dt;
    e._mx = e._dirX * sp * def.lungeSpeed;
    e._my = e._dirY * sp * def.lungeSpeed;
    if (e._aiT <= 0) {
      e._ai = 'move';
      e._lungeCd = def.lungeCd * rr(state, 0.8, 1.3);
    }
    return;
  }
  e._lungeCd -= dt;
  // flank: approach from a per-grunt offset angle that closes as it gets near, so a group envelops
  // instead of forming one line; plus a light wobble
  const fl = e._flank * clamp((d - 70) / 260, 0, 1) + Math.sin(state.time * 1.3 + e._wob) * 0.2;
  const c = Math.cos(fl);
  const s = Math.sin(fl);
  e._mx = (ux * c - uy * s) * sp;
  e._my = (ux * s + uy * c) * sp;
  e.angle = Math.atan2(uy, ux);
  if (e._lungeCd <= 0 && state.wave >= def.lungeFromWave && d < def.lungeRange + e.r) {
    e._ai = 'lungeWind';
    e._aiT = def.lungeWindup;
    setWindup(e, 'lunge', 0);
  }
}

function aiSwarm(state, e, dt, sm, ux, uy, d) {
  const def = ENEMIES.swarm;
  const sp = e._speed * sm;
  const pk = e.pack ? SCRATCH.packs[e.pack] : null;
  const ps = e.pack ? state._packs[e.pack] : null;
  let dx;
  let dy;
  if (ps && ps.mode === 'orbit') {
    // circle the player at mid range until the whole pack commits
    dx = -uy * ps.side;
    dy = ux * ps.side;
    const radial = d > def.orbitR + 40 ? 0.9 : d < def.orbitR - 40 ? -0.9 : 0;
    dx += ux * radial;
    dy += uy * radial;
  } else {
    const w = Math.sin(state.time * 5 + e._wob) * 0.7 * clamp(d / 220, 0, 1);
    const c = Math.cos(w);
    const s = Math.sin(w);
    dx = ux * c - uy * s;
    dy = ux * s + uy * c;
  }
  if (pk && pk.n > 1) {
    // cohesion toward the pack centroid + alignment with the pack's heading: they move as a cloud
    const cx = pk.x / pk.n - e.x;
    const cy = pk.y / pk.n - e.y;
    const cd = Math.hypot(cx, cy) || 1;
    const coh = clamp((cd - 20) / 120, 0, 0.6);
    dx += (cx / cd) * coh;
    dy += (cy / cd) * coh;
    const al = Math.hypot(pk.vx, pk.vy) || 1;
    dx += (pk.vx / al) * 0.3;
    dy += (pk.vy / al) * 0.3;
  }
  const l = Math.hypot(dx, dy) || 1;
  e._mx = (dx / l) * sp;
  e._my = (dy / l) * sp;
  e.angle = Math.atan2(dy, dx);
}

/**
 * Per-step scratch for updateEnemies (rebuilt from scratch every step, so it carries no state
 * across steps and keeps the sim deterministic): swarm pack centroids and whether a brute is
 * in its recover window.
 */
const SCRATCH = { packs: {}, bruteRecover: false };

function prepareEnemies(state, dt) {
  const def = ENEMIES.swarm;
  const p = state.player;
  const packs = {};
  let bruteRecover = false;
  for (const e of state.enemies) {
    if (e._dead) continue;
    if (e.type === 'brute' && e._ai === 'recover') bruteRecover = true;
    if (!e.pack || e.spawnT > 0) continue;
    let pk = packs[e.pack];
    if (!pk) pk = packs[e.pack] = { n: 0, x: 0, y: 0, vx: 0, vy: 0, dmin: Infinity };
    pk.n++;
    pk.x += e.x;
    pk.y += e.y;
    pk.vx += e._mx;
    pk.vy += e._my;
    const dd = dist2(e.x, e.y, p.x, p.y);
    if (dd < pk.dmin) pk.dmin = dd;
  }
  SCRATCH.packs = packs;
  SCRATCH.bruteRecover = bruteRecover;
  // pack commit timers: approach -> orbit (orbitMin..orbitMax s) -> dive (diveTime) -> orbit ...
  const st = state._packs;
  for (const id in st) if (!packs[id]) delete st[id];
  for (const id in packs) {
    let ps = st[id];
    if (!ps) ps = st[id] = { mode: 'approach', t: 0, side: Number(id) % 2 ? 1 : -1 };
    if (ps.mode === 'approach') {
      if (packs[id].dmin < def.orbitEnter * def.orbitEnter) {
        ps.mode = 'orbit';
        ps.t = rr(state, def.orbitMin, def.orbitMax);
      }
      continue;
    }
    ps.t -= dt;
    if (ps.t <= 0) {
      if (ps.mode === 'orbit') {
        ps.mode = 'dive';
        ps.t = def.diveTime;
      } else {
        ps.mode = 'orbit';
        ps.t = rr(state, def.orbitMin, def.orbitMax);
      }
    }
  }
}

function aiSpitter(state, e, dt, sm, ux, uy, d) {
  const def = ENEMIES.spitter;
  const p = state.player;
  if (e._ai === 'windup') {
    e._aiT -= dt;
    setWindup(e, 'shoot', 1 - e._aiT / def.windup);
    e._mx = 0;
    e._my = 0;
    // predictive aim: lead a moving player (clamped so it stays dodgeable); the cue shows the real line
    e.angle = leadAngle(e, p, def.boltSpeed, def.lead * clamp(0.25 + 0.15 * (state.wave - 3), 0.25, 1));
    if (e._aiT <= 0) {
      const fan = state.wave >= def.spreadFromWave ? 3 : 1;
      let fired = false;
      for (let i = 0; i < fan; i++) {
        if (fireBolt(state, e, e.angle + (i - (fan - 1) / 2) * 0.22, def.boltSpeed, def.boltR)) fired = true;
      }
      if (fired) emit(state, { type: 'enemyShoot', x: e.x, y: e.y, element: e.element });
      e._ai = 'move';
      clearWindup(e);
      e._fireT = def.fireEvery * rr(state, 0.8, 1.25);
    }
    return;
  }
  e.angle = Math.atan2(uy, ux);
  // fire sooner at a sitting duck: a player standing still or busy punishing a recovering brute
  e._fireT -= dt * (p._stillT > 1 || SCRATCH.bruteRecover ? 1.8 : 1);
  let tx = 0;
  let ty = 0;
  let spMul = 1;
  if (d < def.keepMin) {
    tx = -ux;
    ty = -uy;
    // back off faster when the player holds the counter element and is closing in
    if (p.element === counterOf(e.element) && p.vx * ux + p.vy * uy < -40) spMul = 1.35;
  } else if (d > def.keepMax) {
    tx = ux;
    ty = uy;
  }
  // flank: drift out of the player's facing cone (toward whichever side gets out of it faster)
  const fx = Math.cos(p.angle);
  const fy = Math.sin(p.angle);
  let strafe = e._strafe;
  let sw = 0.7;
  if (-(fx * ux + fy * uy) > 0.75) {
    const side = -uy * fx + ux * fy;
    if (Math.abs(side) > 1e-3) strafe = side > 0 ? -1 : 1;
    sw = 0.95;
  }
  tx += -uy * strafe * sw;
  ty += ux * strafe * sw;
  // spread out from other spitters so they cannot be hit as one clump
  for (const o of state.enemies) {
    if (o === e || o._dead || o.type !== 'spitter') continue;
    const sx = e.x - o.x;
    const sy = e.y - o.y;
    const sd = Math.hypot(sx, sy);
    if (sd < def.spacing && sd > 1e-6) {
      tx += (sx / sd) * (1 - sd / def.spacing) * 1.2;
      ty += (sy / sd) * (1 - sd / def.spacing) * 1.2;
    }
  }
  // stay off the walls so it does not get pinned in a corner
  const mg = 70;
  if (e.x < mg) tx += 1;
  else if (e.x > W - mg) tx -= 1;
  if (e.y < mg) ty += 1;
  else if (e.y > H - mg) ty -= 1;
  if (random(state) < dt * 0.25) e._strafe *= -1;
  const l = Math.hypot(tx, ty) || 1;
  const sp = e._speed * sm * spMul;
  e._mx = (tx / l) * sp;
  e._my = (ty / l) * sp;
  if (e._fireT <= 0 && d < 760) {
    e._ai = 'windup';
    e._aiT = def.windup;
    setWindup(e, 'shoot', 0);
  }
}

function aiBrute(state, e, dt, sm, ux, uy, d) {
  const def = ENEMIES.brute;
  switch (e._ai) {
    case 'windup': {
      e._aiT -= dt;
      const prog = clamp(1 - e._aiT / def.windup, 0, 1);
      setWindup(e, 'charge', prog);
      if (prog < 0.7) {
        // aim at where the player is heading, but commit for the last 30% so it can be dodged
        const a = leadAngle(e, state.player, def.chargeSpeed, def.lead);
        e._dirX = Math.cos(a);
        e._dirY = Math.sin(a);
        e.angle = a;
      }
      e._mx = 0;
      e._my = 0;
      if (e._aiT <= 0) {
        e._ai = 'charge';
        e._aiT = def.chargeTime;
        e._chargeHit = false;
        clearWindup(e);
      }
      return;
    }
    case 'charge': {
      e._aiT -= dt;
      const sp = def.chargeSpeed * (sm < 1 ? 0.75 : 1);
      e._mx = e._dirX * sp;
      e._my = e._dirY * sp;
      if (e._aiT <= 0) {
        // a miss leaves it open longer (punish window); a hit lets it turn around sooner
        e._ai = 'recover';
        e._aiT = def.recover * (e._chargeHit ? def.recoverHit : def.recoverMiss);
      }
      return;
    }
    case 'guard': {
      // shield stance: face the player and plod forward; hurtEnemy halves frontal hits while guard > 0
      e._aiT -= dt;
      e.guard = clamp(e._aiT / 0.25, 0, 1);
      e.angle = Math.atan2(uy, ux);
      const sp = e._speed * sm * def.guardWalk;
      e._mx = ux * sp;
      e._my = uy * sp;
      if (e._aiT <= 0) {
        e._ai = 'move';
        e.guard = 0;
        e._guardCd = def.guardCd * rr(state, 0.8, 1.4);
      }
      return;
    }
    case 'recover': {
      e._aiT -= dt;
      e._mx = 0;
      e._my = 0;
      if (e._aiT <= 0) {
        e._ai = 'move';
        e._chargeCd = def.chargeCd * rr(state, 0.85, 1.2);
      }
      return;
    }
    default: {
      e._chargeCd -= dt;
      e._guardCd -= dt;
      const sp = e._speed * sm;
      e._mx = ux * sp;
      e._my = uy * sp;
      e.angle = Math.atan2(uy, ux);
      if (e._chargeCd <= 0 && d < def.chargeRange) {
        e._ai = 'windup';
        e._aiT = def.windup;
        setWindup(e, 'charge', 0);
        e._dirX = ux;
        e._dirY = uy;
        addEffect(state, 'telegraph', e.element, e.x, e.y, e.r + 14, def.windup, {
          angle: e.angle, len: def.chargeSpeed * def.chargeTime, _follow: e.id, _forAi: 'windup',
        });
      } else if (e._guardCd <= 0 && d > def.guardRange && state.player.element === counterOf(e.element)) {
        // the player holds its counter and keeps range: raise the shield and walk it in
        e._ai = 'guard';
        e._aiT = def.guardTime;
        e.guard = 1;
      }
    }
  }
}

// Wind-up bookkeeping. The contracted 'telegraph' field drives the renderer's charge lane /
// aim cue, so it only carries directional wind-ups (charge, shot, lunge). Area wind-ups (boss burst /
// summon) are shown by 'telegraph' effects instead; 'windup' + 'telegraphKind' carry all of them.
function setWindup(e, kind, prog) {
  const p = clamp(prog, 0, 1);
  e.telegraphKind = kind;
  e.windup = p;
  e.telegraph = kind === 'burst' || kind === 'summon' ? 0 : p;
}

function clearWindup(e) {
  e.telegraphKind = null;
  e.windup = 0;
  e.telegraph = 0;
}

function bossIdle(e) {
  e._ai = 'move';
  e._aiT = BOSS.idle[Math.min(e._phase, BOSS.idle.length - 1)];
  clearWindup(e);
}

function minionCount(state) {
  let n = 0;
  for (const o of state.enemies) if (!o._dead && o._minion) n++;
  return n;
}

function bossRing(state, e, offset) {
  const k = bossIndex(state.wave);
  const n = Math.min(BOSS.burstMax, BOSS.burstBase + 2 * e._phase + (k - 1));
  const sp = ENEMIES.boss.boltSpeed * (1 + 0.06 * e._phase);
  for (let i = 0; i < n; i++) fireBolt(state, e, offset + (i / n) * TAU, sp, ENEMIES.boss.boltR);
  emit(state, { type: 'enemyShoot', x: e.x, y: e.y, element: e.element, burst: true });
}

function bossSummon(state, e) {
  const count = 3 + e._phase;
  const room = BOSS.maxMinions - minionCount(state);
  const n = Math.min(count, room, CAPS.enemies - state.enemies.length);
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * TAU + random(state);
    const type = e._phase >= 1 && i === 0 ? 'grunt' : 'swarm';
    spawnEnemy(state, type, e.element, e.x + Math.cos(a) * (e.r + 34), e.y + Math.sin(a) * (e.r + 34), {
      minion: true,
    });
    state.waveInfo.total++;
  }
  emit(state, { type: 'enemyShoot', x: e.x, y: e.y, element: e.element, summon: true });
}

function bossChoose(state, e, d) {
  const opts = [['burst', 3]];
  if (minionCount(state) < BOSS.maxMinions - 2) opts.push(['summon', e._phase >= 1 ? 2 : 1.5]);
  opts.push(['charge', d > 380 ? 3 : 1.5]);
  if (e._phase >= 1) opts.push(['spiral', 2.2]);
  let sum = 0;
  for (const o of opts) {
    if (o[0] === e._lastPattern) o[1] *= 0.25;
    sum += o[1];
  }
  let roll = random(state) * sum;
  let choice = opts[0][0];
  for (const o of opts) {
    roll -= o[1];
    if (roll <= 0) {
      choice = o[0];
      break;
    }
  }
  e._lastPattern = choice;
  if (choice === 'burst') {
    e._ai = 'burstWind';
    e._aiT = BOSS.burstWindup;
    setWindup(e, 'burst', 0);
    addEffect(state, 'telegraph', e.element, e.x, e.y, e.r + 40, BOSS.burstWindup, { _follow: e.id, _forAi: 'burstWind' });
  } else if (choice === 'summon') {
    e._ai = 'summonWind';
    e._aiT = BOSS.summonWindup;
    setWindup(e, 'summon', 0);
    addEffect(state, 'telegraph', e.element, e.x, e.y, e.r + 60, BOSS.summonWindup, { _follow: e.id, _forAi: 'summonWind' });
  } else if (choice === 'charge') {
    e._ai = 'chargeWind';
    e._aiT = BOSS.chargeWindup;
    setWindup(e, 'charge', 0);
    addEffect(state, 'telegraph', e.element, e.x, e.y, e.r + 16, BOSS.chargeWindup, {
      angle: e.angle, len: BOSS.chargeSpeed * BOSS.chargeTime, _follow: e.id, _forAi: 'chargeWind',
    });
  } else {
    e._ai = 'spiral';
    e._aiT = BOSS.spiralTime;
    e._spiralCd = 0;
    e._spiralA = random(state) * TAU;
  }
}

function aiBoss(state, e, dt, sm, ux, uy, d) {
  const sp = e._speed * sm;
  switch (e._ai) {
    case 'burstWind':
      e._aiT -= dt;
      setWindup(e, 'burst', 1 - e._aiT / BOSS.burstWindup);
      e._mx = 0;
      e._my = 0;
      e.angle = Math.atan2(uy, ux);
      if (e._aiT <= 0) {
        e._ai = 'burst';
        e._rings = BOSS.burstRings + (e._phase >= 2 ? 1 : 0);
        e._aiT = 0;
        e._spiralA = random(state) * TAU;
        clearWindup(e);
      }
      return;
    case 'burst': {
      e._aiT -= dt;
      e._mx = 0;
      e._my = 0;
      if (e._aiT <= 0) {
        const k = bossIndex(state.wave);
        const n = Math.min(BOSS.burstMax, BOSS.burstBase + 2 * e._phase + (k - 1));
        bossRing(state, e, e._spiralA + (e._rings % 2) * (Math.PI / n));
        e._rings--;
        e._aiT = BOSS.burstGap;
        if (e._rings <= 0) bossIdle(e);
      }
      return;
    }
    case 'summonWind':
      e._aiT -= dt;
      setWindup(e, 'summon', 1 - e._aiT / BOSS.summonWindup);
      e._mx = 0;
      e._my = 0;
      if (e._aiT <= 0) {
        bossSummon(state, e);
        bossIdle(e);
      }
      return;
    case 'chargeWind': {
      e._aiT -= dt;
      const prog = clamp(1 - e._aiT / BOSS.chargeWindup, 0, 1);
      setWindup(e, 'charge', prog);
      if (prog < 0.7) {
        e._dirX = ux;
        e._dirY = uy;
        e.angle = Math.atan2(uy, ux);
      }
      e._mx = 0;
      e._my = 0;
      if (e._aiT <= 0) {
        e._ai = 'charge';
        e._aiT = BOSS.chargeTime;
        clearWindup(e);
      }
      return;
    }
    case 'charge':
      e._aiT -= dt;
      e._mx = e._dirX * BOSS.chargeSpeed;
      e._my = e._dirY * BOSS.chargeSpeed;
      if (e._aiT <= 0) {
        e._ai = 'recover';
        e._aiT = BOSS.chargeRecover;
      }
      return;
    case 'recover':
      e._aiT -= dt;
      e._mx = 0;
      e._my = 0;
      if (e._aiT <= 0) bossIdle(e);
      return;
    case 'spiral': {
      e._aiT -= dt;
      e._spiralCd -= dt;
      const arms = 2 + Math.max(0, e._phase - 1);
      while (e._spiralCd <= 0) {
        for (let i = 0; i < arms; i++) {
          fireBolt(state, e, e._spiralA + (i / arms) * TAU, ENEMIES.boss.boltSpeed * 0.9, ENEMIES.boss.boltR - 1);
        }
        e._spiralA += 0.37;
        e._spiralCd += BOSS.spiralRate;
      }
      e._mx = ux * sp * 0.35;
      e._my = uy * sp * 0.35;
      e.angle += dt * 4;
      if (e._aiT <= 0) bossIdle(e);
      return;
    }
    default: {
      // stalk: close in to mid range, then circle
      e._aiT -= dt;
      e.angle = Math.atan2(uy, ux);
      if (d > 230) {
        e._mx = ux * sp;
        e._my = uy * sp;
      } else {
        e._mx = -uy * sp * 0.6 * e._strafe;
        e._my = ux * sp * 0.6 * e._strafe;
      }
      if (e._aiT <= 0) bossChoose(state, e, d);
    }
  }
}

function checkBossPhase(state, e) {
  const th = BOSS.thresholds;
  if (e._phase >= th.length || e.hp / e.maxHp > th[e._phase]) return;
  while (e._phase < th.length && e.hp / e.maxHp <= th[e._phase]) e._phase++;
  const others = ELEMENTS.filter((x) => x !== e.element);
  e.element = pick(state, others);
  e.stun = 0;
  clearWindup(e);
  // shrug off the hit and answer with an immediate ring
  e._ai = 'burst';
  e._rings = 1;
  e._aiT = 0.3;
  e._spiralA = random(state) * TAU;
  dropPickup(state, 'heal', e.x, e.y + e.r);
  dropPickup(state, 'blow', e.x, e.y + e.r);
  emit(state, { type: 'bossPhase', x: e.x, y: e.y, element: e.element, phase: e._phase });
}

const AI = { grunt: aiGrunt, swarm: aiSwarm, spitter: aiSpitter, brute: aiBrute, boss: aiBoss };

function updateEnemies(state, dt) {
  const p = state.player;
  const kd = Math.exp(-7 * dt);
  prepareEnemies(state, dt);
  for (const e of state.enemies) {
    if (e._dead) continue;
    const def = ENEMIES[e.type];
    if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
    if (e._atkCd > 0) e._atkCd -= dt;
    if (e._fleeT > 0) e._fleeT = Math.max(0, e._fleeT - dt);

    if (e.burn > 0) {
      e.burn = Math.max(0, e.burn - dt);
      e._burnTick -= dt;
      if (e._burnTick <= 0) {
        e._burnTick += 0.4;
        hurtEnemy(state, e, e._burnDps * 0.4, 'fire', { dot: true });
        if (e._dead) continue;
      }
      if (e.burn === 0) e._burnDps = 0;
    }
    if (e.slow > 0) e.slow = Math.max(0, e.slow - dt);

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy);
    const ux = d > 1e-6 ? dx / d : 1;
    const uy = d > 1e-6 ? dy / d : 0;

    if (e.spawnT > 0) {
      e.spawnT = Math.max(0, e.spawnT - dt / e._spawnDur);
      e.vx = 0;
      e.vy = 0;
      e._kx = 0;
      e._ky = 0;
      e.angle = Math.atan2(uy, ux);
      continue;
    }

    e._kx *= kd;
    e._ky *= kd;
    if (Math.abs(e._kx) < 0.5) e._kx = 0;
    if (Math.abs(e._ky) < 0.5) e._ky = 0;

    if (e.stun > 0) {
      e.stun = Math.max(0, e.stun - dt);
      e._mx = 0;
      e._my = 0;
      if (e.type !== 'boss' && (e._ai === 'windup' || e._ai === 'charge')) {
        // a stun cancels wind-ups and charges
        e._ai = 'recover';
        e._aiT = 0.3;
        clearWindup(e);
      } else if (e._ai === 'lungeWind' || e._ai === 'lunge' || e._ai === 'guard') {
        e._ai = 'move';
        e.guard = 0;
        clearWindup(e);
      }
    } else if (e._fleeT > 0 && e._ai === 'move' && e.type !== 'boss') {
      // scatter (after a nova or a kill burst): back off at a slant, then the regular AI resumes
      const sm = e.slow > 0 ? def.slow : 1;
      const side = e._strafe * 0.5;
      const l = Math.hypot(1, side);
      const sp = (e._speed * sm * 1.15) / l;
      e._mx = (-ux - uy * side) * sp;
      e._my = (-uy + ux * side) * sp;
      e.angle = Math.atan2(uy, ux);
    } else {
      AI[e.type](state, e, dt, e.slow > 0 ? def.slow : 1, ux, uy, d);
    }

    e.vx = e._mx + e._kx;
    e.vy = e._my + e._ky;
    const nx = e.x + e.vx * dt;
    const ny = e.y + e.vy * dt;
    e.x = clamp(nx, e.r, W - e.r);
    e.y = clamp(ny, e.r, H - e.r);
    if ((e.x !== nx || e.y !== ny) && e._ai === 'charge') {
      // slammed into a wall: dazed
      e._ai = 'recover';
      e._aiT = (e.type === 'boss' ? BOSS.chargeRecover : def.recover) + 0.35;
    }

    // dash: phase through, nicking and shoving everything on the way (once per enemy per dash);
    // passing through a charging brute/boss counts as a perfect dodge
    if (p.dashing > 0) {
      const rs = e.r + p.r + 4;
      if (dist2(e.x, e.y, p.x, p.y) < rs * rs && !p._dashHit.includes(e.id)) {
        p._dashHit.push(e.id);
        knock(e, e.x - p.x, e.y - p.y, PLAYER.dashKnock);
        if (e._ai === 'charge') perfectDodge(state, e.x, e.y);
        hurtEnemy(state, e, PLAYER.dashDamage, p.element);
        if (e._dead) continue;
      }
    }

    // contact damage
    if (e.stun <= 0 && e._atkCd <= 0) {
      const rs = e.r + p.r + 2;
      if (dist2(e.x, e.y, p.x, p.y) < rs * rs) {
        let dmg = e._dmg;
        let kb = 260;
        if (e.type === 'brute') {
          if (e._ai === 'charge') kb = 620;
          else dmg *= 0.6;
        } else if (e.type === 'boss' && e._ai === 'charge') {
          dmg *= 1.3;
          kb = 720;
        }
        if (damagePlayer(state, dmg, e.x, e.y, kb, e.element)) {
          e._atkCd = def.contactCd;
          if (e.type === 'brute' && e._ai === 'charge') e._chargeHit = true;
        }
      }
    }
  }
}

function separate(state) {
  const es = state.enemies;
  const n = es.length;
  for (let i = 0; i < n; i++) {
    const a = es[i];
    if (a._dead) continue;
    const ma = ENEMIES[a.type].mass;
    for (let j = i + 1; j < n; j++) {
      const b = es[j];
      if (b._dead) continue;
      const rs = a.r + b.r;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx > rs || dx < -rs || dy > rs || dy < -rs) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rs * rs) continue;
      let d = Math.sqrt(d2);
      let nx;
      let ny;
      if (d < 1e-4) {
        const ang = (a.id * 2.399 + b.id * 0.7) % TAU;
        nx = Math.cos(ang);
        ny = Math.sin(ang);
        d = 0;
      } else {
        nx = dx / d;
        ny = dy / d;
      }
      const overlap = (rs - d) * 0.75;
      const mb = ENEMIES[b.type].mass;
      const tot = ma + mb;
      a.x -= nx * overlap * (mb / tot);
      a.y -= ny * overlap * (mb / tot);
      b.x += nx * overlap * (ma / tot);
      b.y += ny * overlap * (ma / tot);
    }
  }
  const p = state.player;
  for (const e of es) {
    if (e._dead) continue;
    if (p.dashing <= 0 && e.spawnT <= 0) {
      const rs = e.r + p.r;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rs * rs) {
        const d = Math.sqrt(d2);
        const nx = d > 1e-4 ? dx / d : 1;
        const ny = d > 1e-4 ? dy / d : 0;
        const overlap = rs - d;
        const me = ENEMIES[e.type].mass;
        const share = me / (me + PLAYER.mass); // how much the player gets shoved
        e.x += nx * overlap * (1 - share);
        e.y += ny * overlap * (1 - share);
        p.x -= nx * overlap * share;
        p.y -= ny * overlap * share;
      }
    }
    e.x = clamp(e.x, e.r, W - e.r);
    e.y = clamp(e.y, e.r, H - e.r);
  }
  p.x = clamp(p.x, p.r, W - p.r);
  p.y = clamp(p.y, p.r, H - p.r);
}

// ---------------------------------------------------------------------------
// Projectiles, effects, pickups
// ---------------------------------------------------------------------------
function firstEnemyHit(state, pr) {
  for (const e of state.enemies) {
    if (e._dead) continue;
    const rs = pr.r + e.r;
    if (dist2(pr.x, pr.y, e.x, e.y) < rs * rs) return e;
  }
  return null;
}

function explode(state, pr, direct) {
  const B = BLOWS.fire;
  const m = state._mods;
  const R = B.radius * m.fireRadius;
  const x = clamp(pr.x, 0, W);
  const y = clamp(pr.y, 0, H);
  addEffect(state, 'explosion', 'fire', x, y, R, 0.35);
  emit(state, { type: 'explosion', x, y, r: R, element: 'fire' });
  const burnTime = B.burnTime * m.burn;
  if (direct) {
    applyBurn(state, direct, burnTime, B.burnDps);
    knock(direct, pr.vx, pr.vy, 90);
    hurtEnemy(state, direct, pr._dmg, 'fire');
  }
  for (const e of state.enemies) {
    if (e._dead || e === direct) continue;
    const rs = R + e.r;
    if (dist2(x, y, e.x, e.y) > rs * rs) continue;
    applyBurn(state, e, burnTime, B.burnDps);
    knock(e, e.x - x, e.y - y, 120);
    hurtEnemy(state, e, pr._dmg * B.splash, 'fire');
  }
}

function updateProjectiles(state, dt) {
  const p = state.player;
  const m = state._mods;
  for (const pr of state.projectiles) {
    if (pr._dead) continue;
    pr.life -= dt;
    if (pr.kind === 'wave') {
      pr.r = Math.min(pr._rMax, pr.r + pr._grow * dt);
      const f = Math.exp(-0.9 * dt);
      pr.vx *= f;
      pr.vy *= f;
    }
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    const outside = pr.x < -pr.r || pr.x > W + pr.r || pr.y < -pr.r || pr.y > H + pr.r;

    if (pr.owner === 'enemy') {
      if (outside) {
        pr._dead = true;
        continue;
      }
      const rs = pr.r + p.r * 0.8;
      if (dist2(pr.x, pr.y, p.x, p.y) < rs * rs) {
        if (p.dashing > 0) {
          // perfect dodge: the bolt would have hit; it fizzles and feeds the meter instead
          pr._dead = true;
          perfectDodge(state, pr.x, pr.y);
          continue;
        }
        if (damagePlayer(state, pr._dmg, pr.x, pr.y, 140, pr.element)) {
          pr._dead = true;
          continue;
        }
      }
    } else if (pr.kind === 'fireball') {
      if (pr.x < 0 || pr.x > W || pr.y < 0 || pr.y > H) {
        explode(state, pr, null);
        pr._dead = true;
        continue;
      }
      const hit = firstEnemyHit(state, pr);
      if (hit) {
        explode(state, pr, hit);
        pr._dead = true;
        continue;
      }
    } else if (pr.kind === 'dart') {
      if (outside) {
        pr._dead = true;
        continue;
      }
      const hit = firstEnemyHit(state, pr);
      if (hit) {
        knock(hit, pr.vx, pr.vy, 25);
        hurtEnemy(state, hit, pr._dmg, 'air');
        pr._dead = true;
        continue;
      }
    } else if (pr.kind === 'wave') {
      if (outside) {
        pr._dead = true;
        continue;
      }
      const B = BLOWS.water;
      for (const e of state.enemies) {
        if (e._dead || pr._hit.includes(e.id)) continue;
        const rs = pr.r + e.r;
        if (dist2(pr.x, pr.y, e.x, e.y) >= rs * rs) continue;
        pr._hit.push(e.id);
        knock(e, pr.vx, pr.vy, B.knockback * m.waveKb);
        e.slow = Math.max(e.slow, B.slowTime);
        hurtEnemy(state, e, pr._dmg, 'water');
        if (pr._hit.length >= pr._pierce) {
          pr._dead = true;
          break;
        }
      }
      if (pr._dead) continue;
    }

    if (pr.life <= 0) {
      if (pr.kind === 'fireball') explode(state, pr, null);
      pr._dead = true;
    }
  }
}

function updateEffects(state, dt) {
  for (const f of state.effects) {
    f.life -= dt;
    if (f._follow) {
      const e = state.enemies.find((o) => o.id === f._follow);
      if (!e || e._dead || e._ai !== f._forAi) {
        f.life = 0;
      } else {
        // stay in sync with the wind-up (a stun pauses it)
        f.life = Math.max(0.001, Math.min(f.maxLife, e._aiT));
        f.x = e.x;
        f.y = e.y;
        if (f.angle !== undefined) f.angle = e.angle;
      }
    }
  }
}

function updatePickups(state, dt) {
  const p = state.player;
  const m = state._mods;
  const clearing = state._clearTimer > 0;
  const magnet = PLAYER.magnet + m.magnet;
  for (const k of state.pickups) {
    if (k._dead) continue;
    if (!clearing) k.life -= dt;
    if (k.life <= 0) {
      k._dead = true;
      continue;
    }
    const dx = p.x - k.x;
    const dy = p.y - k.y;
    const d = Math.hypot(dx, dy);
    if ((clearing || d < magnet) && d > 1e-6) {
      const sp = clearing ? PICKUPS.clearSpeed : PICKUPS.speed + (1 - d / magnet) * 400;
      const step = Math.min(d, sp * dt);
      k.x += (dx / d) * step;
      k.y += (dy / d) * step;
      k.vx = 0;
      k.vy = 0;
    } else {
      const f = Math.exp(-4 * dt);
      k.vx *= f;
      k.vy *= f;
      k.x = clamp(k.x + k.vx * dt, k.r, W - k.r);
      k.y = clamp(k.y + k.vy * dt, k.r, H - k.r);
    }
    const rs = p.r + k.r;
    if (dist2(p.x, p.y, k.x, k.y) < rs * rs) {
      k._dead = true;
      if (k.kind === 'heal') p.hp = Math.min(p.maxHp, p.hp + PICKUPS.heal * m.healBonus);
      else addBlow(state, PICKUPS.blow);
      emit(state, { type: 'pickup', x: k.x, y: k.y, kind: k.kind });
    }
  }
}

function updateCombo(state, dt) {
  if (state._comboTime > 0) {
    state._comboTime = Math.max(0, state._comboTime - dt);
    state.comboTimer = state._comboTime / COMBO.window;
  } else {
    state.comboTimer = 0;
    if (state._comboKills > 0) {
      state._comboDecay -= dt;
      if (state._comboDecay <= 0) {
        state._comboKills--;
        state._comboDecay = COMBO.decayStep;
      }
    }
  }
  state.combo = comboValue(state._comboKills);
}

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------
function upgradeCount(state, id) {
  const u = state.player.upgrades.find((x) => x.id === id);
  return u ? u.count : 0;
}

function rollUpgrades(state, n) {
  const pool = UPGRADES.filter((u) => upgradeCount(state, u.id) < u.max);
  const out = [];
  while (out.length < n && pool.length) {
    const u = pool.splice(ri(state, pool.length), 1)[0];
    out.push({ id: u.id, name: u.name, desc: u.desc, element: u.element, level: upgradeCount(state, u.id) + 1 });
  }
  return out;
}

function applyUpgradeEffect(state, id) {
  const p = state.player;
  const m = state._mods;
  switch (id) {
    case 'vitality':
      p.maxHp += 25;
      p.hp = Math.min(p.maxHp, p.hp + 25);
      break;
    case 'swift': m.speed += 0.08; break;
    case 'pyromancy': m.dmg.fire += 0.2; break;
    case 'tidecaller': m.dmg.water += 0.2; break;
    case 'stoneheart': m.dmg.earth += 0.2; break;
    case 'windborn': m.dmg.air += 0.2; break;
    case 'quickcast': m.cd *= 0.9; break;
    case 'phasestep':
      m.dashCd *= 0.85;
      p.dashCdMax = PLAYER.dashCd * m.dashCd;
      p.dashCd = Math.min(p.dashCd, p.dashCdMax);
      break;
    case 'overcharge': m.blowRate += 0.25; break;
    case 'inferno':
      m.fireRadius += 0.25;
      m.burn += 0.3;
      break;
    case 'riptide':
      m.wavePierce += 2;
      m.waveKb += 0.3;
      m.waveWidth += 0.15;
      break;
    case 'gale': m.darts += 1; break;
    case 'tremor':
      m.slamRadius += 0.2;
      m.stun += 0.25;
      break;
    case 'siphon': m.lifesteal += 0.5; break;
    case 'lodestone': m.magnet += 90; break;
    case 'barkskin': m.armor *= 0.92; break;
    case 'medic':
      m.healBonus += 0.5;
      m.healDrop += 0.5;
      break;
    default:
      return false;
  }
  return true;
}

export function applyUpgrade(state, upgradeId) {
  if (!state || state.phase !== 'upgrade') return false;
  const def = UPGRADE_BY_ID[upgradeId];
  if (!def || upgradeCount(state, upgradeId) >= def.max) return false;
  applyUpgradeEffect(state, upgradeId);
  const list = state.player.upgrades;
  const entry = list.find((u) => u.id === upgradeId);
  if (entry) entry.count++;
  else list.push({ id: def.id, name: def.name, count: 1 });
  state.upgradeChoices = [];
  state.phase = 'playing';
  emit(state, { type: 'upgrade', id: upgradeId });
  setupWave(state, state.wave + 1, WAVE.countdown);
  return true;
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------
export function update(state, input, dt) {
  state.events = [];
  if (state.phase !== 'playing') return;
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  const inp = normInput(input, state.player);
  state.time += dt;

  updateWave(state, dt);
  updatePlayer(state, inp, dt);
  updateEnemies(state, dt);
  separate(state);
  updateProjectiles(state, dt);
  updateEffects(state, dt);
  updatePickups(state, dt);
  updateCombo(state, dt);

  compact(state.enemies, (e) => !e._dead);
  compact(state.projectiles, (pr) => !pr._dead);
  compact(state.effects, (f) => f.life > 0);
  compact(state.pickups, (k) => !k._dead);

  checkWaveClear(state, dt);
  state.waveInfo.remaining = state.enemies.length + state._queue.length;
}

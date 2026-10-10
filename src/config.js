// Elemental Blow — shared constants + simulation tuning tables.
//
// Contract: render/ui code may import ONLY the four shared constants below.
// Everything after them is private tuning data for sim.js / main.js / tests.

// ---------------------------------------------------------------------------
// Shared constants (contract)
// ---------------------------------------------------------------------------
export const ARENA = { w: 1600, h: 900 };
export const ELEMENTS = ['fire', 'water', 'earth', 'air'];
export const ELEMENT_COLORS = { fire: '#ff6a3d', water: '#3da9ff', earth: '#8bd450', air: '#e8e6ff' };
export const BEATS = { water: 'fire', fire: 'air', air: 'earth', earth: 'water' }; // key beats value

// ---------------------------------------------------------------------------
// Simulation tuning (private)
// ---------------------------------------------------------------------------
export const STEP = 1 / 60;

export const PLAYER = {
  r: 18,
  maxHp: 100,
  speed: 280, // px/s
  accel: 16, // velocity response (1/s)
  mass: 5, // vs enemy masses when bodies overlap
  dashSpeed: 1000,
  dashTime: 0.16,
  dashInvuln: 0.3,
  dashCd: 1.1,
  hitInvuln: 0.7,
  hitFlash: 0.25,
  sameElementTaken: 0.5, // damage taken from an attacker of the player's current element
  magnet: 80, // pickup pull radius
  blowPerDamage: 0.1, // Blow meter per point of damage dealt (normalised by wave HP scale)
  blowPerKill: 2,
  startElement: 'fire',
  // dash "boost": a press up to this long before the cooldown ends still fires
  dashBuffer: 0.15,
  dashDamage: 6, // element-coloured nick dealt to every enemy phased through (once per enemy per dash)
  dashKnock: 220,
  perfectDodgeBlow: 8, // meter for a bolt or charge that would have hit during dash i-frames
  // surge: holding the meter full buys move speed now and a bigger nova later
  surgeSpeed: 0.06, // +6% move speed while the meter is at 100
  surgeCapTime: 15, // seconds at 100 for the full nova bonus (ULT.surgeBonus), +10% per 5 s
  novaRush: 1.5, // seconds of faster blow cooldowns after a nova
  novaRushCd: 0.15, // +15% cooldown speed during novaRush
};

// The four basic blows. Cooldowns in seconds.
export const BLOWS = {
  fire: { cooldown: 0.45, damage: 24, speed: 640, r: 9, range: 640, radius: 64, splash: 0.6, burnTime: 2.4, burnDps: 9 },
  water: { cooldown: 0.65, damage: 20, speed: 430, r: 24, grow: 22, range: 420, pierce: 4, knockback: 430, slowTime: 1.8 },
  earth: { cooldown: 0.85, damage: 48, reach: 56, radius: 74, stun: 0.7, knockback: 220 },
  air: { cooldown: 0.2, damage: 4, speed: 980, r: 5, range: 560, darts: 3, spread: 0.12 },
};

// The "Blow" ultimate nova.
export const ULT = {
  radius: 280,
  damage: 120,
  perWave: 0.08, // +8% damage per wave number
  knockback: 700,
  invuln: 0.6,
  burnTime: 3.5,
  slowTime: 3,
  stun: 1.4,
  surgeBonus: 0.3, // max damage bonus from holding the meter full (see PLAYER.surgeCapTime)
  fireSpread: 60, // a fire nova's burn jumps to enemies this close to a burning victim
  scatter: 0.6, // seconds nearby survivors flee after a nova or a 3-kill burst
};

// Enemy archetypes. hp/speed/dmg are wave-1 values, scaled per wave in sim.js.
//   mass: separation weight, kb: knockback taken multiplier,
//   stun/slow: how strongly those statuses apply (slow = speed factor while slowed).
export const ENEMIES = {
  grunt: {
    r: 16, hp: 40, speed: 100, dmg: 10, score: 10, cost: 1, mass: 1, kb: 1, stun: 1, slow: 0.5,
    spawnTime: 0.7, contactCd: 0.8, healDrop: 0.05, blowDrop: 0.05,
    // short lunge when close: telegraphed, then a speed burst; never before lungeFromWave
    lungeRange: 90, lungeWindup: 0.25, lungeTime: 0.3, lungeSpeed: 2.6, lungeCd: 3, lungeFromWave: 2,
  },
  swarm: {
    r: 9, hp: 12, speed: 170, dmg: 5, score: 4, cost: 0.4, mass: 0.35, kb: 1.4, stun: 1, slow: 0.5,
    spawnTime: 0.6, contactCd: 0.7, healDrop: 0.01, blowDrop: 0.03,
    // pack flocking: once the pack gets this close it orbits the player for orbitMin..orbitMax s, then dives
    orbitR: 170, orbitEnter: 300, orbitMin: 0.8, orbitMax: 1.4, diveTime: 2.2,
  },
  spitter: {
    r: 15, hp: 32, speed: 88, dmg: 6, score: 15, cost: 1.6, mass: 0.9, kb: 1.1, stun: 1, slow: 0.5,
    spawnTime: 0.7, contactCd: 0.8, healDrop: 0.07, blowDrop: 0.06,
    boltDmg: 9, boltSpeed: 300, boltR: 7, fireEvery: 2.4, windup: 0.6, keepMin: 260, keepMax: 430,
    spreadFromWave: 9, // from this wave on spitters fire a 3-bolt fan
    lead: 110, // max px the shot is aimed ahead of a moving player (keeps it dodgeable); 25% on wave 3, full from wave 8
    spacing: 160, // spitters push away from each other inside this distance
  },
  brute: {
    r: 28, hp: 170, speed: 55, dmg: 20, score: 40, cost: 4, mass: 4, kb: 0.3, stun: 0.6, slow: 0.65,
    spawnTime: 0.9, contactCd: 1.0, healDrop: 0.25, blowDrop: 0.2,
    chargeSpeed: 580, chargeTime: 0.6, windup: 0.95, chargeRange: 430, chargeCd: 3.4, recover: 0.8,
    lead: 120, // max px the charge is aimed ahead of a moving player
    recoverMiss: 1.2, recoverHit: 0.7, // recover time multiplier after a missed / landed charge
    // shield stance: when the player holds the counter element at range, face them and halve frontal damage
    guardTime: 1.2, guardCd: 6, guardRange: 200, guardWalk: 0.4,
  },
  boss: {
    r: 58, hp: 2800, speed: 60, dmg: 22, score: 500, cost: 0, mass: 30, kb: 0.08, stun: 0.25, slow: 0.8, // hp sized for the 1.5x "winded" windows
    spawnTime: 1.6, contactCd: 1.0, healDrop: 0, blowDrop: 0,
    boltDmg: 8, boltSpeed: 250, boltR: 9,
  },
};

export const BOSS = {
  hpPerBoss: 0.5, // +50% HP per later boss (wave 10 boss = 1.5x, wave 15 = 2x): patterns stack later, so HP grows gently
  dmgPerWave: 0.015, // boss contact + bolt + signature damage scale gentler than regular enemy damage
  firstBoss: 0.7, // damage multiplier for the first boss (wave 5): a learnable fight, not a wall
  windedContact: 0, // contact damage multiplier while winded: the weak-point window is safe to hug
  escort: { perBoss: 3, spitterEvery: 3 }, // later bosses bring (k - 1) * perBoss escorts, every spitterEvery-th a spitter
  preHeal: 0.4, // fraction of max HP restored when a boss wave is set up
  spawnY: 260, // boss arrival y (px from the top): clear of its own HP bar
  hudStrip: 170, // while stalking above this y the boss drifts down, so fights do not hang under the HUD
  thresholds: [0.66, 0.33], // element shifts
  idle: [1.7, 1.35, 1.05], // pause between patterns, per phase
  burstWindup: 0.75,
  burstGap: 0.32,
  burstRings: 2, // +1 in the last phase
  burstBase: 12, // bolts per ring, + 2 per phase, + burstPerBoss per later boss
  burstPerBoss: 2,
  burstMax: 30,
  summonWindup: 0.8,
  maxMinions: 10,
  chargeWindup: 0.95,
  chargeSpeed: 560,
  chargeTime: 0.75,
  chargeRecover: 0.7,
  spiralTime: 2.4,
  spiralRate: 0.11,
  drops: { heal: 3, blow: 2 }, // on death; every element shift also drops 1 heal + 1 blow orb
  // --- wind-ups: every boss wind-up shrinks a little per later boss, never below windupMin ---
  windupPerBoss: 0.08, // seconds taken off each wind-up per later boss (k = 2, 3, ...)
  windupMin: 0.6, // hard floor so every attack stays readable
  // --- signature patterns: one per element, used in addition to the shared burst / charge / summon / spiral ---
  signatureWindup: 0.9, // wind-up before a signature pattern fires
  signatureWeight: 3, // pattern-roll weight (burst is 3)
  winded: 1.2, // seconds the boss is "winded" (stands still, takes windedMult damage) after a signature pattern
  windedMult: 1.5,
  // fire: meteor rain. `count` ground circles (+perBoss per later boss, max countMax) land around the
  // player, biased `lead` seconds ahead of its velocity, detonate after `fuse` s in `radius` and leave a
  // burning patch (burnR px, burnLife s, burnDmg per tick; ticks are limited by the player's hit invulnerability).
  meteor: {
    count: 4, perBoss: 1, countMax: 9, fuse: 1.0, radius: 70, dmg: 16, kb: 320, lead: 0.5,
    spread: 190, spreadPer: 16, // scatter radius around the aim point: spread + spreadPer * count
    burnR: 55, burnLife: 1.5, burnDmg: 5, shock: 0.35,
  },
  // water: tide. Two wall segments sweep from the boss toward the player with a `gap` between them; one
  // wall is centred on the player, so the player has to sidestep (or dash through). half = half-length
  // of each wall (+perBossHalf per later boss, max halfMax), thick = wall thickness along its travel.
  tide: { speed: 250, half: 170, perBossHalf: 30, halfMax: 300, gap: 120, thick: 44, dmg: 16, kb: 820, maxLife: 5, shock: 0.5 },
  // earth: quake. The slam sends `rings` (+perBoss, max ringsMax) thin expanding ring hazards from the
  // boss, each `ringGap` s apart, each with a walkable gap of `gapW` radians; dashing through is a
  // perfect dodge. `pillars` stone pillars (pillarMin..pillarMax px from the boss) hurt on contact.
  quake: {
    rings: 3, perBoss: 1, ringsMax: 5, ringGap: 0.5, ringSpeed: 320, ringThick: 22, ringMaxR: 620, ringDmg: 14, ringKb: 380, gapW: 0.95,
    pillars: 5, pillarR: 26, pillarLife: 4, pillarRise: 0.3, pillarDmg: 10, pillarKb: 420, pillarMin: 140, pillarMax: 360, pillarClear: 110,
    shock: 0.8,
  },
  // air: gale. For `time` s the boss drags the player toward itself with `pull` px/s^2 (+perBoss, max
  // pullMax; the player's knockback decay turns that into a drift of about pull/9 px/s) while firing
  // `pairs` aimed bolt pairs `pairGap` s apart, each bolt `pairSpread` rad either side of the aim. A dash ignores the pull.
  gale: { time: 1.5, pull: 1800, perBoss: 250, pullMax: 2400, pairs: 3, pairGap: 0.45, pairSpread: 0.14, boltSpeed: 1.15 },
  // phase 2+: summon becomes "elemental echo": short-lived stationary spitter turrets in the boss's element
  echo: { count: 2, life: 6, windup: 0.8, range: 150 },
  // phase 3 ("enraged"): shorter idle, and patterns come in back-to-back pairs; chainEvery[k - 1] (the last entry
  // extends) says every how many-th pattern starts a pair: the first two bosses chain every other one, later ones all
  enrage: { idle: 0.7, shock: 0.8, chainEvery: [2, 2, 1] },
};

// Wave director. Regular waves spend a budget on bodies (ENEMIES[type].cost); the rest is the clock.
export const WAVE = {
  firstCountdown: 2.5,
  countdown: 3,
  clearDelay: 1.3,
  clearHeal: 15, // HP restored when a wave is cleared
  bossEvery: 5,
  // budget = budgetBase + budgetPerWave * (wave - 1); the wave right after a boss gets budget * breather
  budgetBase: 4,
  budgetPerWave: 4,
  breather: 0.8,
  maxPerWave: 140, // body cap per wave; budget that cannot be spent on bodies becomes HP, up to spongeCap
  spongeCap: 1.5,
  // per-wave enemy scaling (k = wave - 1): hp = 1 + hp*k + hpQuad*k^2, dmg = 1 + dmg*k,
  // speed = 1 + speedMax * (1 - exp(-speed*k/speedMax)) (a soft cap: never more than 1 + speedMax)
  scale: { hp: 0.14, hpQuad: 0.008, speed: 0.02, speedMax: 0.4, dmg: 0.07 },
  // simultaneous elements per wave, indexed by wave (the last entry extends): 2 on waves 1-2, 3 on 3-5, 4 from 6
  palette: [2, 2, 3, 3, 3, 4],
  // first wave each regular type can appear on, and how many of the rarer ones a wave may hold
  unlock: { swarm: 2, spitter: 3, brute: 4 },
  spitterSolo: 4, // at most 1 spitter per wave through this wave ...
  spitterPerWave: 1, // ... then the limit grows by this much per wave
  brutePer: 4, // brute limit = floor(wave / brutePer)
  swarmPack: { min: 4, extra: 3, per: 4, max: 10 }, // pack size = min + random(extra + floor(wave / per)), capped
  // spawn cadence: a group of 1 + floor(wave / groupEvery) spawns (max groupMax) every spawnInterval seconds
  spawnIntervalBase: 1.5,
  spawnIntervalPerWave: 0.05,
  spawnIntervalMin: 0.5,
  groupEvery: 3,
  groupMax: 5,
  aliveBase: 12, // alive cap = aliveBase + alivePerWave * wave (spawns pause above it)
  alivePerWave: 3,
  // pressure: when fewer enemies are alive than a spawn group holds, the next group comes after pressureInterval
  pressureInterval: 0.35,
  // mercy: below mercyHp of max HP on waves <= mercyUntil, spawn intervals stretch by mercySlow
  mercyUntil: 6,
  mercyHp: 0.3,
  mercySlow: 1.5,
};

export const PICKUPS = { r: 10, life: 10, heal: 20, blow: 25, speed: 420, clearSpeed: 1400 };

export const COMBO = { window: 2.5, perKill: 0.1, max: 5, decayStep: 0.08, superBonus: 1.5 };

export const CAPS = { enemies: 150, playerProjectiles: 220, enemyProjectiles: 320, effects: 100, pickups: 30 };

// Upgrades offered between waves (3 random choices, stackable up to `max`).
export const UPGRADES = [
  { id: 'vitality', name: 'Vitality', desc: '+25 max HP and heal 25', element: null, max: 99 },
  { id: 'swift', name: 'Fleet Foot', desc: '+8% move speed', element: null, max: 5 },
  { id: 'pyromancy', name: 'Pyromancy', desc: '+20% fire damage', element: 'fire', max: 6 },
  { id: 'tidecaller', name: 'Tidecaller', desc: '+20% water damage', element: 'water', max: 6 },
  { id: 'stoneheart', name: 'Stoneheart', desc: '+20% earth damage', element: 'earth', max: 6 },
  { id: 'windborn', name: 'Windborn', desc: '+20% air damage', element: 'air', max: 6 },
  { id: 'quickcast', name: 'Quickcast', desc: 'All blows recharge 10% faster', element: null, max: 6 },
  { id: 'phasestep', name: 'Phase Step', desc: 'Dash cooldown -15%', element: null, max: 4 },
  { id: 'overcharge', name: 'Overcharge', desc: 'Blow meter fills 25% faster', element: null, max: 6 },
  { id: 'inferno', name: 'Inferno', desc: 'Fireball blast radius +25%, burn lasts 30% longer', element: 'fire', max: 5 },
  { id: 'riptide', name: 'Riptide', desc: 'Waves pierce 2 more foes, +30% knockback, +15% width', element: 'water', max: 5 },
  { id: 'gale', name: 'Gale', desc: '+1 air dart per volley', element: 'air', max: 4 },
  { id: 'tremor', name: 'Tremor', desc: 'Slam radius +20%, stun +0.25s', element: 'earth', max: 5 },
  { id: 'siphon', name: 'Siphon', desc: 'Kills heal 0.5 HP each', element: null, max: 4 }, // per-kill healing scales with body count, so it stays small
  { id: 'lodestone', name: 'Lodestone', desc: 'Pickup magnet range +90', element: null, max: 4 },
  { id: 'barkskin', name: 'Bark Skin', desc: 'Take 8% less damage', element: null, max: 5 },
  { id: 'medic', name: 'Field Medic', desc: 'Heal orbs restore 50% more and drop more often', element: null, max: 3 },
];

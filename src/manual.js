// Elemental Blow — the in-game field manual (Manual button on the menu and pause screens, H key).
//
// manualHTML() is a pure string builder (the node tests import it); createManual() mounts it as an
// overlay inside #ui. The numbers come from the tuning tables, so the manual follows a rebalance.
// The rules described in the prose mirror sim.js: when a mechanic changes there, update it here too.

import {
  ELEMENTS, ELEMENT_COLORS, BEATS, PLAYER, BLOWS, ULT, ENEMIES, BOSS, WAVE, PICKUPS, COMBO, UPGRADES,
} from './config.js';
import { elementMultiplier, waveScale } from './sim.js';

const NAMES = { fire: 'Fire', water: 'Water', earth: 'Earth', air: 'Air' };
const DARK = { fire: '#3a130b', water: '#0d2338', earth: '#1b2b10', air: '#26253a' }; // render.js body fill
const COUNTER = Object.fromEntries(Object.entries(BEATS).map(([a, b]) => [b, a])); // COUNTER[x] beats x
const HOSTILE = '#ff2d4a';
const GOLD = '#ffd84d';

// Rules that live in sim.js code rather than in the config tables.
const SIM = {
  waveDrag: 0.9, // a water wave slows by exp(-0.9 t)
  burnTick: 0.4, // seconds between burn ticks
  novaFireBurn: 1.5, // fire nova burn dps, x the fireball's
  novaAirKnock: 1.6, // air nova knockback multiplier
  novaScatter: 160, // nova scatter reaches this far past the nova radius
  burstRange: 300, // a 3-kill burst inside 1 s scatters enemies this close to the player
  spawnClear: 380, // spawn points keep at least this far from the player when they can
  bruteWalkTouch: 0.6, // brute touch damage while not charging
  bossChargeTouch: 1.3, // Titan touch damage while charging
  chargeLock: 0.7, // charges track the player for this share of the wind-up, then lock
  wallDaze: 0.35, // extra recovery after a charge ends in a wall
  spitterPunish: 1.8, // spitter fire-rate boost vs a still player or while a brute recovers
  spitterAimCone: Math.round((Math.acos(0.75) * 180) / Math.PI), // spitters slide out of this aim cone
  scorePerWave: 0.1, // kill score +10% per wave after the first
  dashCarry: 0.3, // share of dash speed kept when it ends
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
/** Trim a number for prose: 0.30 -> "0.3", 159.99 -> "160". */
const n = (v, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d);
const sec = (v) => `${n(v)}&nbsp;s`;
const pct = (v) => `${n(v * 100, 1)}%`;
const px = (v) => `${n(v, 0)}&nbsp;px`;
const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');
const el = (e) => `<span class="m-el" style="--c:${ELEMENT_COLORS[e]}">${NAMES[e]}</span>`;
const go = (id, text) => `<a class="m-link" href="#m-${id}" data-goto="${id}">${text}</a>`;
const mult = (m) => (m === 2 ? '2×' : m === 1 ? '1×' : '½×');
/** head: column titles, or null for a two-column label / value table. */
const table = (head, rows, cls = '') =>
  `<div class="m-scroll"><table class="m-table ${cls}">${head ? `<thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead>` : ''}`
  + `<tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const tip = (title, body) => `<div class="m-tip"><b>${title}</b> ${body}</div>`;

// ---------------------------------------------------------------------------
// Derived numbers
// ---------------------------------------------------------------------------
const dashDist = PLAYER.dashSpeed * PLAYER.dashTime;
const dashCdMin = PLAYER.dashCd * 0.85 ** UPGRADES.find((u) => u.id === 'phasestep').max;
const novaDmg = (w) => ULT.damage * (1 + ULT.perWave * (w - 1));
const waveReach = BLOWS.water.speed / SIM.waveDrag * (1 - Math.exp(-SIM.waveDrag * BLOWS.water.range / BLOWS.water.speed));
const bossHp = (i) => ENEMIES.boss.hp * (1 + BOSS.hpPerBoss * (i - 1));
const comboKillsMax = Math.round((COMBO.max - 1) / COMBO.perKill);
const groupAt = (w) => Math.min(WAVE.groupMax, 1 + Math.floor(w / WAVE.groupEvery));
// a gale pair flies either side of the aim; beyond this range both bolts clear the predicted spot
const galeSplit = (ENEMIES.boss.boltR + PLAYER.r * 0.8) / Math.sin(BOSS.gale.pairSpread);

// ---------------------------------------------------------------------------
// Little inline SVG figures (the game's own shapes and colours)
// ---------------------------------------------------------------------------
let gid = 0;
function glow(c, r, a, cx = 0, cy = 0) {
  const id = `mg${++gid}`;
  return `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${a}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`;
}
function avatar(e, cls = '') {
  const c = ELEMENT_COLORS[e];
  return `<g class="${cls}"><line x1="5" y1="9" x2="26" y2="4" stroke="#cfd2e8" stroke-width="3.2" stroke-linecap="round"/>`
    + `<circle cx="27" cy="3.5" r="4.2" fill="${c}"/><circle r="16" fill="#1c1f33" stroke="${c}" stroke-width="3"/>`
    + `<circle cx="-1.6" r="9.9" fill="${DARK[e]}"/><circle cx="-1.6" r="5.1" fill="${c}"/>`
    + '<path d="M15.2 0L7.2-6.4V6.4z" fill="#fff"/></g>';
}
function motes(e, a = 1) {
  const c = ELEMENT_COLORS[e];
  let s = `<g class="m-spin" opacity="${a}"><circle r="34" fill="none"/>`;
  for (let i = 0; i < 3; i++) {
    const t = ((i * 120 - 90) * Math.PI) / 180;
    s += glow(c, 7, 0.8, n(27 * Math.cos(t)), n(27 * Math.sin(t)));
  }
  return s + '</g>';
}
function arcPath(r, deg) {
  const t = ((deg - 90) * Math.PI) / 180;
  return `M0 ${-r}A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${n(r * Math.cos(t))} ${n(r * Math.sin(t))}`;
}
function grunt(e, x = 0, y = 0, a = 1) {
  const c = ELEMENT_COLORS[e];
  return `<g transform="translate(${x} ${y})" opacity="${a}"><circle r="14" fill="${DARK[e]}" stroke="${c}" stroke-width="2.6"/>`
    + `<circle cx="-3.5" r="5" fill="${c}" opacity=".85"/><circle cx="6.3" cy="-3.9" r="1.9" fill="#fff"/><circle cx="6.3" cy="3.9" r="1.9" fill="#fff"/></g>`;
}
function brute(e, x = 0, y = 0) {
  const c = ELEMENT_COLORS[e];
  let pts = '';
  for (let i = 0; i < 8; i++) {
    const t = ((i * 45 + 22.5) * Math.PI) / 180;
    pts += `${n(20 * Math.cos(t))},${n(20 * Math.sin(t))} `;
  }
  return `<g transform="translate(${x} ${y})"><circle cx="-2" cy="-19" r="7.6" fill="${DARK[e]}" stroke="${c}" stroke-width="2.6"/>`
    + `<circle cx="-2" cy="19" r="7.6" fill="${DARK[e]}" stroke="${c}" stroke-width="2.6"/>`
    + `<path d="M14-11L26-6V6L14 11z" fill="${DARK[e]}" stroke="${c}" stroke-width="2.6" stroke-linejoin="round"/>`
    + `<polygon points="${pts.trim()}" fill="${DARK[e]}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>`
    + `<rect x="3" y="-2" width="11" height="4" fill="${c}"/></g>`;
}
const fig = (svg, title, text, half = 60) =>
  `<figure class="m-fig"><svg viewBox="${-half} ${-half} ${half * 2} ${half * 2}" aria-hidden="true">${svg}</svg><figcaption><b>${title}</b>${text}</figcaption></figure>`;

function playerFigures() {
  return `<div class="m-figs">${[
    fig(glow(ELEMENT_COLORS.fire, 50, 0.35) + motes('fire') + avatar('fire'),
      'Your element', `Body outline, glow, staff tip and the three small orbiting lights all show the element you hold. The lights are only that: an element indicator. The white visor points where you aim.`, 44),
    fig(glow(ELEMENT_COLORS.water, 50, 0.3) + motes('water', 0.6) + avatar('water')
      + `<path d="${arcPath(24, 250)}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>`,
      'Thin white arc: recharging', `Your current element's blow is on cooldown. The arc grows clockwise from the top; when the circle closes it vanishes and you can fire again.`, 44),
    fig(glow(ELEMENT_COLORS.earth, 50, 0.3) + glow('#ffffff', 36, 0.45) + motes('earth', 0.6) + avatar('earth')
      + `<circle class="m-pulse" r="34" fill="none" stroke="${GOLD}" stroke-width="2.6"/>`,
      'Pulsing gold ring: nova ready', `The Blow meter is full: ${k('Space')} fires the nova. A white glow growing inside the ring is the surge bonus for holding it (see ${go('nova', 'Blow meter &amp; nova')}).`, 44),
    fig(glow(ELEMENT_COLORS.air, 50, 0.35) + motes('air', 0.6) + avatar('air')
      + '<circle r="24" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2.2"/>',
      'Full white ring: nova rush', `Shown for ${sec(PLAYER.novaRush)} after a nova, fading: all four blows recharge ${pct(PLAYER.novaRushCd)} faster.`, 44),
    fig(glow(ELEMENT_COLORS.fire, 50, 0.3) + motes('fire', 0.6) + avatar('fire', 'm-blink'),
      'Blinking: invulnerable', `After taking a hit you can't be hurt for ${sec(PLAYER.hitInvuln)}; after a nova for ${sec(ULT.invuln)}; and for a moment after a dash ends.`, 44),
    fig(`${glow(ELEMENT_COLORS.water, 15, 0.25, -31, 0)}<circle cx="-31" r="11" fill="${ELEMENT_COLORS.water}" opacity=".18"/>`
      + `${glow(ELEMENT_COLORS.water, 20, 0.35, -15, 0)}<circle cx="-15" r="13" fill="${ELEMENT_COLORS.water}" opacity=".32"/>`
      + `<g transform="translate(5 0) scale(1.2 .85)">${avatar('water')}</g>`,
      'Afterimages: dashing', `You are mid-dash: invulnerable and passing through enemies (see ${go('dash', 'Dash')}).`, 44),
  ].join('')}</div>`;
}

function arenaFigures() {
  const red = (x) => `stroke="${HOSTILE}" ${x || ''}`;
  let lane = `<rect x="-26" y="-14" width="78" height="28" fill="${HOSTILE}" opacity=".16"/>`
    + `<rect x="-26" y="-14" width="52" height="28" fill="${HOSTILE}" opacity=".3"/>`
    + `<rect x="-26" y="-14" width="78" height="28" fill="none" ${red('stroke-width="2" stroke-dasharray="5 5"')}/>`
    + `<path d="M58 0L46-10V10z" fill="${HOSTILE}"/>`;
  lane = `<g transform="translate(4 0)">${lane}</g>${brute('earth', -30, 0)}`;
  const spikes = (r1, r2) => {
    let d = '';
    for (let i = 0; i < 12; i++) {
      const t = (i * 30 * Math.PI) / 180;
      const r = i % 2 ? r1 : r2;
      d += `${i ? 'L' : 'M'}${n(r * Math.cos(t))} ${n(r * Math.sin(t))}`;
    }
    return d + 'z';
  };
  let starPts = '';
  for (let i = 0; i < 8; i++) {
    const t = ((i * 45 - 90) * Math.PI) / 180;
    const r = i % 2 ? 4 : 10;
    starPts += `${i ? 'L' : 'M'}${n(r * Math.cos(t))} ${n(r * Math.sin(t))}`;
  }
  return `<div class="m-figs">${[
    fig(`${glow(HOSTILE, 34, 0.3)}<circle r="27" fill="none" ${red('stroke-width="3"')}/>${grunt('fire')}`
      + `<path d="M23-7L29 0L23 7" fill="none" ${red('stroke-width="2.5" stroke-linecap="round"')}/>`,
      'Red ring closing in: wind-up', 'A grunt about to lunge or a spitter about to shoot (brutes and the Titan show one too while winding up a charge). The ring shrinks onto the body; the attack comes when it arrives. Grunts also show a red chevron, spitters aim their barrel at the real line of fire.'),
    fig(lane, 'Red lane with an arrow: charge', 'A brute or Titan charge, as long and wide as the rush (a slowed brute stops at three quarters of it). It tracks you at first, then locks; the attack follows the lane.'),
    fig(`<circle r="44" fill="${HOSTILE}" opacity=".08"/><circle r="26" fill="${HOSTILE}" opacity=".3"/>`
      + `<circle r="44" fill="none" ${red('stroke-width="3" stroke-dasharray="6 6"')}/><circle r="40" fill="none" stroke="${ELEMENT_COLORS.water}" stroke-width="2" opacity=".7"/>`,
      'Dashed red circle filling up: area attack', 'The Titan winding up a burst, summon or signature, or a meteor or pillar about to land. It triggers when the fill reaches the dashed edge.'),
    fig(`${brute('air', -8, 0)}<path d="M7.5-26.85A31 31 0 0 1 7.5 26.85L2.5 18.19A21 21 0 0 0 2.5-18.19z" fill="${ELEMENT_COLORS.air}" opacity=".25"/>`
      + `<path d="M7.6-27A31 31 0 0 1 7.6 27" fill="none" stroke="${ELEMENT_COLORS.air}" stroke-width="4" stroke-linecap="round"/>`,
      'Glowing arc in front of a brute: shield', `Your hits do half damage (BLOCKED) until it drops. It raises it when you hold its counter element from range (see ${go('enemies', 'Enemies')}).`),
    fig(`${glow(ELEMENT_COLORS.fire, 30, 0.45)}<circle r="22" fill="none" stroke="${ELEMENT_COLORS.fire}" stroke-width="3"/>${grunt('water', 0, 0, 0.45)}`,
      'Shrinking coloured ring at the edge: spawn', `An enemy materialising. It can't move or touch you yet, but your blows already hit it (the Titan excepted).`),
    fig(`${glow(HOSTILE, 22, 0.7)}<path d="${spikes(7, 14)}" fill="#1a0408" ${red('stroke-width="2.4" stroke-linejoin="round"')}/>`
      + `<circle r="8" fill="#1a0408" ${red('stroke-width="2.4"')}/><circle r="4.4" fill="${ELEMENT_COLORS.earth}"/>`,
      'Red spiky ball: enemy bolt', 'The coloured core is the shooter\'s element: hold that element and the bolt only does half.'),
    fig(`${grunt('air', 0, 6)}${glow('#ff8a30', 10, 0.9, -4, -14)}${glow('#ff8a30', 8, 0.7, 5, -22)}${glow('#ff8a30', 6, 0.5, -1, -30)}`,
      'Rising orange flames: burning', `Takes fire damage every ${sec(SIM.burnTick)} until it goes out.`),
    fig(`${glow(ELEMENT_COLORS.water, 26, 0.3)}${grunt('fire')}<circle r="19" fill="none" stroke="#8fd4ff" stroke-width="2" stroke-dasharray="5 5"/>`,
      'Dashed blue ring: slowed', `Moves at about half speed (brutes ${pct(ENEMIES.brute.slow)}, the Titan ${pct(ENEMIES.boss.slow)}).`),
    fig(`${grunt('earth', 0, 8)}${glow('#ffe14d', 6, 1, -10, -14)}${glow('#ffe14d', 6, 1, 0, -18)}${glow('#ffe14d', 6, 1, 10, -14)}`,
      'Yellow sparks over the head: stunned', 'Frozen, its current wind-up is interrupted (the Titan\'s only paused), and touching it does no damage.'),
    fig(`${glow('#5dff9a', 28, 0.5, -20, 0)}<circle cx="-20" r="10" fill="#10151c" stroke="#5dff9a" stroke-width="2.5"/>`
      + '<rect x="-22.2" y="-6" width="4.4" height="12" fill="#5dff9a"/><rect x="-26" y="-2.2" width="12" height="4.4" fill="#5dff9a"/>'
      + `${glow(GOLD, 28, 0.5, 20, 0)}<circle cx="20" r="10" fill="#10151c" stroke="${GOLD}" stroke-width="2.5"/>`
      + `<path transform="translate(20 0)" d="${starPts}z" fill="${GOLD}"/>`,
      'Orbs: green heals, gold charges', `Green cross: +${PICKUPS.heal} HP. Gold star: +${PICKUPS.blow} Blow. They blink before they vanish (see ${go('pickups', 'Health &amp; orbs')}).`),
  ].join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function secFaq() {
  return `<p class="m-lead">The short answers to what the game never explains. Each one links to the full rules further down.</p>
<div class="m-qa"><p class="m-q">Is the dash just a quick jump?</p>
<p>No, it is your main defensive tool. It carries you ${px(dashDist)} in ${sec(PLAYER.dashTime)} and makes you invulnerable for ${sec(PLAYER.dashInvuln)}. You pass straight through enemies, nick each one you cross for ${PLAYER.dashDamage} damage of your current element (${PLAYER.dashDamage * 2} with the counter) and shove it aside. An enemy bolt, a charging brute or Titan, a meteor, a tide wall or a quake ring that would have hit you mid-dash is a <b>perfect dodge</b>: PERFECT pops up, your Blow meter gains ${PLAYER.perfectDodgeBlow}, and a bolt fizzles out. The Titan's gale can't pull you while you dash. ${go('dash', 'Full dash rules')}</p></div>
<div class="m-qa"><p class="m-q">What is the circle around my character?</p>
<p>It depends on the circle. The <b>thin white arc</b> that grows clockwise is your current blow recharging; it disappears when you can fire. The <b>pulsing gold ring</b> means the Blow meter is full and ${k('Space')} fires the nova. A <b>full white ring</b> right after a nova is nova rush (faster recharges for ${sec(PLAYER.novaRush)}). The three small <b>orbiting lights</b> only show your element. ${go('you', 'All player cues, with pictures')}</p></div>
<div class="m-qa"><p class="m-q">Why do some damage numbers look different?</p>
<p>Big, in the element's colour with a "!": 2× damage, you used the counter. White: normal. Small grey: ½×, wrong element. BLOCKED: a brute's shield ate half. Red numbers are damage you took; a smaller pale violet one with RESIST was halved because you held the attacker's element. ${go('arena', 'Every pop-up')}</p></div>
<div class="m-qa"><p class="m-q">Does my element matter for defence?</p>
<p>Yes. Like resists like: anything of the element you hold (bodies, bolts, Titan hazards) deals half damage to you. Holding the counter is offence; holding the attacker's own element is defence. ${go('elements', 'Elements')}</p></div>
<div class="m-qa"><p class="m-q">What does red mean?</p>
<p>Danger. Enemy bolts, attack lanes, dashed warning circles and boss hazards are all drawn in hostile red. A red ring shrinking onto an enemy means it is about to attack. ${go('arena', 'Reading the arena')}</p></div>
<div class="m-qa"><p class="m-q">What does the nova actually do?</p>
<p>${ULT.damage} damage (+${pct(ULT.perWave)} per wave) in a ${px(ULT.radius)} circle, heavy knockback, ${sec(ULT.invuln)} of invulnerability, and it wipes out enemy bolts around you. It obeys the element rule (a counter nova does 2×) and adds burn (${el('fire')}), slow (${el('water')}), stun (${el('earth')}) or extra knockback (${el('air')}). ${go('nova', 'Blow meter &amp; nova')}</p></div>
<div class="m-qa"><p class="m-q">Why did the boss turn yellow and crack?</p>
<p>It is <b>winded</b> after a signature attack: for ${sec(BOSS.winded)} it stands still, takes ${BOSS.windedMult}× damage and touching it is harmless. Unload everything. ${go('boss', 'The Titan')}</p></div>`;
}

function secYou() {
  return `<p class="m-lead">Every ring and glow around your character means something. These are drawn at the size the game draws them, relative to your body.</p>
${playerFigures()}
<h4>Short flashes around you</h4>
${table(['You see', 'It means'], [
    ['A ring in an element colour', 'You switched to that element.'],
    ['A burst in your colour, then afterimages', 'You dashed.'],
    ['Small gold and white rings, <span class="m-num" style="color:#ffd84d">PERFECT</span>', `Perfect dodge: +${PLAYER.perfectDodgeBlow} Blow.`],
    ['A big gold ring and a BLOW READY banner', 'The meter just reached 100 (the banner skips itself while a wave banner is showing).'],
    ['A small red ring and a little shake', `${k('Space')} pressed without a full meter.`],
    ['A green or gold ring where you stand', 'You collected an orb.'],
    ['A red flash and a red number', 'You were hit.'],
    ['A red border pulsing around the screen', 'HP below 30%.'],
  ])}`;
}

function secArena() {
  return `<p class="m-lead">The same visual language everywhere: <b style="color:${HOSTILE}">red is a threat</b>, an enemy's colour is its element, white and gold are yours.</p>
${arenaFigures()}
<h4>Floating numbers</h4>
${table(['Looks like', 'Meaning'], [
    [`<span class="m-num" style="color:${ELEMENT_COLORS.fire};font-size:1.35em">48!</span>`, '2× damage: your element beats the target.'],
    ['<span class="m-num" style="color:#fff;font-size:1.1em">24</span>', '1×, neutral.'],
    ['<span class="m-num" style="color:#9a9aa8;font-size:.85em">12</span>', '½×: the target resists that element.'],
    ['<span class="m-num" style="color:#9a9aa8;font-size:.85em">BLOCKED</span>', 'A shielded brute halved a frontal hit.'],
    ['<span class="m-num" style="color:#ff4a5e;font-size:1.25em">-12</span>', 'Damage you took.'],
    ['<span class="m-num" style="color:#9d93c4;font-size:1.05em">-6 RESIST</span>', 'Damage you took, halved because you hold the attacker\'s element.'],
    [`<span class="m-num" style="color:${GOLD};font-size:1.2em">PERFECT</span>`, `Perfect dodge during a dash: +${PLAYER.perfectDodgeBlow} Blow.`],
    ['<span class="m-num" style="color:#ffe14d;font-size:1.15em">WINDED!</span>', `The Titan's weak window: ${BOSS.windedMult}× damage for ${sec(BOSS.winded)}.`],
    [`<span class="m-num" style="color:${HOSTILE};font-size:1.25em">ENRAGED</span>`, 'The Titan entered its last phase.'],
  ])}
<p>Enemy health bars appear above an enemy once it has taken damage. An enemy that flashes white was just hit.</p>`;
}

function secHud() {
  return table(['Where', 'What it tells you'], [
    ['Top left: HP', 'Current / max HP. The pale trail is damage you just took. The bar pulses below 30%.'],
    ['Top left: BLOW', `The nova meter. At 100% it reads READY with ${k('Space')} UNLEASH beside it. Held full, the hint becomes SURGE +x% and a white core grows in the bar. A white-hot border right after a nova is nova rush.`],
    ['Top centre', 'Wave number (BOSS WAVE every 5th). During the countdown: NEXT WAVE IN n. During the wave: remaining / total foes, counting the ones still to arrive; Titan summons add to the total.'],
    ['Top right', 'Score, and once you chain kills, the combo multiplier with a bar showing how long you have to extend it.'],
    ['Bottom: element slots', `Key, name, and "2× X": the element this one beats. The raised, lit slot is the one you hold. A dark sweep over a slot is that element's own cooldown: all four recharge at the same time.`],
    ['Bottom: DASH', 'Dark sweep while recharging; glows cyan when ready.'],
    ['Boss bar', 'Titan HP and its current element (the counter is the element that beats it). A white trail shows recent damage. It turns see-through while you or the Titan are close under it.'],
  ]) + '<p>HUD panels fade while you stand beneath them, so they never hide enemies.</p>';
}

function secElements() {
  const head = ['Your attack ↓ / target →', ...ELEMENTS.map(el)];
  const rows = ELEMENTS.map((a) => [el(a), ...ELEMENTS.map((t) => {
    const m = elementMultiplier(a, t);
    return `<span class="m-x m-x${m === 2 ? 2 : m === 1 ? 1 : 0}">${mult(m)}</span>`;
  })]);
  return `<p class="m-lead">The cycle: ${el('water')} beats ${el('fire')} beats ${el('air')} beats ${el('earth')} beats ${el('water')}.</p>
${table(head, rows, 'm-matrix')}
<ul>
<li><b>2×</b> when your element beats the target's. <b>½×</b> when it's the same element, or when the target's element beats yours. <b>1×</b> for the two unrelated pairs (${el('fire')}/${el('earth')} and ${el('water')}/${el('air')}).</li>
<li>It applies to everything you deal: blows, splash, every burn tick (burn is ${el('fire')} damage), dash nicks and the nova.</li>
<li>A kill whose last hit was 2× is a <b>super kill</b>: +${pct(COMBO.superBonus - 1)} score and double the Blow meter for the kill.</li>
<li><b>Defence:</b> an attack of the element you currently hold deals ${pct(PLAYER.sameElementTaken)} damage to you (RESIST). Only the exact match protects you; holding the counter does not.</li>
<li>What carries which element: bodies and bolts use their enemy's. The Titan's meteors and burning ground are ${el('fire')}, quake rings and stone pillars are ${el('earth')}, tide walls and gale bolts carry the Titan's element.</li>
<li>Waves mix 2 elements on waves 1-2, 3 on waves 3-5 and all four from wave 6. A swarm pack always shares one element.</li>
</ul>
${tip('Offence or defence.', 'When a big hit is coming and you can\'t avoid it (a charge into a corner, a ring of bolts), switch to the attacker\'s element for that moment to halve it, then switch back to the counter to kill.')}`;
}

function secBlows() {
  const F = BLOWS.fire, Wt = BLOWS.water, E = BLOWS.earth, A = BLOWS.air;
  const dps = (dmg, cd) => n(dmg / cd, 0);
  return `<p class="m-lead">Hold the left mouse button to fire your element whenever it's ready. Each element has its own cooldown, and all four recharge at the same time whether you hold them or not. Switching never resets or wastes a cooldown.</p>
${table(['Element', 'Cooldown', 'Damage', 'Reach', 'What else it does'], [
    [`${el('fire')} fireball`, sec(F.cooldown), `${F.damage} direct, ${n(F.damage * F.splash, 1)} splash`, `flies ${px(F.range)}`, `Explodes on the first enemy, on a wall or at the end of its flight, hitting everything within ${px(F.radius)}. Everything in the blast burns for ${sec(F.burnTime)} at ${F.burnDps} damage per second.`],
    [`${el('water')} wave`, sec(Wt.cooldown), `${Wt.damage} to each`, `about ${px(waveReach)} (it slows as it goes)`, `Pierces ${Wt.pierce} enemies, widens as it travels, knocks them back hard and slows them for ${sec(Wt.slowTime)}.`],
    [`${el('earth')} slam`, sec(E.cooldown), `${E.damage}`, `lands ${px(E.reach)} ahead, ${px(E.radius)} radius`, `Stuns for ${sec(E.stun)}, knocks back, and <b>destroys enemy bolts</b> inside the circle.`],
    [`${el('air')} darts`, sec(A.cooldown), `${A.darts} × ${A.damage}`, `${px(A.range)}, very fast`, 'A tight fan; each dart gives a small nudge.'],
  ])}
<p>Sustained damage on one target when everything hits (no upgrades): ${el('fire')} about ${dps(F.damage, F.cooldown)}/s plus ${F.burnDps}/s burn, ${el('water')} ${dps(Wt.damage, Wt.cooldown)}/s, ${el('earth')} ${dps(E.damage, E.cooldown)}/s, ${el('air')} ${dps(A.damage * A.darts, A.cooldown)}/s. They are close on purpose: the element multiplier decides more than the blow does.</p>
<h4>Status effects</h4>
${table(['Effect', 'Rules'], [
    ['Burn', `Ticks every ${sec(SIM.burnTick)}. It is ${el('fire')} damage, so each tick gets the 2× / ½× rule: great on ${el('air')}, weak on ${el('water')}. Re-applying refreshes it to the longest duration and strongest damage; it does not stack. It goes through a brute's shield.`],
    ['Slow', `Enemies move at ${pct(ENEMIES.grunt.slow)} speed (brutes ${pct(ENEMIES.brute.slow)}, the Titan ${pct(ENEMIES.boss.slow)}). A slowed brute charges at 75% speed.`],
    ['Stun', `Frozen in place, and touching it does no damage. It interrupts whatever the enemy was winding up, but grunts and spitters start a new lunge or shot as soon as it wears off if you are still in reach, and a brute can raise its shield again at once. Only a brute's charge truly goes back on cooldown. Brutes take ${pct(ENEMIES.brute.stun)} of the stun, the Titan ${pct(ENEMIES.boss.stun)} (its attack timers pause meanwhile).`],
    ['Knockback', `Brutes take ${pct(ENEMIES.brute.kb)} of it and the Titan ${pct(ENEMIES.boss.kb)}; swarmlings fly ${pct(ENEMIES.swarm.kb - 1)} further.`],
  ])}
<h4>What each one is for</h4>
<ul>
<li>${el('fire')}: area damage. Shoot into packs, or aim past a target at a wall so the blast catches the group behind it.</li>
<li>${el('water')}: crowd control. Pushes a whole line back and slows it; the answer to swarm packs and to being cornered.</li>
<li>${el('earth')}: close-range burst. Interrupts attacks and swats bolts out of the air in front of you.</li>
<li>${el('air')}: long-range single-target damage. Best against spitters and for finishing runners.</li>
</ul>`;
}

function secDash() {
  return `<p class="m-lead">${k('Shift')} or the right mouse button. Not just a jump: a short invulnerable burst that goes <i>through</i> enemies.</p>
${table(null, [
    ['Movement', `${px(dashDist)} in ${sec(PLAYER.dashTime)}, in the direction your movement keys point (toward the mouse if you press none). It stops crisply: you keep ${pct(SIM.dashCarry)} of the speed.`],
    ['Invulnerable', `${sec(PLAYER.dashInvuln)} from the start, so a little longer than the movement itself.`],
    ['Cooldown', `${sec(PLAYER.dashCd)}; Phase Step takes 15% off per level, compounding (${sec(dashCdMin)} at max).`],
    ['Buffer', `A press up to ${sec(PLAYER.dashBuffer)} before the cooldown ends is remembered and fires the instant it's ready.`],
    ['Through enemies', `No collision. Every enemy you cross takes ${PLAYER.dashDamage} damage of your current element (with the 2× / ½× rule) and is shoved aside, once per enemy per dash. These hits charge the meter and can finish kills.`],
    ['Perfect dodge', `While the dash is moving, these count if they would have hit you: enemy bolts (they fizzle), a charging brute or Titan you pass through, a meteor landing on you, a tide wall, a quake ring. Other bodies (a lunging grunt, a diving swarmling) you simply pass through. Each one gives +${PLAYER.perfectDodgeBlow} Blow and shows PERFECT.`],
    ['Ignores', 'Burning ground, stone pillars, and the gale pull.'],
  ], 'm-kv')}
${tip('Dash into, not away.', 'Through a pack you take no touch damage, nick every body and come out behind them, often behind a brute that is about to recover.')}
${tip('Time it on the hit, not before.', 'Bolts only fizzle during the moving part. In the short invulnerable tail they pass through you harmlessly, without a PERFECT.')}`;
}

function secNova() {
  const surgeStep = (ULT.surgeBonus / PLAYER.surgeCapTime) * 5;
  return `<h4>Filling the meter</h4>
${table(['Source', 'Meter'], [
    ['Damage you deal', `${PLAYER.blowPerDamage} per point, divided by the wave's enemy-HP multiplier (for the Titan, by its own HP multiplier), so it fills at a similar pace on every wave.`],
    ['A kill', `+${PLAYER.blowPerKill}, or +${PLAYER.blowPerKill * 2} for a super kill (last hit 2×).`],
    ['Gold orb', `+${PICKUPS.blow}`],
    ['Perfect dodge', `+${PLAYER.perfectDodgeBlow}`],
    ['Overcharge upgrade', '+25% per level to the damage and kill gains (not to orbs or dodges).'],
  ])}
<p>The meter never drains. The nova's blast does not refill it, but its burn ticks and the kills it makes do.</p>
<h4>The nova (${k('Space')} at 100%)</h4>
${table(null, [
    ['Damage', `${ULT.damage} × (1 + ${pct(ULT.perWave)} per wave after the first): ${n(novaDmg(1), 0)} on wave 1, ${n(novaDmg(5), 0)} on wave 5, ${n(novaDmg(10), 0)} on wave 10, ${n(novaDmg(20), 0)} on wave 20. Then the element multiplier (a counter nova does double) and your damage upgrade for that element.`],
    ['Area', `Everything within ${px(ULT.radius)} of you.`],
    ['Always', `Heavy knockback, ${sec(ULT.invuln)} invulnerability, deletes enemy bolts inside the circle, and enemies up to ${px(ULT.radius + SIM.novaScatter)} away that are just walking (not mid-attack) back off for ${sec(ULT.scatter)}.`],
    [`${el('fire')} nova`, `Burns ${sec(ULT.burnTime)} at ${n(BLOWS.fire.burnDps * SIM.novaFireBurn, 1)}/s. In the same instant the fire jumps (at ${BLOWS.fire.burnDps}/s) to unburnt enemies within ${px(ULT.fireSpread)} of a victim that survived the blast.`],
    [`${el('water')} nova`, `Slows everything hit for ${sec(ULT.slowTime)}.`],
    [`${el('earth')} nova`, `Stuns for ${sec(ULT.stun)} (brutes ${sec(ULT.stun * ENEMIES.brute.stun)}, the Titan ${sec(ULT.stun * ENEMIES.boss.stun)}).`],
    [`${el('air')} nova`, `${SIM.novaAirKnock}× knockback: clears the most space.`],
  ], 'm-kv')}
<h4>Surge and nova rush</h4>
<ul>
<li><b>Surge:</b> holding a full meter pays. While it sits at 100 you move ${pct(PLAYER.surgeSpeed)} faster, and the next nova gains +${pct(surgeStep)} damage per 5 s held, up to +${pct(ULT.surgeBonus)} after ${sec(PLAYER.surgeCapTime)}. The HUD reads SURGE +x% and a white core grows inside your gold ring.</li>
<li><b>Nova rush:</b> for ${sec(PLAYER.novaRush)} after a nova, all blows recharge ${pct(PLAYER.novaRushCd)} faster (full white ring around you).</li>
</ul>
${tip('Switch before you blow.', `Pick the element that beats most of what is around you, then press Space. Against the Titan, the ideal nova is the counter element, a full surge, during its winded window: 2 × ${n(1 + ULT.surgeBonus)} × ${BOSS.windedMult} = ${n(2 * (1 + ULT.surgeBonus) * BOSS.windedMult)} times the base damage.`)}
${tip('It is also a panic button.', `${sec(ULT.invuln)} of invulnerability, a bolt wipe and a shove in every direction.`)}`;
}

function secEnemies() {
  const G = ENEMIES.grunt, S = ENEMIES.swarm, P = ENEMIES.spitter, B = ENEMIES.brute;
  const card = (name, from, stats, items) => `<div class="m-card"><div class="m-card-head"><b>${name}</b><span>${from}</span></div><div class="m-stats">${stats}</div><ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
  return `<p class="m-lead">Wave-1 numbers; HP, damage and speed grow every wave (see ${go('waves', 'Waves')}). The colour of an enemy's outline is its element.</p>
<div class="m-cards">
${card('Grunt', 'from wave 1', `HP ${G.hp} · speed ${G.speed} · touch ${G.dmg}`, [
    'Each grunt approaches from its own angle, so a group surrounds you instead of queuing up.',
    `From wave ${G.lungeFromWave}: the <b>lunge</b>. Within about ${px(G.lungeRange)} it crouches for ${sec(G.lungeWindup)} (red chevron, red ring closing in), then bursts forward at ${G.lungeSpeed}× speed for ${sec(G.lungeTime)}. About every ${sec(G.lungeCd)}.`,
    'Beat it: step sideways as the ring closes. A stun interrupts the lunge, but it crouches again once the stun ends if you are still close. A water wave pushes a whole group back.',
  ])}
${card('Swarm', `from wave ${WAVE.unlock.swarm}`, `HP ${S.hp} · speed ${S.speed} · touch ${S.dmg}`, [
    `Packs of ${WAVE.swarmPack.min} to ${WAVE.swarmPack.max} sharing one element, moving as a cloud.`,
    `Pattern: approach, then once one is within ${px(S.orbitEnter)} the pack <b>circles you</b> at about ${px(S.orbitR)} for ${n(S.orbitMin)}-${sec(S.orbitMax)}, then they all <b>dive</b> for ${sec(S.diveTime)}, then circle again.`,
    'Beat it: a water wave pierces several and shoves the pack back; fire splash hits the clump. Hold the pack\'s element and its touches only do half. Dash through a dive.',
  ])}
${card('Spitter', `from wave ${WAVE.unlock.spitter}`, `HP ${P.hp} · speed ${P.speed} · bolt ${P.boltDmg}`, [
    `Keeps ${n(P.keepMin, 0)}-${px(P.keepMax)} away, spreads out from other spitters, avoids corners, and backs off faster if you walk at it holding its counter.`,
    `When you aim at it (within about ${SIM.spitterAimCone}°) it slides sideways out of your line.`,
    `About every ${sec(P.fireEvery)}: stops, a red ring closes in for ${sec(P.windup)} while the barrel tracks you, then it fires. It leads a moving target (a little on wave 3, fully from wave 8, at most ${px(P.lead)} ahead). From wave ${P.spreadFromWave}: a 3-bolt fan.`,
    `It fires ${SIM.spitterPunish}× as often while you stand still for over a second, or while any brute is recovering (after a charge, or after a stun broke its wind-up): it punishes you for punishing.`,
    `At most 1 per wave up to wave ${WAVE.spitterSolo}, then one more each wave.`,
    'Beat it: air darts (560 px) reach it at its preferred range. Change direction just as its ring closes, since it aims where you were heading. A slam or a dash deletes its bolts; a stun only delays the next shot.',
  ])}
${card('Brute', `from wave ${WAVE.unlock.brute}`, `HP ${B.hp} · speed ${B.speed} · touch ${n(B.dmg * SIM.bruteWalkTouch, 0)}, charge ${B.dmg}`, [
    `Heavy: barely moved by knockback, resists stun and slow, shoves you around.`,
    `<b>Charge:</b> within ${px(B.chargeRange)}, about every ${sec(B.chargeCd)}. A red lane with an arrow shows the exact path (${px(B.chargeSpeed * B.chargeTime)}). For the first ${pct(SIM.chargeLock)} of its ${sec(B.windup)} wind-up it aims where you are heading, then it locks: move late.`,
    `After the charge it stands still recovering: ${sec(B.recover * B.recoverMiss)} after a miss, ${sec(B.recover * B.recoverHit)} after a hit, ${sec(B.recover + SIM.wallDaze)} if it rammed a wall. That is your window.`,
    `<b>Shield:</b> if you hold its counter and stay more than ${px(B.guardRange)} away, it raises a glowing arc and walks at you for ${sec(B.guardTime)}. Your hits are halved and show BLOCKED; it keeps turning to face you, so flanking doesn't help. Burn ignores the shield. A stun knocks it down, but it can go straight back up while you still hold its counter at range; close in, or switch element, and it has no reason to raise it.`,
    `Up to one brute per 4 waves (wave 4: 1, wave 8: 2...). Drops a heal orb ${pct(B.healDrop)} of the time.`,
    'Beat it: bait the charge, sidestep late or dash through it (PERFECT), then punish the recovery with the counter. A slam during the wind-up cancels the charge and puts it back on cooldown.',
  ])}
</div>`;
}

function secBoss() {
  const sig = BOSS.signatureWindup;
  const M = BOSS.meteor, T = BOSS.tide, Q = BOSS.quake, G = BOSS.gale;
  return `<p class="m-lead">Every ${WAVE.bossEvery}th wave. It arrives at the top centre behind a shielded entrance (it can't be damaged until it has fully materialised). A boss wave heals you ${pct(BOSS.preHeal)} of your max HP first. The label under its bar names its element.</p>
${table(null, [
    ['HP', `${n(bossHp(1), 0)} on wave ${WAVE.bossEvery}, ${n(bossHp(2), 0)} on wave ${WAVE.bossEvery * 2}, ${n(bossHp(3), 0)} on wave ${WAVE.bossEvery * 3} (+${pct(BOSS.hpPerBoss)} per Titan).`],
    ['Damage', `Base × (1 + ${pct(BOSS.dmgPerWave)} per wave after the first): ×${n(1 + BOSS.dmgPerWave * (WAVE.bossEvery - 1))} on wave ${WAVE.bossEvery}, ×${n(1 + BOSS.dmgPerWave * (WAVE.bossEvery * 2 - 1))} on wave ${WAVE.bossEvery * 2}. The first Titan deals ${pct(BOSS.firstBoss)} of that, to keep it learnable.`],
    ['Escorts', `None with the first Titan, ${BOSS.escort.perBoss} with the second, ${BOSS.escort.perBoss * 2} with the third, and so on; one in ${BOSS.escort.spitterEvery} is a spitter.`],
    ['Resistances', `Takes ${pct(ENEMIES.boss.stun)} of stuns and ${pct(ENEMIES.boss.kb)} of knockback; slowed it still moves at ${pct(ENEMIES.boss.slow)}.`],
    ['Phase shifts', `At ${pct(BOSS.thresholds[0])} and ${pct(BOSS.thresholds[1])} HP it changes to one of the other three elements (new counter, new signature), shakes off stuns, ends a winded window, fires a bolt ring and drops a heal and a Blow orb. One huge hit across both thresholds counts as a single shift.`],
    ['Enraged', `Below ${pct(BOSS.thresholds[1])}: the pause between patterns drops to ${sec(BOSS.enrage.idle)} (${sec(BOSS.idle[0])} in the first phase, ${sec(BOSS.idle[1])} in the second), and patterns start coming in back-to-back pairs: every other pause is skipped for the first two Titans; from the third Titan every pattern is paired (with the short pause still between pairs).`],
    ['Death', `Its summons and echo turrets die with it (escorts don't: finish them to clear the wave), its bolts and hazards vanish, and it drops ${BOSS.drops.heal} heal and ${BOSS.drops.blow} Blow orbs.`],
  ], 'm-kv')}
<h4>Shared patterns</h4>
${table(['Pattern', 'Tell', 'What happens / how to beat it'], [
    ['Bolt burst', `Dashed red circle around it fills for ${sec(BOSS.burstWindup)}`, `${BOSS.burstRings} rings of ${BOSS.burstBase}+ bolts (3 rings when enraged, more bolts per phase and per later Titan). The second ring fills the first ring's gaps. Step through a gap, dash through, slam them, or hold its element.`],
    ['Summon', 'Wider red circle (first phase only)', `3 swarmlings of its element.`],
    ['Echo turrets', 'Very wide red circle (from the second phase)', `${BOSS.echo.count} stationary spitters about ${px(BOSS.echo.range)} out, firing bolts as strong as the Titan's. They aim like spitters (leading you, and with 3-bolt fans from the wave-${Math.ceil(ENEMIES.spitter.spreadFromWave / WAVE.bossEvery) * WAVE.bossEvery} Titan on) and fade after ${sec(BOSS.echo.life)}. A faded turret is worth nothing; a killed one half a spitter's score: kill them if they're in your way, otherwise stay out of their line.`],
    ['Charge', 'Red lane (more likely when you are far away)', `A ${px(BOSS.chargeSpeed * BOSS.chargeTime)} rush with ${SIM.bossChargeTouch}× touch damage; locks for the last part of the wind-up. Sidestep late or dash through it.`],
    ['Spiral', 'It starts spinning (from the second phase)', `Rotating arms of bolts (2, or 3 when enraged) for ${sec(BOSS.spiralTime)} while it drifts toward you. Keep moving around it, or back off.`],
  ])}
<h4>Signature attacks (one per element)</h4>
<p>Each element gives the Titan its own attack, wound up for ${sec(sig)} with its own cue. The first Titan always opens with it.</p>
${table(['Element', 'Attack', 'How to beat it'], [
    [el('fire'), `<b>Meteor rain.</b> ${M.count} target circles (+${M.perBoss} per later Titan, max ${M.countMax}) fill up as rocks fall. The first is centred where you would be ${sec(M.lead)} later at your current speed, the rest around it. They detonate about ${sec(M.fuse)} after appearing, for ${M.dmg} each, and leave burning ground for ${sec(M.burnLife)}.`, 'Change direction the moment they appear, then stay off the burning patches.'],
    [el('water'), `<b>Tide.</b> Two wide walls sweep from the Titan toward you; one is aimed straight at you. A white dotted line marks the gap between them. The direction is fixed when the wind-up starts.`, 'Step into the gap, or dash through a wall for a PERFECT.'],
    [el('earth'), `<b>Quake.</b> ${Q.rings} expanding rings (+${Q.perBoss} per later Titan, max ${Q.ringsMax}), ${sec(Q.ringGap)} apart, each with a gap marked by white ticks. ${Q.pillars} stone pillars rise where red dashed circles were and stand for ${sec(Q.pillarLife)}, hurting on contact once they are up (not during the first ${sec(Q.pillarRise)}).`, 'Stand in a ring\'s gap or dash through the ring. Mind the pillars when you move.'],
    [el('air'), `<b>Gale.</b> For ${sec(G.time)} it drags you toward itself (streaming lines) while firing ${G.pairs} aimed bolt pairs.`, `Walk away to resist most of the pull; a dash ignores it. Each pair flies either side of where you'll be: from more than about ${px(galeSplit)} away a steady course takes you between them, while a sudden turn or being dragged close gets you hit.`],
  ])}
<h4>Winded</h4>
<p>After every signature attack the Titan is <b>winded</b> for ${sec(BOSS.winded)}: it stands still, glows yellow with cracks (WINDED!), takes ${BOSS.windedMult}× damage, and touching it does nothing. Hug it and unload; it is the best moment for a nova. A hit that crosses ${pct(BOSS.thresholds[0])} or ${pct(BOSS.thresholds[1])} HP ends the window early with a phase shift.</p>
<p>Later Titans wind up ${sec(BOSS.windupPerBoss)} faster each (never under ${sec(BOSS.windupMin)}), with more meteors and rings, longer tide walls, a stronger gale and more bolts per ring.</p>`;
}

function secWaves() {
  const rows = [1, 5, 10, 15, 20, 25].map((w) => {
    const s = waveScale(w);
    const pal = WAVE.palette[Math.min(WAVE.palette.length, w) - 1];
    return [w % WAVE.bossEvery === 0 ? `${w} (Titan)` : String(w), String(pal), `${n(s.hp)}×`, `${n(s.dmg)}×`, `${n(s.speed)}×`, n(ENEMIES.grunt.hp * s.hp, 0), n(novaDmg(w), 0)];
  });
  const costs = ['grunt', 'swarm', 'spitter', 'brute'].map((t) => `${t} ${ENEMIES[t].cost}`).join(', ');
  return `<ul>
<li><b>Countdown:</b> ${sec(WAVE.firstCountdown)} before wave 1, ${sec(WAVE.countdown)} after each upgrade pick.</li>
<li><b>Spawning:</b> enemies come in at the arena edges, at least ${px(SIM.spawnClear)} from you when possible, through a portal lasting ${n(ENEMIES.swarm.spawnTime)}-${sec(ENEMIES.brute.spawnTime)}. While materialising they can't move or touch you and your knockback and dash pass them by, but your blows already hit them (the Titan excepted), burn ticks on them, and a stun only starts counting down once they emerge.</li>
<li><b>New types:</b> swarms from wave ${WAVE.unlock.swarm}, spitters from wave ${WAVE.unlock.spitter}, brutes from wave ${WAVE.unlock.brute}. A wave never opens with a brute.</li>
<li><b>Size:</b> each wave spends a budget of ${WAVE.budgetBase} points on wave 1, +${WAVE.budgetPerWave} per wave (costs: ${costs} each). The wave after a Titan is ${pct(1 - WAVE.breather)} lighter.</li>
<li><b>Pace:</b> groups of ${groupAt(1)} on wave 1 growing to ${WAVE.groupMax} (a whole swarm pack counts as one), every ${sec(WAVE.spawnIntervalBase)} (${sec(WAVE.spawnIntervalPerWave)} quicker per wave, never under ${sec(WAVE.spawnIntervalMin)}), paused while ${WAVE.aliveBase} + ${WAVE.alivePerWave} × wave enemies are alive. When fewer enemies are alive than one group, the next group arrives after only ${sec(WAVE.pressureInterval)}: clearing fast brings the next group sooner.</li>
<li><b>Mercy:</b> on waves 1-${WAVE.mercyUntil}, below ${pct(WAVE.mercyHp)} HP, spawns come ${WAVE.mercySlow}× slower.</li>
<li><b>Clear:</b> when the last enemy dies you heal ${WAVE.clearHeal}, enemy bolts vanish, every orb on the floor flies to you, and you pick an upgrade.</li>
</ul>
<h4>How enemies scale</h4>
${table(['Wave', 'Elements', 'Enemy HP', 'Enemy damage', 'Enemy speed', 'Grunt HP', 'Nova (1×)'], rows)}
<p>On Titan waves the columns describe the escorts; the Titan's own element can be any of the four.</p>
<p>Enemy HP grows faster than the nova, so late in a run the nova is more about control (stun, slow, scatter, bolt wipe) than about kills. Very late waves that hit the ${WAVE.maxPerWave}-body cap turn the leftover budget into up to +${pct(WAVE.spongeCap - 1)} enemy HP.</p>`;
}

function secPickups() {
  const rows = ['grunt', 'swarm', 'spitter', 'brute'].map((t) => [t[0].toUpperCase() + t.slice(1), pct(ENEMIES[t].healDrop), pct(ENEMIES[t].blowDrop)]);
  return `<ul>
<li>You start with ${PLAYER.maxHp} HP. Healing: +${WAVE.clearHeal} per cleared wave, +${pct(BOSS.preHeal)} of max HP when a boss wave starts, heal orbs, Siphon (per kill) and Vitality (+25 max and +25 now).</li>
<li>After a hit you are invulnerable for ${sec(PLAYER.hitInvuln)} (you blink), and touches knock you back.</li>
<li>Damage you take = the hit × ½ if you hold the attacker's element × Bark Skin.</li>
<li><b>Orbs:</b> green cross +${PICKUPS.heal} HP (Field Medic: +50% per level), gold star +${PICKUPS.blow} Blow. They last ${sec(PICKUPS.life)} and blink in their last 3 seconds. Within ${px(PLAYER.magnet)} (+90 per Lodestone) they fly to you.</li>
<li>Bodies have weight: you push grunts, swarmlings and spitters around, brutes shove you back, and the Titan bulldozes you.</li>
</ul>
<h4>Drop chance per kill</h4>
${table(['Enemy', 'Heal orb', 'Blow orb'], rows)}
<p>Field Medic raises the heal chances. The Titan's minions only roll half the time; the Titan itself drops a heal and a Blow orb at each phase shift and ${BOSS.drops.heal} + ${BOSS.drops.blow} when it dies.</p>`;
}

function secScore() {
  const base = ['grunt', 'swarm', 'spitter', 'brute', 'boss'].map((t) => `${t === 'boss' ? 'Titan' : t} ${ENEMIES[t].score}`).join(', ');
  return `<ul>
<li><b>Kill score</b> = base × (1 + ${pct(SIM.scorePerWave)} per wave after the first) × combo × ${COMBO.superBonus} for a super kill × ½ for a Titan minion. Base: ${base}.</li>
<li><b>Combo:</b> +${COMBO.perKill} per kill in a chain, up to ×${COMBO.max} (${comboKillsMax} kills). Every kill refreshes a ${sec(COMBO.window)} window (the bar under the multiplier). When the window runs out the chain drains one kill every ${sec(COMBO.decayStep)}: it falls fast, but not to zero at once.</li>
<li><b>Kill burst:</b> 3 kills inside one second make the enemies within ${px(SIM.burstRange)} of you that are just walking (not mid-attack) back off for ${sec(ULT.scatter)}.</li>
<li>The top 10 runs are kept per browser; a run that makes it asks for your name.</li>
</ul>`;
}

function secUpgrades() {
  // per-level effect and the total at max, from sim.js applyUpgradeEffect
  const at = (u) => u.max;
  const notes = {
    vitality: (u) => `+${25 * at(u)} max HP at max.`,
    swift: (u) => `+${8 * at(u)}% at max.`,
    pyromancy: (u) => `Added: +${20 * at(u)}% (${n(1 + 0.2 * at(u))}×) at max.`,
    quickcast: (u) => `Multiplied: cooldowns ${n(0.9 ** at(u))}× at max, all four blows.`,
    phasestep: (u) => `Multiplied: ${sec(PLAYER.dashCd * 0.85 ** at(u))} dash cooldown at max.`,
    overcharge: (u) => `Added: ${n(1 + 0.25 * at(u))}× meter gain from damage and kills at max. Orbs and perfect dodges unchanged.`,
    inferno: () => 'Added per level. Also lengthens a fire nova\'s burn.',
    riptide: (u) => `${BLOWS.water.pierce + 2 * at(u)} pierce at max.`,
    gale: (u) => `${BLOWS.air.darts + at(u)} darts at max.`,
    tremor: () => 'Added per level; brutes and the Titan still resist the stun.',
    siphon: (u) => `${n(0.5 * at(u))} HP per kill at max.`,
    lodestone: (u) => `${px(PLAYER.magnet + 90 * at(u))} pull at max.`,
    barkskin: (u) => `Multiplied: ${n(0.92 ** at(u))}× damage taken at max.`,
    medic: (u) => `Added: ${n(1 + 0.5 * at(u))}× heal per orb and drop chance at max.`,
  };
  notes.tidecaller = notes.pyromancy;
  notes.stoneheart = notes.pyromancy;
  notes.windborn = notes.pyromancy;
  const rows = UPGRADES.map((u) => [
    `<b>${u.name}</b>${u.element ? ` ${el(u.element)}` : ''}`, u.desc, String(u.max), notes[u.id] ? notes[u.id](u) : '',
  ]);
  return `<p class="m-lead">After every wave you pick 1 of 3 random upgrades. Upgrades you have maxed are no longer offered.</p>
${table(['Upgrade', 'Per level', 'Max', 'Stacking'], rows)}
${tip('Spread or focus?', 'Element damage upgrades only pay while you hold that element, and the cycle forces you to switch. Quickcast, Bark Skin, Vitality and Phase Step help whatever you hold.')}`;
}

function secTech() {
  const items = [
    ['Cooldown weaving.', 'Cooldowns run in parallel, so fire one element, switch, fire another while the first recharges, and switch back. More hits per second than holding one element, at the price of some hits at 1× or ½×.'],
    ['Counter, then nova.', 'Switch to the element that beats the crowd before pressing Space: the nova obeys the 2× rule.'],
    ['Match to tank.', 'About to eat a hit you can\'t dodge? Switch to the attacker\'s element for that moment: RESIST halves it.'],
    ['Earth parry.', 'A slam deletes every bolt inside its circle. Face an incoming bolt or a burst ring and slam.'],
    ['Stun interrupts.', 'Slam a brute during its charge wind-up and the charge is cancelled and goes back on cooldown. A grunt mid-crouch or a spitter mid-aim only loses that attempt (they retry once the stun ends), but stunned enemies can\'t hurt you by touch meanwhile.'],
    ['Wall-bait brutes.', `Stand a little in front of a wall and sidestep late. A brute that rams the wall is dazed for ${sec(ENEMIES.brute.recover + SIM.wallDaze)}.`],
    ['Never stand still.', `Standing still for more than a second makes every spitter fire ${SIM.spitterPunish}× as often. Strafe while you shoot.`],
    ['Camp the portals.', `Spawning enemies take damage, burn and stuns before they can move. Portals open at least ${px(SIM.spawnClear)} away, so fight near the side they come from: fireballs fly ${px(BLOWS.fire.range)} and darts ${px(BLOWS.air.range)}.`],
    ['Three quick kills buy space.', 'A 3-kill burst inside a second makes the survivors near you back off.'],
    ['Hold the meter when it\'s safe.', `A full meter gives speed now and up to +${pct(ULT.surgeBonus)} nova damage later. Cash it in on a winded Titan or when things go wrong.`],
    ['Fireball as artillery.', 'It explodes at the end of its flight or on a wall even without a hit: aim behind a group.'],
    ['Finish with the counter.', 'A super kill doubles the meter gain for that kill and adds 50% score.'],
    ['Let echo turrets expire.', `They vanish after ${sec(BOSS.echo.life)}, and a kill is only worth half a spitter; dodge their bolts instead of chasing them, unless they block your path.`],
    ['Watch the Titan\'s bar.', `Near ${pct(BOSS.thresholds[0])} and ${pct(BOSS.thresholds[1])} it changes element and fires a ring at once. Be ready to switch to the new counter.`],
  ];
  return `<ol class="m-tech">${items.map(([t, b]) => `<li><b>${t}</b> ${b}</li>`).join('')}</ol>`;
}

function secControls() {
  return table(['Action', 'Keys'], [
    ['Move', `${k('W', 'A', 'S', 'D')} or the arrow keys`],
    ['Aim', 'Mouse'],
    ['Fire current blow', 'Left mouse button (hold)'],
    ['Switch element', `${k('1')} Fire, ${k('2')} Water, ${k('3')} Earth, ${k('4')} Air (numpad too); ${k('Q')} / ${k('E')} or the mouse wheel to cycle`],
    ['Dash', `${k('Shift')} or right mouse button`],
    ['Nova (full meter)', k('Space')],
    ['Pause / resume', `${k('P')} or ${k('Esc')}`],
    ['This manual', `${k('H')} (in a run it pauses first), or the Manual button on the menu and pause screens`],
    ['Mute', k('M')],
    ['Full screen', `${k('F')} or the corner button (${k('Esc')} leaves it)`],
    ['Menu', `${k('Enter')} or ${k('Space')} starts`],
    ['Pause screen', `${k('Enter')} resumes, ${k('R')} restarts, ${k('Q')} quits to the menu`],
    ['Upgrade screen', `${k('1')}, ${k('2')} or ${k('3')} picks a card`],
    ['Game over', `${k('Enter')} or ${k('R')} plays again, ${k('Esc')} goes to the menu`],
  ]);
}

const SECTIONS = [
  ['faq', 'Quick answers', secFaq],
  ['you', 'Your character', secYou],
  ['arena', 'Reading the arena', secArena],
  ['hud', 'The HUD', secHud],
  ['elements', 'Elements', secElements],
  ['blows', 'The four blows', secBlows],
  ['dash', 'Dash', secDash],
  ['nova', 'Blow meter & nova', secNova],
  ['enemies', 'Enemies', secEnemies],
  ['boss', 'The Titan', secBoss],
  ['waves', 'Waves', secWaves],
  ['pickups', 'Health & orbs', secPickups],
  ['score', 'Score & combo', secScore],
  ['upgrades', 'Upgrades', secUpgrades],
  ['tech', 'Pro techniques', secTech],
  ['controls', 'Controls', secControls],
];

const esc = (s) => s.replace(/&/g, '&amp;');

/** The manual's markup (a pure function of the tuning tables). */
export function manualHTML() {
  gid = 0;
  const nav = SECTIONS.map(([id, title]) => `<button type="button" tabindex="-1" data-goto="${id}">${esc(title)}</button>`).join('');
  const body = SECTIONS.map(([id, title, fn]) => `<section class="m-sec" id="m-${id}" data-sec="${id}"><h3>${esc(title)}</h3>${fn()}</section>`).join('');
  return `<div class="panel manual-panel" role="dialog" aria-modal="true" aria-labelledby="manual-title">
<header class="manual-head"><h2 class="manual-title" id="manual-title">Field Manual</h2>
<button type="button" class="btn ghost manual-close" tabindex="-1"><span class="btn-label">Close</span><kbd>ESC</kbd></button></header>
<div class="manual-main"><nav class="manual-nav" aria-label="Manual sections">${nav}</nav>
<div class="manual-content" tabindex="-1">${body}<p class="m-foot">Numbers are the current balance; enemy values are for wave 1 unless noted.</p></div></div></div>`;
}

/**
 * Mount the manual overlay. Returns { open, close, isOpen }.
 * While it is open its capture-phase key handler (register it before the app's own key handlers)
 * closes it on Esc or H and keeps every other key except M (mute) and F (full screen) away from
 * the screen underneath, so Enter / R / Q / 1-3 can't start, restart or pick anything behind it.
 */
export function createManual(host) {
  const root = host || document.getElementById('ui') || document.body;
  const ov = document.createElement('div');
  ov.className = 'overlay manual';
  ov.hidden = true;
  ov.innerHTML = manualHTML();
  root.appendChild(ov);
  const content = ov.querySelector('.manual-content');
  const navBtns = Array.from(ov.querySelectorAll('.manual-nav button'));
  const sections = Array.from(ov.querySelectorAll('.m-sec'));
  let open = false;
  let savedTop = 0;

  function markNav() {
    const top = content.scrollTop + 60;
    let cur = sections[0];
    for (const s of sections) if (s.offsetTop <= top) cur = s;
    // at the very bottom the last short sections can never reach the top: mark the last one
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 4) cur = sections[sections.length - 1];
    const id = cur && cur.dataset.sec;
    for (const b of navBtns) b.classList.toggle('on', b.dataset.goto === id);
  }
  let rafPending = false;
  content.addEventListener('scroll', () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      markNav();
    });
  }, { passive: true });

  function goTo(id) {
    const s = ov.querySelector(`#m-${id}`);
    if (s) content.scrollTop = s.offsetTop - 8; // instant: smooth scrolling across the whole manual drags
  }

  function show() {
    if (open) return;
    open = true;
    ov.hidden = false;
    content.scrollTop = savedTop; // display:none drops the scroll position
    content.focus({ preventScroll: true }); // arrow keys, Page Up/Down and Space scroll the text
    markNav();
  }
  function hide() {
    if (!open) return;
    savedTop = content.scrollTop;
    open = false;
    ov.hidden = true;
    content.blur();
  }

  ov.addEventListener('click', (e) => {
    const t = e.target;
    if (t === ov) return hide(); // the dimmed backdrop
    const link = t.closest && t.closest('[data-goto]');
    if (link) {
      e.preventDefault();
      link.blur();
      goTo(link.dataset.goto);
      return;
    }
    if (t.closest && t.closest('.manual-close')) hide();
  });

  window.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.code === 'Escape' || e.code === 'KeyH') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) hide();
      return;
    }
    if (e.code === 'KeyM' || e.code === 'KeyF') return;
    e.stopImmediatePropagation(); // no preventDefault: scrolling keys keep working
  }, true);

  return { open: show, close: hide, isOpen: () => open };
}

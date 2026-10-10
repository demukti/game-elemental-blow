// Elemental Blow — autoplay bot. Pure: reads the sim state and returns an input object.
// Used by the tests (soak / progression) and by the in-browser `?bot=1` playtest mode (main.js).

import { counterOf } from './sim.js';
import { ELEMENTS, BEATS } from './config.js';

export const IDLE = Object.freeze({
  moveX: 0, moveY: 0, aimX: 800, aimY: 450, fire: false, dash: false, blow: false, switchTo: null, cycle: 0,
});

export function nearestEnemy(state) {
  const p = state.player;
  let best = null;
  let bd = Infinity;
  for (const e of state.enemies) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best ? { e: best, d: bd } : null;
}

/**
 * simple (smart=false): back away from the nearest enemy (drifting toward the arena centre so
 *   it does not get cornered), aim at it, switch to the counter element and hold fire.
 * smart (default): same targeting, but it keeps a preferred range for the chosen element
 *   (closes in to slam with earth), steers away from crowds and enemy bolts, dashes when
 *   something is in its face and fires the Blow when it would hit several enemies.
 */
export function botInput(state, { smart = true, dodge = true } = {}) {
  const p = state.player;
  const inp = { ...IDLE, aimX: p.x + Math.cos(p.angle) * 100, aimY: p.y + Math.sin(p.angle) * 100 };
  const n = nearestEnemy(state);
  if (!n) {
    // drift back to the centre between waves
    inp.moveX = Math.sign(800 - p.x) * Math.min(1, Math.abs(800 - p.x) / 200);
    inp.moveY = Math.sign(450 - p.y) * Math.min(1, Math.abs(450 - p.y) / 200);
    return inp;
  }
  const { e, d } = n;
  let el = counterOf(e.element);
  if (smart && el === 'earth' && (d > 200 || e.type === 'spitter')) {
    // earth is melee range; against a kiting / distant target use the neutral ranged element
    el = ELEMENTS.find((x) => x !== el && x !== e.element && BEATS[e.element] !== x);
  }
  let ax = (p.x - e.x) / (d || 1);
  let ay = (p.y - e.y) / (d || 1);
  if (!smart) {
    const urgency = d < 260 ? 1 : 0.35;
    ax *= urgency;
    ay *= urgency;
  } else {
    const pref = (el === 'earth' ? 70 : 260) + e.r;
    const k = d < pref - 30 ? 1 : d > pref + 60 ? -1 : 0;
    // strafe around the target when in the sweet spot
    ax = ax * k + (k === 0 ? -ay * 0.8 : 0);
    ay = ay * k + (k === 0 ? (p.x - e.x) / (d || 1) * 0.8 : 0);
    // crowd + bolt avoidance
    for (const o of state.enemies) {
      const od = Math.hypot(p.x - o.x, p.y - o.y);
      const near = o.r + p.r + (o.type === 'brute' || o.type === 'boss' ? 160 : 70);
      if (o !== e && od < near) {
        ax += ((p.x - o.x) / (od || 1)) * (1 - od / near) * 1.5;
        ay += ((p.y - o.y) / (od || 1)) * (1 - od / near) * 1.5;
      }
    }
    for (const b of state.projectiles) {
      if (!dodge || b.owner !== 'enemy') continue;
      const bd = Math.hypot(p.x - b.x, p.y - b.y);
      if (bd < 120) {
        // sidestep perpendicular to the bolt's travel direction
        const vl = Math.hypot(b.vx, b.vy) || 1;
        let sx = -b.vy / vl;
        let sy = b.vx / vl;
        if (sx * (p.x - b.x) + sy * (p.y - b.y) < 0) {
          sx = -sx;
          sy = -sy;
        }
        ax += sx * (1 - bd / 120) * 2;
        ay += sy * (1 - bd / 120) * 2;
      }
    }
  }
  ax += (800 - p.x) / 700;
  ay += (450 - p.y) / 450;
  const l = Math.hypot(ax, ay) || 1;
  inp.moveX = ax / l;
  inp.moveY = ay / l;
  inp.aimX = e.x;
  inp.aimY = e.y;
  inp.switchTo = el;
  inp.fire = true;
  if (smart) {
    inp.dash = p.dashCd <= 0 && (d < e.r + p.r + 30 || (e._ai === 'charge' && d < e.r + p.r + 150));
    let around = 0;
    for (const o of state.enemies) if (Math.hypot(p.x - o.x, p.y - o.y) < 250) around++;
    inp.blow = p.blow >= 100 && (around >= 4 || (e.type === 'boss' && d < 300));
  }
  return inp;
}

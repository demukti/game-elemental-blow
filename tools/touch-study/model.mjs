// Human-proxy input models for the touch study.
//
// Each model wraps the smart bot (src/bot.js): the bot says what it WANTS this step (move vector,
// target, element, fire, dash, nova) and the model turns that intent into what a person on a given
// control scheme could actually produce: reaction delays, the time a thumb needs to hop between
// buttons (during which it cannot also hold the fire / aim control), aim lag and aim noise, or an
// auto-aim / auto-element assist. All times are in sim seconds.
//
// This is a proxy for difficulty, not for fun.

import { botInput, nearestEnemy } from '../../src/bot.js';
import { counterOf } from '../../src/sim.js';
import { ELEMENTS, BEATS, BLOWS } from '../../src/config.js';
import { autoAim } from '../../src/touch.js';

const DEG = Math.PI / 180;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Presets. Fields:
 *  moveDelay    s   the move vector lags the bot's wish (dodge reaction)
 *  react        s   perception delay before acting on a new element / dash / nova wish
 *  hop          s   motor time to press the element control after deciding
 *  hopFireGap   bool  firing stops during the hop (the same thumb holds fire/aim)
 *  dashMotor    s   motor time to press dash after deciding
 *  dashFireGap  s   firing stops this long around a dash press (the same thumb)
 *  dashBlockedBySwitch bool  dash waits while the thumb is hopping between element controls
 *  aim          'bot' | 'manual' | 'auto' | 'proto'   manual = lagged, noisy pursuit of the bot's target;
 *               auto = exact aim at the bot's target; proto = the prototype's autoAim (src/touch.js)
 *  aimLag       s   time constant of the manual aim pursuit
 *  aimNoise     deg sd of the manual aim error (resampled every aimJitterEvery s, a drifting hand)
 *  autoLead     bool  auto-aim leads moving targets with projectile blows
 *  autoElement  bool  the game picks the element (counter of the auto-aim target) instantly
 *  moveNoise    deg sd of the stick direction error (resampled every 0.2 s)
 *  noSwitch     bool  never switches element (sensitivity check)
 *  mistap       p   chance a hop lands on a neighbouring element (noticed and fixed after `react`)
 */
export const PRESETS = {
  bot: { raw: true },
  desktop: {
    moveDelay: 0.12, react: 0.2, hop: 0.08, hopFireGap: false,
    dashMotor: 0.05, dashFireGap: 0, dashBlockedBySwitch: false,
    aim: 'manual', aimLag: 0.08, aimNoise: 2,
  },
  // twin-stick: left stick move, right stick aim + fire, element buttons and dash on the right side
  touchTwin: {
    moveDelay: 0.12, react: 0.2, hop: 0.3, hopFireGap: true, reacquire: 0.15, mistap: 0.05,
    dashMotor: 0.15, dashFireGap: 0.3, dashBlockedBySwitch: true,
    aim: 'manual', aimLag: 0.15, aimNoise: 6,
  },
  // the prototype: left stick move; auto-aim + auto-fire; the right thumb taps one of four element
  // pads (or slides across them) and the dash / nova buttons, so a switch and a dash cannot overlap
  touchPads: {
    moveDelay: 0.12, react: 0.2, hop: 0.2, hopFireGap: false, mistap: 0.05,
    dashMotor: 0.12, dashFireGap: 0, dashBlockedBySwitch: true,
    aim: 'auto',
  },
  // same pads, but fire has to be held on the pad (Brawl Stars style): lifting the thumb to hop or
  // to dash stops the fire
  touchPadsHold: {
    moveDelay: 0.12, react: 0.2, hop: 0.2, hopFireGap: true, mistap: 0.05,
    dashMotor: 0.12, dashFireGap: 0.25, dashBlockedBySwitch: true,
    aim: 'auto',
  },
  // "lite": auto-aim and auto-element; the player only moves, dashes and fires the nova
  touchLite: {
    moveDelay: 0.12, react: 0.2, hop: 0, hopFireGap: false,
    dashMotor: 0.12, dashFireGap: 0, dashBlockedBySwitch: false,
    aim: 'auto', autoElement: true,
  },
};

export function makeModel(name, overrides = {}, seed = 1) {
  const P = { ...PRESETS[name], ...overrides };
  const rng = mulberry32(seed * 7919 + 17);
  const m = {
    name,
    P,
    // delay line for the move vector: [time, mx, my]
    moveBuf: [],
    // element switching
    wishEl: null, // last element the bot wanted
    wishSince: 0,
    hopEl: null, // element the thumb is travelling to
    hopEnd: 0, // switch lands at this time
    gapEnd: 0, // firing blocked until this time
    // dash / nova
    dashWishAt: -1,
    dashAt: -1,
    blowWishAt: -1,
    blowAt: -1,
    // aim
    aimAng: null,
    aimErr: 0,
    aimErrT: 0,
    stats: { switches: 0, dashes: 0, fireBlocked: 0, steps: 0 },
  };

  function delayed(buf, now, delay, val) {
    buf.push([now, ...val]);
    while (buf.length > 1 && buf[1][0] <= now - delay) buf.shift();
    return buf[0][0] <= now - delay + 1e-9 ? buf[0].slice(1) : [0, 0];
  }

  return {
    model: m,
    input(state) {
      const want = botInput(state);
      if (P.raw) return want;
      const p = state.player;
      const now = state.time;
      m.stats.steps++;
      const out = { ...want };

      // movement (left thumb / WASD)
      let [mx, my] = delayed(m.moveBuf, now, P.moveDelay, [want.moveX, want.moveY]);
      if (P.moveNoise && (mx || my)) {
        // a thumb on a virtual stick without a physical centre: direction wobbles a little
        if (now >= (m.moveErrT || 0)) {
          m.moveErr = gauss(rng) * P.moveNoise * DEG;
          m.moveErrT = now + 0.2;
        }
        const c = Math.cos(m.moveErr);
        const sn = Math.sin(m.moveErr);
        [mx, my] = [mx * c - my * sn, mx * sn + my * c];
      }
      out.moveX = mx;
      out.moveY = my;

      const n = nearestEnemy(state);
      const target = n ? n.e : null;

      // element: wish must persist `react` s (a person notices the new nearest enemy late), then a hop
      out.switchTo = null;
      if (P.noSwitch) {
        // never switches: stays on the start element
      } else if (P.autoElement) {
        out.switchTo = want.switchTo;
      } else {
        if (want.switchTo !== m.wishEl) {
          m.wishEl = want.switchTo;
          m.wishSince = now;
        }
        if (m.hopEl === null && m.wishEl && m.wishEl !== p.element && now - m.wishSince >= P.react) {
          m.hopEl = m.wishEl;
          m.hopEnd = now + P.hop;
          if (P.hopFireGap) m.gapEnd = Math.max(m.gapEnd, now + P.hop + (P.reacquire || 0));
        }
        if (m.hopEl !== null && now >= m.hopEnd) {
          if (P.mistap && rng() < P.mistap) {
            const i = ELEMENTS.indexOf(m.hopEl);
            m.hopEl = ELEMENTS[(i + (rng() < 0.5 ? 1 : 3)) % 4];
            m.stats.mistaps = (m.stats.mistaps || 0) + 1;
          }
          // a wrong element is noticed like any other mismatch: the wish must persist `react` again
          m.wishSince = now;
          out.switchTo = m.hopEl;
          m.hopEl = null;
          m.stats.switches++;
        }
      }
      const hopping = m.hopEl !== null;

      // dash and nova (edge wishes): reaction, then motor time; may wait for a hop to finish
      out.dash = false;
      out.blow = false;
      if (want.dash && m.dashWishAt < 0 && m.dashAt < 0) m.dashWishAt = now;
      if (m.dashWishAt >= 0 && now - m.dashWishAt >= P.react && !(P.dashBlockedBySwitch && hopping)) {
        m.dashAt = now + P.dashMotor;
        m.dashWishAt = -1;
        if (P.dashFireGap) m.gapEnd = Math.max(m.gapEnd, now + P.dashFireGap);
      }
      if (m.dashAt >= 0 && now >= m.dashAt) {
        out.dash = true;
        m.dashAt = -1;
        m.stats.dashes++;
      }
      if (want.blow && m.blowWishAt < 0 && m.blowAt < 0) m.blowWishAt = now;
      if (m.blowWishAt >= 0 && now - m.blowWishAt >= P.react && !(P.dashBlockedBySwitch && hopping)) {
        m.blowAt = now + P.dashMotor;
        m.blowWishAt = -1;
        if (P.dashFireGap) m.gapEnd = Math.max(m.gapEnd, now + P.dashFireGap);
      }
      if (m.blowAt >= 0 && now >= m.blowAt) {
        out.blow = true;
        m.blowAt = -1;
      }

      // fire: blocked while the thumb is busy elsewhere
      if (now < m.gapEnd && want.fire) {
        out.fire = false;
        m.stats.fireBlocked++;
      }

      // aim
      if (P.aim === 'proto') {
        // the prototype's own targeting (src/touch.js autoAim): prefers enemies the held element counters
        const a = autoAim(state, out.switchTo || p.element, m.protoId || 0);
        m.protoId = a ? a.target.id : 0;
        if (a) {
          out.aimX = a.x;
          out.aimY = a.y;
          if (!a.fire) out.fire = false;
        }
      } else if (target) {
        if (P.aim === 'auto') {
          let tx = target.x;
          let ty = target.y;
          const el = out.switchTo || p.element;
          const B = BLOWS[el];
          if (P.autoLead && B.speed) {
            const d = Math.hypot(tx - p.x, ty - p.y);
            const t = Math.min(0.6, d / B.speed);
            tx += target.vx * t;
            ty += target.vy * t;
          }
          out.aimX = tx;
          out.aimY = ty;
        } else if (P.aim === 'manual') {
          const want = Math.atan2(target.y - p.y, target.x - p.x);
          if (m.aimAng === null) m.aimAng = want;
          let da = want - m.aimAng;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          m.aimAng += da * Math.min(1, (1 / 60) / P.aimLag);
          if (now >= m.aimErrT) {
            m.aimErr = gauss(rng) * P.aimNoise * DEG;
            m.aimErrT = now + 0.25;
          }
          const a = m.aimAng + m.aimErr;
          out.aimX = p.x + Math.cos(a) * 200;
          out.aimY = p.y + Math.sin(a) * 200;
        }
      }
      return out;
    },
  };
}

export { counterOf, ELEMENTS, BEATS };

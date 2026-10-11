// Elemental Blow — touch controls for phones and tablets (prototype).
//
// Only created on touch-first devices (primary pointer coarse), or with ?touch=1; ?touch=0 turns it off.
// Scheme (landscape):
//   left thumb   floating stick anywhere on the left half: move. A quick flick (swipe and lift) dashes.
//   right thumb  four element buttons in a circle laid out like the cycle (water top, fire right, air
//                bottom, earth left; each beats the next one clockwise), shown while the right thumb is up.
//                Pressing one selects it and the same touch becomes the aim stick, which attacks while
//                held: held still it aims at the best target (auto-aim), pushed it aims where it points.
//                Earth attacks once, on release: a tap slams the auto-aim target, a drag aims the slam.
//                Pressing free space on the right aims with the element already held.
//                DASH and BLOW buttons sit beside the circle.
//   auto-aim     the best target for the element held (countered enemies first, nearer first, resisted
//                ones last), leading moving targets a little. A ring marks it; a pulse marks the button
//                that beats the nearest enemy (?hint=0 turns the pulse off).
// It reads the sim state but never changes it: it only edits the per-step input object, like the bot.
// ?speed=0.9 runs the game at 90% speed on touch (playtest option, default 1).

import { ARENA, ELEMENTS, ELEMENT_COLORS, BEATS, BLOWS } from './config.js';
import { ICONS } from './ui.js';

const W = ARENA.w;
const H = ARENA.h;
// diamond order = the cycle diagram on the menu: water (top) > fire (right) > air (bottom) > earth (left)
const DIAMOND = [['water', 0, -1], ['fire', 1, 0], ['air', 0, 1], ['earth', -1, 0]];
const NAMES = { fire: 'FIRE', water: 'WATER', earth: 'EARTH', air: 'AIR' };
const RANGE = {
  fire: BLOWS.fire.range,
  water: BLOWS.water.range,
  air: BLOWS.air.range,
  earth: BLOWS.earth.reach + BLOWS.earth.radius + 30,
};

function param(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

export function isTouchDevice() {
  const q = param('touch');
  if (q === '0' || q === 'off' || q === 'false') return false;
  if (q === '1' || q === 'on' || q === 'true') return true;
  try {
    return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function mult(att, def) {
  if (BEATS[att] === def) return 2;
  if (att === def || BEATS[def] === att) return 0.5;
  return 1;
}

/**
 * Auto-aim: the best target for element `el` and where to aim. Pure (reads the sim state only), so the
 * touch study's bot proxy uses exactly the same targeting. Countered enemies count as 40% nearer,
 * resisted ones 70% further; anything out of the blow's reach or still materialising comes last;
 * the previous target (`prevId`) is kept unless another is clearly better.
 * @returns {null | { target: object, x: number, y: number, fire: boolean, mult: number }}
 */
export function autoAim(state, el, prevId = 0) {
  const p = state.player;
  let best = null;
  let bs = Infinity;
  for (const e of state.enemies) {
    if (e._dead) continue;
    const d = Math.max(0, Math.hypot(e.x - p.x, e.y - p.y) - e.r);
    const m = mult(el, e.element);
    let s = d * (m === 2 ? 0.6 : m === 1 ? 1 : 1.7);
    if (d > RANGE[el]) s += 3000; // out of reach: only when nothing is in reach
    if (e.spawnT > 0.5) s += 1500; // still materialising
    if (e.id === prevId) s *= 0.8; // stickiness: no flicker between two similar targets
    if (s < bs) {
      bs = s;
      best = e;
    }
  }
  if (!best) return null;
  let x = best.x;
  let y = best.y;
  const B = BLOWS[el];
  if (B.speed) {
    // modest lead: most of the way to where a steadily moving target will be
    const t = Math.min(0.5, Math.hypot(x - p.x, y - p.y) / B.speed);
    x += (best.vx || 0) * t * 0.8;
    y += (best.vy || 0) * t * 0.8;
  }
  // the earth slam is melee: hold it until the target is in reach instead of slamming thin air
  const fire = el !== 'earth' || Math.hypot(best.x - p.x, best.y - p.y) - best.r <= RANGE.earth;
  return { target: best, x, y, fire, mult: mult(el, best.element) };
}

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * @param {{ onPause?: () => void }} opts
 * @returns {null | { apply(input: object, state: object): object, frame(app: string, state: object): void, onStart(): void, timeScale: number }}
 */
export function createTouch(opts = {}) {
  if (!isTouchDevice()) return null;
  const root = document.documentElement;
  root.classList.add('touch');
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'touch.css';
  document.head.appendChild(css);

  const hintOn = param('hint') !== '0';
  const speed = Number(param('speed'));
  const timeScale = speed > 0.4 && speed <= 1.5 ? speed : 1;

  // ------------------------------------------------------------ DOM
  const layer = h('div', 'touch-layer');
  layer.id = 'touch';
  layer.hidden = true;
  const ghost = h('div', 't-stick ghost');
  ghost.appendChild(h('div', 't-knob'));
  ghost.appendChild(h('span', 't-ghost-label', 'MOVE'));
  const stick = h('div', 't-stick');
  const knob = h('div', 't-knob');
  stick.appendChild(knob);
  stick.hidden = true;
  const reticle = h('div', 't-reticle');
  reticle.hidden = true;
  // the aim stick: a press on an element button (or free space on the right) turns into it
  const aimStick = h('div', 't-stick t-aim');
  const aimKnob = h('div', 't-knob');
  aimStick.appendChild(aimKnob);
  aimStick.hidden = true;

  const diamond = h('div', 't-diamond');
  // clockwise "beats" arrows between the pads, in the colour of the pad that does the beating
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '-50 -50 100 100');
  ring.setAttribute('class', 't-ring');
  ring.setAttribute('aria-hidden', 'true');
  let ringSvg = '';
  DIAMOND.forEach(([el], i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 2 + 0.42;
    const a1 = a0 + Math.PI / 2 - 0.84;
    const r = 34;
    const x0 = (r * Math.cos(a0)).toFixed(1);
    const y0 = (r * Math.sin(a0)).toFixed(1);
    const x1 = (r * Math.cos(a1)).toFixed(1);
    const y1 = (r * Math.sin(a1)).toFixed(1);
    const c = ELEMENT_COLORS[el];
    ringSvg += `<path d="M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" opacity=".75"/>`;
    const ah = a1 + 0.02;
    const tx = r * Math.cos(ah);
    const ty = r * Math.sin(ah);
    const dx = -Math.sin(ah);
    const dy = Math.cos(ah);
    const px = Math.cos(ah);
    const py = Math.sin(ah);
    const pts = [[tx + dx * 4, ty + dy * 4], [tx - dx * 1.5 + px * 3.5, ty - dy * 1.5 + py * 3.5], [tx - dx * 1.5 - px * 3.5, ty - dy * 1.5 - py * 3.5]];
    ringSvg += `<path d="M${pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L')}z" fill="${c}" opacity=".9"/>`;
  });
  ringSvg += '<text x="0" y="3.5" text-anchor="middle" font-size="10" font-weight="900" fill="#fff" opacity=".55">2&#215;</text>';
  ring.innerHTML = ringSvg;
  diamond.appendChild(ring);

  const pads = {};
  for (const [el] of DIAMOND) {
    const b = h('div', 't-pad');
    b.dataset.el = el;
    b.style.setProperty('--c', ELEMENT_COLORS[el]);
    const cd = h('span', 't-cd');
    const icon = h('span', 't-icon');
    icon.innerHTML = ICONS[el] || '';
    b.append(cd, icon, h('span', 't-name', NAMES[el]));
    diamond.appendChild(b);
    pads[el] = { b, active: null, hint: null, cd: -1 };
  }
  const dash = h('div', 't-btn t-dash');
  dash.dataset.t = 'dash';
  const dashCd = h('span', 't-cd');
  dash.append(dashCd, h('span', 't-name', 'DASH'));
  const nova = h('div', 't-btn t-nova');
  nova.dataset.t = 'blow';
  const novaFill = h('span', 't-fill');
  nova.append(novaFill, h('span', 't-name', 'BLOW'));
  const pause = h('div', 't-btn t-pause');
  pause.dataset.t = 'pause';
  pause.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  pause.setAttribute('aria-label', 'Pause');

  layer.append(ghost, stick, aimStick, reticle, diamond, dash, nova, pause);
  document.body.appendChild(layer);

  // portrait notice (CSS shows it on touch devices held upright)
  const rotate = h('div', 't-rotate');
  rotate.innerHTML =
    '<div class="t-rotate-box"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="20" y="6" width="24" height="42" rx="4" fill="none" stroke="currentColor" stroke-width="3"/>'
    + '<path d="M50 40a18 18 0 0 1-18 18M36 54l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'
    + '<p class="t-rotate-title">Turn your phone sideways</p>'
    + '<p class="t-rotate-sub">Elemental Blow plays in landscape. If the screen does not turn, switch off portrait orientation lock.</p></div>';
  document.body.appendChild(rotate);

  // ------------------------------------------------------------ layout
  let vw = 0;
  let vh = 0;
  let sc = 1;
  let ox = 0;
  let oy = 0;
  let stickR = 48;
  let padSize = 52;
  function layout() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    sc = Math.min(vw / W, vh / H);
    ox = (vw - W * sc) / 2;
    oy = (vh - H * sc) / 2;
    const m = Math.min(vw, vh);
    const P = Math.round(Math.max(44, Math.min(74, m * 0.13))); // pad size
    padSize = P;
    const gap = Math.round(P * 0.08);
    stickR = Math.round(Math.max(40, Math.min(70, m * 0.12)));
    root.style.setProperty('--t-pad', P + 'px');
    root.style.setProperty('--t-stick', stickR * 2 + 'px');
    // diamond: centre offset from the bottom-right corner (safe areas are added in CSS)
    const span = P + gap; // centre-to-centre along an axis
    const dw = 2 * span + P;
    diamond.style.width = dw + 'px';
    diamond.style.height = dw + 'px';
    for (const [el, dx, dy] of DIAMOND) {
      const s = pads[el].b.style;
      s.left = dw / 2 + dx * span - P / 2 + 'px';
      s.top = dw / 2 + dy * span - P / 2 + 'px';
    }
    root.style.setProperty('--t-diamond', dw + 'px');
    rects = null; // measured again on the next visible frame
  }
  // controls the player can stand under: fade them so the fight shows through (they keep working)
  const fadeable = [diamond, dash, nova];
  let rects = null;
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  // ------------------------------------------------------------ touch handling
  const FLICK_MS = 250; // a left touch shorter than this that travelled far enough is a dash flick
  const deadPx = () => Math.max(12, stickR * 0.25); // aim stick: held within this, auto-aim
  let used = false; // set by the first touch on the layer; until then keyboard/mouse input passes through
  let st = null; // move-stick touch: { id, bx, by, x, y, sx, sy, t0 (event time) }
  let aim = null; // aim touch: { id, el (the element its press picked, or null), bx, by, x, y }
  let curEl = null; // element held, as of the last sim step
  let pendSwitch = null;
  let pendDash = false;
  let pendDashDir = null; // a flick dashes this way: [dx, dy]
  let pendBlow = false;
  let pendEarth = null; // earth released: { dir: [dx, dy] or null (auto-aim), until: ms } until it slams

  function hit(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !layer.contains(el)) return null;
    const b = el.closest('[data-t]');
    return b ? { btn: b.dataset.t, el: b } : null;
  }

  /** Inside the circle's box: the nearest button within reach, or null in the middle and corners (keeps the
   *  element held). Outside the box: undefined. */
  function circlePick(x, y) {
    const r = diamond.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return undefined;
    let best = null;
    let bd = Infinity;
    for (const [el] of DIAMOND) {
      const b = pads[el].b.getBoundingClientRect();
      const d = Math.hypot(x - (b.left + b.width / 2), y - (b.top + b.height / 2));
      if (d < bd) {
        bd = d;
        best = el;
      }
    }
    return bd <= padSize * 0.8 ? best : null;
  }

  function press(b) {
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 120);
  }

  function paintAim() {
    const el = (aim && aim.el) || curEl || 'fire';
    aimStick.style.setProperty('--c', ELEMENT_COLORS[el]);
    aimStick.classList.toggle('earth', el === 'earth');
  }

  // a stick whose thumb drifts too far drags its base along, so it never "runs out"
  function follow(t, x, y, view, knobEl) {
    let dx = x - t.bx;
    let dy = y - t.by;
    const l = Math.hypot(dx, dy);
    const max = stickR * 1.5;
    if (l > max) {
      t.bx += (dx / l) * (l - max);
      t.by += (dy / l) * (l - max);
      dx = x - t.bx;
      dy = y - t.by;
      view.style.transform = `translate(${t.bx - stickR}px, ${t.by - stickR}px)`;
    }
    t.x = x;
    t.y = y;
    const kl = Math.min(stickR, Math.hypot(dx, dy));
    const ka = Math.atan2(dy, dx);
    knobEl.style.transform = `translate(${Math.cos(ka) * kl}px, ${Math.sin(ka) * kl}px)`;
  }

  function onStart(e) {
    e.preventDefault();
    used = true;
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;
      const hb = hit(x, y);
      if (hb) {
        press(hb.el);
        if (hb.btn === 'dash') pendDash = true;
        else if (hb.btn === 'blow') pendBlow = true;
        else if (hb.btn === 'pause' && opts.onPause) opts.onPause();
        continue;
      }
      const pick = circlePick(x, y);
      if (pick !== undefined || x >= vw * 0.5) {
        if (pick) {
          pendSwitch = pick;
          press(pads[pick].b);
        }
        if (aim) {
          // a second finger on a button while aiming: it switches, the first touch keeps aiming
          if (pick) aim.el = pick;
          paintAim();
          continue;
        }
        aim = { id: t.identifier, el: pick || null, bx: x, by: y, x, y };
        aimStick.hidden = false;
        aimStick.style.transform = `translate(${x - stickR}px, ${y - stickR}px)`;
        aimKnob.style.transform = 'translate(0px, 0px)';
        diamond.classList.add('holding');
        paintAim();
      } else if (!st) {
        st = { id: t.identifier, bx: x, by: y, x, y, sx: x, sy: y, t0: e.timeStamp }; // event times: a busy frame can't stretch a flick
        stick.hidden = false;
        stick.style.transform = `translate(${x - stickR}px, ${y - stickR}px)`;
        knob.style.transform = 'translate(0px, 0px)';
        ghost.classList.add('away');
      }
    }
  }

  function onMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (st && t.identifier === st.id) follow(st, t.clientX, t.clientY, stick, knob);
      else if (aim && t.identifier === aim.id) follow(aim, t.clientX, t.clientY, aimStick, aimKnob);
    }
  }

  function endAim() {
    aim = null;
    aimStick.hidden = true;
    diamond.classList.remove('holding');
  }

  function onEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (st && t.identifier === st.id) {
        const dx = st.x - st.sx;
        const dy = st.y - st.sy;
        const l = Math.hypot(dx, dy);
        if (e.type === 'touchend' && e.timeStamp - st.t0 < FLICK_MS && l > Math.max(24, stickR * 0.5)) {
          pendDash = true;
          pendDashDir = [dx / l, dy / l];
        }
        st = null;
        stick.hidden = true;
        ghost.classList.remove('away');
      } else if (aim && t.identifier === aim.id) {
        if (e.type === 'touchend' && (aim.el || curEl) === 'earth') {
          // earth slams on release: aimed by the drag, or at the auto-aim target after a tap
          const dx = aim.x - aim.bx;
          const dy = aim.y - aim.by;
          pendEarth = { dir: Math.hypot(dx, dy) > deadPx() ? [dx, dy] : null, until: performance.now() + 350 };
        }
        endAim();
      }
    }
  }

  function releaseAll() {
    st = null;
    endAim();
    stick.hidden = true;
    ghost.classList.remove('away');
    pendSwitch = null;
    pendDash = false;
    pendDashDir = null;
    pendBlow = false;
    pendEarth = null;
  }

  layer.addEventListener('touchstart', onStart, { passive: false });
  layer.addEventListener('touchmove', onMove, { passive: false });
  layer.addEventListener('touchend', onEnd, { passive: false });
  layer.addEventListener('touchcancel', onEnd, { passive: false });
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------------ auto-aim
  let targetId = 0;
  let targetMult = 1;
  function nearestThreat(state) {
    const p = state.player;
    let best = null;
    let bd = 420;
    for (const e of state.enemies) {
      if (e._dead || e.spawnT > 0.5) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Merge touch input into the sampled keyboard/mouse input for one sim step. */
  function apply(inp, state) {
    if (!used || !state || !state.player) return inp;
    const p = state.player;
    const out = { ...inp };
    if (st && !inp.moveX && !inp.moveY) {
      let dx = (st.x - st.bx) / stickR;
      let dy = (st.y - st.by) / stickR;
      const l = Math.hypot(dx, dy);
      if (l < 0.15) {
        dx = 0;
        dy = 0;
      } else if (l > 1) {
        dx /= l;
        dy /= l;
      }
      out.moveX = dx;
      out.moveY = dy;
    }
    if (pendDashDir) {
      // the sim dashes along the move vector: point it where the flick went
      out.moveX = pendDashDir[0];
      out.moveY = pendDashDir[1];
    }
    if (pendSwitch && !inp.switchTo) out.switchTo = pendSwitch;
    if (pendDash) out.dash = true;
    if (pendBlow) out.blow = true;
    pendSwitch = null;
    pendDash = false;
    pendDashDir = null;
    pendBlow = false;

    const el = out.switchTo || p.element;
    curEl = el;
    let dir = null; // aimed by hand: [dx, dy]
    if (aim) {
      const dx = aim.x - aim.bx;
      const dy = aim.y - aim.by;
      if (Math.hypot(dx, dy) > deadPx()) dir = [dx, dy];
    }
    if (pendEarth && (el !== 'earth' || performance.now() > pendEarth.until)) pendEarth = null;
    if (pendEarth && !aim) dir = pendEarth.dir;
    if (dir) {
      out.aimX = p.x + dir[0] * 10;
      out.aimY = p.y + dir[1] * 10;
      targetId = 0;
    } else {
      const a = autoAim(state, el, targetId);
      targetId = a ? a.target.id : 0;
      targetMult = a ? a.mult : 1;
      if (a) {
        out.aimX = a.x;
        out.aimY = a.y;
      }
    }
    // attack while the aim stick is held; earth only once, on release (kept until its cooldown allows)
    if (aim && el !== 'earth') out.fire = true;
    else if (pendEarth && !aim && p.cooldowns.earth <= 0) {
      out.fire = true;
      pendEarth = null;
    }
    return out;
  }

  // ------------------------------------------------------------ per-frame view
  const cache = {};
  const set = (k, v, fn) => {
    if (cache[k] !== v) {
      cache[k] = v;
      fn(v);
    }
  };
  function frame(app, state) {
    const playing = app === 'playing' && !!state;
    set('vis', playing, (v) => {
      layer.hidden = !v;
      root.classList.toggle('t-playing', v);
      if (!v) releaseAll();
    });
    // held upright mid-run: pause (the rotate notice covers the screen)
    if (playing && vh > vw && opts.onPause) opts.onPause();
    if (!playing) return;
    const p = state.player;
    if (!rects) rects = fadeable.map((b) => b.getBoundingClientRect());
    const px = ox + p.x * sc;
    const py = oy + p.y * sc;
    const near = (p.r || 18) * sc + 24;
    fadeable.forEach((b, i) => {
      const r = rects[i];
      const under = px > r.left - near && px < r.right + near && py > r.top - near && py < r.bottom + near;
      set('fade' + i, under, (v) => b.classList.toggle('faded', v));
    });
    for (const [el] of DIAMOND) {
      const pd = pads[el];
      const act = p.element === el;
      if (pd.active !== act) {
        pd.active = act;
        pd.b.classList.toggle('active', act);
      }
      const cd = act ? Math.round(Math.max(0, Math.min(1, p.cooldowns[el] || 0)) * 20) : 0;
      if (pd.cd !== cd) {
        pd.cd = cd;
        pd.b.style.setProperty('--cd', cd * 18 + 'deg');
      }
    }
    const threat = hintOn ? nearestThreat(state) : null;
    const hintEl = threat ? ELEMENTS.find((x) => BEATS[x] === threat.element) : null;
    for (const [el] of DIAMOND) {
      const on = el === hintEl && p.element !== el;
      if (pads[el].hint !== on) {
        pads[el].hint = on;
        pads[el].b.classList.toggle('hint', on);
      }
    }
    const dMax = Math.max(0.001, p.dashCdMax || 1);
    set('dcd', Math.round(Math.min(1, (p.dashCd || 0) / dMax) * 20), (v) => dash.style.setProperty('--cd', v * 18 + 'deg'));
    set('drd', (p.dashCd || 0) <= 0, (v) => dash.classList.toggle('ready', v));
    set('nv', Math.floor(Math.min(100, p.blow || 0) / 5), (v) => novaFill.style.height = v * 5 + '%');
    set('nvr', (p.blow || 0) >= 100, (v) => nova.classList.toggle('ready', v));

    if (aim) set('aimEl', curEl, () => paintAim());
    // target ring
    const tg = targetId ? state.enemies.find((e) => e.id === targetId) : null;
    if (tg && used) {
      const r = tg.r * sc + 7;
      const x = ox + tg.x * sc;
      const y = oy + tg.y * sc;
      reticle.hidden = false;
      reticle.style.width = reticle.style.height = 2 * r + 'px';
      reticle.style.transform = `translate(${x - r}px, ${y - r}px)`;
      set('rm', targetMult, (v) => {
        reticle.classList.toggle('x2', v === 2);
        reticle.classList.toggle('half', v === 0.5);
      });
    } else {
      reticle.hidden = true;
    }
  }

  // ------------------------------------------------------------ start: full screen + landscape where allowed
  function onStartRun() {
    const d = document;
    const el = d.documentElement;
    try {
      if (!(d.fullscreenElement || d.webkitFullscreenElement)) {
        const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
        const lock = () => {
          try {
            const o = screen.orientation;
            if (o && o.lock) o.lock('landscape').catch(() => {});
          } catch {
            /* not supported */
          }
        };
        if (req && req.then) req.then(lock, () => {});
      }
    } catch {
      /* iPhone Safari has no full screen API: Add to Home Screen gives a full-screen app instead */
    }
  }

  return { apply, frame, onStart: onStartRun, timeScale, releaseAll };
}

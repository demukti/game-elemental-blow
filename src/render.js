// Elemental Blow - canvas renderer. Zero imports; all drawing, particles, shake/shock camera, damage numbers.
const W = 1600, H = 900;
const TAU = Math.PI * 2;
const COLORS = { fire: '#ff6a3d', water: '#3da9ff', earth: '#8bd450', air: '#e8e6ff' };
const DARK = { fire: '#3a130b', water: '#0d2338', earth: '#1b2b10', air: '#26253a' };
const ELS = ['fire', 'water', 'earth', 'air'];
const FALLBACK = '#c8c8d8';
const EMPTY = [];
const DASH = [5, 5];
const NODASH = [];
const HOSTILE = '#ff2d4a';

const col = (el) => COLORS[el] || FALLBACK;
const dark = (el) => DARK[el] || '#22222c';
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

function hexToRgb(hex) {
  if (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  return [220, 220, 235];
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let dpr = 1, scale = 1, ox = 0, oy = 0, cssW = W, cssH = H;
  // Backing-store budget. The renderer is fill-rate bound (additive glows, particles, full-screen
  // passes), so cost scales with backing pixels, not with the window's CSS size. Never allocate more
  // than MAX_PIXELS; on top of that `quality` shrinks the store further while frames run long.
  const MAX_PIXELS = 2560 * 1440;
  const Q_MIN = 0.55, Q_MAX = 1;
  let quality = Q_MAX;
  let ftAvg = 1 / 60, qCooldown = 1.5;   // grace period: first frames bake sprites and load fonts
  let t = 0;                       // renderer clock
  let shake = 0;
  let flashA = 0, flashColor = '#ffffff';
  let lastPlayer = { x: W / 2, y: H / 2, element: 'fire' };
  let bossGhost = 1;
  const tintA = { fire: 0, water: 0, earth: 0, air: 0 };

  // ---------- sprite caches ----------
  const glowCache = new Map();
  function glowSprite(color) {
    let c = glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const [r, gg, b] = hexToRgb(color);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.55)`);
    grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.15)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
    return c;
  }
  // additive glow; caller owns globalAlpha restore (we reset to 1)
  function glowTo(g, x, y, r, color, a) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a;
    g.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  function glow(x, y, r, color, a) { glowTo(ctx, x, y, r, color, a); }

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------- static floor ----------
  let floorCanvas = null, vignetteCanvas = null;
  function sigil(g, el, x, y, s) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = col(el);
    g.lineWidth = 3;
    g.globalAlpha = 0.16;
    g.beginPath(); g.arc(0, 0, s * 1.5, 0, TAU); g.stroke();
    g.beginPath();
    if (el === 'fire' || el === 'earth') { g.moveTo(0, -s); g.lineTo(s * 0.87, s * 0.5); g.lineTo(-s * 0.87, s * 0.5); }
    else { g.moveTo(0, s); g.lineTo(s * 0.87, -s * 0.5); g.lineTo(-s * 0.87, -s * 0.5); }
    g.closePath(); g.stroke();
    if (el === 'earth') { g.beginPath(); g.moveTo(-s * 0.6, 0); g.lineTo(s * 0.6, 0); g.stroke(); }
    if (el === 'air') { g.beginPath(); g.moveTo(-s * 0.55, 0); g.lineTo(s * 0.55, 0); g.stroke(); }
    g.restore();
  }
  function buildFloor() {
    floorCanvas = makeCanvas(W, H);
    const g = floorCanvas.getContext('2d');
    const bg = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 950);
    bg.addColorStop(0, '#171a2b'); bg.addColorStop(1, '#0a0b15');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // tiles
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 50) {
      g.strokeStyle = x % 200 === 0 ? 'rgba(150,160,220,0.09)' : 'rgba(150,160,220,0.04)';
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke();
    }
    for (let y = 0; y <= H; y += 50) {
      g.strokeStyle = y % 200 === 0 ? 'rgba(150,160,220,0.09)' : 'rgba(150,160,220,0.04)';
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
    }
    // central rune circles
    g.save(); g.translate(W / 2, H / 2);
    g.strokeStyle = 'rgba(170,180,255,0.10)'; g.lineWidth = 2;
    for (const rr of [130, 260, 380]) { g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke(); }
    g.lineWidth = 1;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU, long = i % 4 === 0;
      g.beginPath();
      g.moveTo(Math.cos(a) * 260, Math.sin(a) * 260);
      g.lineTo(Math.cos(a) * (long ? 290 : 275), Math.sin(a) * (long ? 290 : 275));
      g.stroke();
    }
    g.lineWidth = 2; g.strokeStyle = 'rgba(170,180,255,0.08)';
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + k * Math.PI / 4;
        g.lineTo(Math.cos(a) * 380, Math.sin(a) * 380);
      }
      g.closePath(); g.stroke();
    }
    g.restore();
    sigil(g, 'fire', 280, 170, 42); sigil(g, 'water', 1320, 170, 42);
    sigil(g, 'earth', 280, 730, 42); sigil(g, 'air', 1320, 730, 42);
    // speckle
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(180,190,255,${0.02 + hash(i, 3) * 0.05})`;
      g.fillRect(hash(i, 1) * W, hash(i, 2) * H, 2, 2);
    }
    // border
    g.lineWidth = 6; g.strokeStyle = '#2c3157'; g.strokeRect(3, 3, W - 6, H - 6);
    g.lineWidth = 2; g.strokeStyle = 'rgba(160,170,255,0.45)'; g.strokeRect(12, 12, W - 24, H - 24);
    g.lineWidth = 4; g.strokeStyle = 'rgba(210,220,255,0.7)';
    const L = 46;
    for (const [cx, cy, sx, sy] of [[12, 12, 1, 1], [W - 12, 12, -1, 1], [12, H - 12, 1, -1], [W - 12, H - 12, -1, -1]]) {
      g.beginPath(); g.moveTo(cx + sx * L, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + sy * L); g.stroke();
    }
    // vignette
    vignetteCanvas = makeCanvas(W, H);
    const v = vignetteCanvas.getContext('2d');
    const vg = v.createRadialGradient(W / 2, H / 2, 380, W / 2, H / 2, 960);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,8,0.72)');
    v.fillStyle = vg; v.fillRect(0, 0, W, H);
  }

  // ---------- particles ----------
  const MAXP = 400;
  const parts = [];
  for (let i = 0; i < MAXP; i++) parts.push({ life: 0, max: 1, x: 0, y: 0, vx: 0, vy: 0, size: 1, color: '#fff', kind: 0, drag: 0, grav: 0 });
  let pHead = 0;
  function spawn(kind, x, y, vx, vy, size, life, color, drag, grav) {
    const p = parts[pHead]; pHead = (pHead + 1) % MAXP;
    p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.size = size; p.life = life; p.max = life;
    p.color = color; p.drag = drag || 0; p.grav = grav || 0;
  }
  function burst(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.65);
      spawn(0, x, y, Math.cos(a) * s, Math.sin(a) * s, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), color, 2.5, 0);
    }
  }
  function sparks(x, y, color, n, speed, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.6);
      spawn(3, x, y, Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 1.5, life * (0.6 + Math.random() * 0.5), color, 3, 0);
    }
  }
  function ring(x, y, color, r, life) { spawn(1, x, y, 0, 0, r, life, color, 0, 0); }
  function smoke(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * Math.random();
      spawn(2, x, y, Math.cos(a) * s, Math.sin(a) * s, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), color, 3, 0);
    }
  }
  function updateParticles(dt) {
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.kind === 1) continue;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function drawParticles() {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i];
      if (p.life <= 0) continue;
      const k = p.life / p.max;
      if (p.kind === 1) {
        const e = 1 - k, rr = p.size * (1 - (1 - e) * (1 - e) * (1 - e));
        ctx.globalAlpha = k * 0.9;
        ctx.strokeStyle = p.color; ctx.lineWidth = 1 + 6 * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.stroke();
      } else if (p.kind === 3) {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * k + 0.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.stroke();
      } else if (p.kind === 2) {
        const rr = p.size * (1.6 - k * 0.6);
        ctx.globalAlpha = k * 0.35;
        ctx.drawImage(glowSprite(p.color), p.x - rr * 1.6, p.y - rr * 1.6, rr * 3.2, rr * 3.2);
      } else {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size * (0.4 + k * 0.6)), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- damage numbers ----------
  const MAXN = 48;
  const nums = [];
  for (let i = 0; i < MAXN; i++) nums.push({ life: 0, max: 1, x: 0, y: 0, vy: 0, text: '', color: '#fff', size: 20, big: false });
  let nHead = 0;
  function addNumber(x, y, text, color, size, big) {
    const n = nums[nHead]; nHead = (nHead + 1) % MAXN;
    n.x = x + (Math.random() - 0.5) * 18; n.y = y - 14; n.vy = -70 - Math.random() * 30;
    n.text = text; n.color = color; n.size = size; n.big = big; n.life = n.max = big ? 1.0 : 0.75;
  }
  function drawNumbers(dt) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; i < MAXN; i++) {
      const n = nums[i];
      if (n.life <= 0) continue;
      n.life -= dt; n.y += n.vy * dt; n.vy *= Math.max(0, 1 - 2.2 * dt);
      const k = clamp(n.life / n.max, 0, 1);
      const pop = n.big ? 1 + 0.5 * Math.max(0, (k - 0.85) / 0.15) : 1;
      ctx.globalAlpha = Math.min(1, k * 2.2);
      ctx.font = `800 ${Math.round(n.size * pop)}px system-ui, "Segoe UI", Arial, sans-serif`;
      ctx.lineWidth = n.big ? 5 : 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(n.text, n.x, n.y);
      ctx.fillStyle = n.color; ctx.fillText(n.text, n.x, n.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- afterimages ----------
  const MAXA = 14;
  const after = [];
  for (let i = 0; i < MAXA; i++) after.push({ life: 0, x: 0, y: 0, angle: 0, color: '#fff' });
  let aHead = 0, aTimer = 0;

  // ---------- ambient motes ----------
  const motes = [];
  for (let i = 0; i < 70; i++) {
    motes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 16, vy: -6 - Math.random() * 22,
      s: 2 + Math.random() * 4, el: ELS[i % 4], ph: Math.random() * TAU });
  }
  function drawMotes(dt, count, boost) {
    for (let i = 0; i < count; i++) {
      const m = motes[i];
      m.x += (m.vx + Math.sin(t * 0.6 + m.ph) * 12) * dt; m.y += m.vy * dt;
      if (m.y < -20) { m.y = H + 20; m.x = Math.random() * W; }
      if (m.x < -20) m.x = W + 20; else if (m.x > W + 20) m.x = -20;
      const a = (0.25 + 0.2 * Math.sin(t * 1.3 + m.ph)) * boost;
      glow(m.x, m.y, m.s * 5, col(m.el), a);
    }
  }

  // ---------- events ----------
  function addShake(v) { shake = Math.min(34, shake + v); }
  function flash(color, a) { flashColor = color; flashA = Math.max(flashA, a); }

  // ---------- shock: shudder + zoom punch + shockwave ring + flash ----------
  // All of it is camera transform and a few stroked arcs: no extra full-screen passes. With
  // prefers-reduced-motion the jitter, zoom and rotation scale to 0; rings and flash stay.
  let MOTION = 1;
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) MOTION = 0;
  } catch (_) { /* no matchMedia */ }
  // Camera caps: the combined shake+shudder offset (world px), the total magnification and the
  // rotation wobble. The overscan in render() derives from these, so the floor always covers the clip.
  const OFF_MAX = 20, ZOOM_MAX = 1.06, ROT_MAX = 0.006;
  let shud = 0, shudF = 30, shudD = 11, shudAx = 1, shudAy = 0, shudPh = 0;   // shudder envelope
  let zoomK = 0, zoomT = 0, zoomHold = 0, zoomDur = 0.3, zoomX = W / 2, zoomY = H / 2;
  let rotA = 0, vigA = 0, camZoom = 1, camOff = 0;
  // Per-kind multipliers over the standard impact; unknown kinds use STD. Any key can be
  // overridden per call through opts.
  const STD = { jitter: 1, freq: 30, decay: 11, zoom: 1, rot: 0.15, ring: 1, flash: 1, vig: 1, hold: 0 };
  const KINDS = {
    quake: { jitter: 0.7, freq: 8, decay: 2.2, zoom: 0.3, rot: 1, ring: 0.7, flash: 0.4, vig: 1.2 },
    roar: { jitter: 0.15, zoom: 0.5, rot: 0, ring: 1.4, flash: 1.3, vig: 0.6 },
  };
  const MAXW = 6;
  const waves = [];
  for (let i = 0; i < MAXW; i++) waves.push({ life: 0, max: 1, x: 0, y: 0, r0: 0, r1: 0, w: 10, color: '#fff' });
  let wHead = 0;
  function shockwave(x, y, color, r0, r1, w, life) {
    const s = waves[wHead]; wHead = (wHead + 1) % MAXW;
    s.x = x; s.y = y; s.color = color; s.r0 = r0; s.r1 = r1; s.w = w; s.life = s.max = life;
  }
  // shock(x, y, power 0..1, color, opts?) with opts: kind ('quake' | 'roar' | other = standard),
  // dx/dy (shudder direction), r (ring radius), plus any STD key to override (jitter, zoom, ring, flash, hold...).
  function shock(x, y, power, color, opts) {
    const o = opts || STD, k = KINDS[o.kind] || STD;
    const get = (name, d) => num(o[name], num(k[name], num(STD[name], d)));
    const p = clamp(num(power, 0.5), 0, 1);
    x = clamp(num(x, lastPlayer.x), 0, W); y = clamp(num(y, lastPlayer.y), 0, H);
    const c = typeof color === 'string' ? color : col(color);
    // shudder: oscillating, decays with its own rate; biggest live request wins
    const amp = 12 * p * get('jitter', 1) * MOTION;
    if (amp > shud) {
      shud = amp; shudF = get('freq', 30); shudD = get('decay', 11); shudPh = Math.random() * TAU;
      const dx = num(o.dx, 0), dy = num(o.dy, 0), L = Math.hypot(dx, dy);
      if (L > 1e-6) { shudAx = dx / L; shudAy = dy / L; }
      else { const a = Math.random() * TAU; shudAx = Math.cos(a); shudAy = Math.sin(a); }
    }
    rotA = Math.max(rotA, ROT_MAX * p * get('rot', 0) * MOTION);
    // zoom punch anchored near the impact, optional hold (freeze-frame feel) before easing back
    const zk = 0.05 * p * get('zoom', 1) * MOTION;
    if (zk > 0 && zk >= camZoom - 1) {
      zoomK = zk; zoomT = 0; zoomHold = clamp(get('hold', 0), 0, 0.2); zoomDur = 0.25 + 0.15 * p;
      zoomX = clamp(x, W * 0.15, W * 0.85); zoomY = clamp(y, H * 0.15, H * 0.85);
    }
    // expanding ring with a thin bright leading edge
    const rm = get('ring', 1);
    if (rm > 0) {
      const r1 = num(o.r, (180 + 520 * p) * rm), life = 0.3 + 0.4 * p * Math.min(rm, 1.4);
      shockwave(x, y, c, 16 + 40 * p, r1, 6 + 16 * p, life);
      if (p >= 0.6) shockwave(x, y, '#ffffff', 8, r1 * 0.7, 3 + 5 * p, life * 0.7);
    }
    const fa = (0.06 + 0.3 * p) * get('flash', 1);
    if (fa > 0.01) flash(c, Math.min(0.6, fa));
    if (p >= 0.6) vigA = Math.max(vigA, Math.min(0.6, 1.1 * (p - 0.5) * get('vig', 1)));
  }
  function updateShock(dt) {
    shud *= Math.exp(-dt * shudD); if (shud < 0.05) shud = 0;
    rotA *= Math.exp(-dt * 4); if (rotA < 1e-4) rotA = 0;
    vigA = Math.max(0, vigA - dt * 3);
    camZoom = 1;
    if (zoomK > 0) {
      zoomT += dt;
      const u = clamp((zoomT - zoomHold) / zoomDur, 0, 1);
      camZoom = 1 + zoomK * (1 - u) * (1 - u);
      if (u >= 1) zoomK = 0;
    }
  }
  function drawWaves(dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAXW; i++) {
      const s = waves[i]; if (s.life <= 0) continue;
      s.life -= dt;
      const k = clamp(s.life / s.max, 0, 1), p = 1 - k, e = 1 - (1 - p) * (1 - p) * (1 - p);
      const r = s.r0 + (s.r1 - s.r0) * e, band = s.w * (0.4 + 0.6 * k);
      // three arcs stand in for a lineWidth gradient: wide faint trail, narrower body, bright edge
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.18 * k; ctx.lineWidth = band * 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, r - band), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.42 * k; ctx.lineWidth = band * 0.7;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, r - band * 0.3), 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = Math.min(1, k * 1.4); ctx.lineWidth = 1.5 + 1.5 * k;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function handleEvents(events) {
    if (!events || !events.length) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || typeof e.type !== 'string') continue;
      const x = num(e.x, lastPlayer.x), y = num(e.y, lastPlayer.y);
      const c = col(e.element);
      switch (e.type) {
        case 'shoot':
          sparks(x, y, c, 3, 160, 0.18);
          break;
        case 'hit': {
          const m = num(e.mult, 1), d = Math.round(num(e.dmg, 0));
          sparks(x, y, c, m >= 2 ? 10 : m < 1 ? 3 : 6, m >= 2 ? 360 : 240, 0.3);
          if (m >= 2) { ring(x, y, c, 34, 0.3); burst(x, y, '#ffffff', 3, 200, 3, 0.25); }
          if (d > 0 || m !== 1) {
            if (m >= 2) addNumber(x, y, d + '!', c, 32, true);
            else if (m < 1) addNumber(x, y, String(d), '#9a9aa8', 14, false);
            else addNumber(x, y, String(d), '#ffffff', 20, false);
          }
          break;
        }
        case 'enemyDie':
          burst(x, y, c, 16, 320, 4, 0.55);
          sparks(x, y, c, 10, 400, 0.4);
          smoke(x, y, c, 4, 90, 14, 0.5);
          ring(x, y, c, e.enemyType === 'boss' ? 160 : 55, 0.4);
          addShake(e.enemyType === 'boss' ? 26 : e.enemyType === 'brute' ? 7 : 2.5);
          if (e.enemyType === 'boss') {
            flash('#ffffff', 0.5); burst(x, y, '#ffffff', 20, 500, 5, 0.8);
            shock(x, y, 1, c, { jitter: 0.7, ring: 1.7, flash: 0, hold: 0.1 });
          } else if (e.enemyType === 'brute') shock(x, y, 0.3, c, { jitter: 0.5, zoom: 0.6, flash: 0 });
          break;
        case 'playerHit':
          addShake(14); flash(HOSTILE, 0.38);
          shock(x, y, 0.35, HOSTILE, { jitter: 0.8, zoom: 0.3, ring: 0, flash: 0, dx: num(e.dx, x - lastPlayer.x), dy: num(e.dy, y - lastPlayer.y) });
          sparks(x, y, HOSTILE, 14, 420, 0.4); burst(x, y, '#ffffff', 4, 220, 3, 0.3);
          addNumber(x, y - 20, '-' + Math.round(num(e.dmg, 0)) + (e.resisted ? ' RESIST' : ''), e.resisted ? '#9d93c4' : '#ff4a5e', e.resisted ? 22 : 28, true);
          break;
        case 'dash':
          burst(x, y, col(lastPlayer.element), 12, 220, 4, 0.4);
          ring(x, y, col(lastPlayer.element), 50, 0.3);
          break;
        case 'blow': {
          const r = num(e.r, 300);
          addShake(24); flash(c, 0.5);
          shock(x, y, 1, c, { jitter: 0.6, r: r * 1.6, flash: 0, hold: 0.08 });
          ring(x, y, c, r, 0.55); ring(x, y, '#ffffff', r * 0.7, 0.4); ring(x, y, c, r * 0.4, 0.3);
          sparks(x, y, c, 40, 700, 0.6); burst(x, y, '#ffffff', 10, 400, 4, 0.5);
          break;
        }
        case 'blowReady':
          ring(lastPlayer.x, lastPlayer.y, '#ffd84d', 90, 0.5); flash('#ffd84d', 0.12);
          sparks(lastPlayer.x, lastPlayer.y, '#ffd84d', 12, 300, 0.4);
          break;
        case 'switch':
          ring(lastPlayer.x, lastPlayer.y, col(e.element), 48, 0.3);
          burst(lastPlayer.x, lastPlayer.y, col(e.element), 8, 160, 3, 0.35);
          break;
        case 'pickup': {
          const pc = e.kind === 'heal' ? '#5dff9a' : '#ffd84d';
          burst(x, y, pc, 12, 220, 3.5, 0.5); ring(x, y, pc, 40, 0.35);
          break;
        }
        case 'waveStart': break;
        case 'waveClear': flash('#ffffff', 0.1); break;
        case 'bossSpawn':
          addShake(30); flash(c, 0.55);
          shock(x, y, 0.9, c, { kind: 'roar', flash: 0, hold: 0.06 });
          ring(x, y, c, 420, 0.9); ring(x, y, '#ffffff', 220, 0.6);
          burst(x, y, c, 30, 500, 5, 0.8); smoke(x, y, c, 8, 160, 24, 0.9);
          break;
        case 'bossPhase':
          addShake(18); flash(c, 0.3);
          shock(x, y, 0.7, c, { kind: 'roar', flash: 0 });
          ring(x, y, c, 300, 0.7); burst(x, y, c, 24, 420, 4, 0.7);
          break;
        case 'explosion': {
          const r = num(e.r, 80);
          addShake(clamp(r / 14, 3, 14));
          if (r >= 90) shock(x, y, clamp(r / 400, 0.15, 0.4), c, { zoom: 0.6, ring: 0, flash: 0 });
          burst(x, y, c, 16, r * 3.2, 4, 0.5); sparks(x, y, c, 12, r * 5, 0.4);
          smoke(x, y, c, 3, 100, r * 0.3, 0.6); ring(x, y, c, r, 0.35);
          break;
        }
        case 'slam': {
          const r = num(e.r, 120);
          addShake(clamp(r / 10, 4, 16));
          shock(x, y, clamp(r / 300, 0.2, 0.5), c, { zoom: 0.6, ring: 0, flash: 0 });
          smoke(x, y, c, 6, r * 2, 18, 0.7); sparks(x, y, c, 14, r * 4, 0.45); ring(x, y, c, r, 0.4);
          break;
        }
        case 'enemyShoot':
          sparks(x, y, HOSTILE, 4, 200, 0.2);
          break;
        case 'upgrade':
          burst(lastPlayer.x, lastPlayer.y, '#ffd84d', 20, 300, 4, 0.7); ring(lastPlayer.x, lastPlayer.y, '#ffd84d', 120, 0.6);
          break;
        case 'gameOver':
          addShake(28); flash(HOSTILE, 0.6);
          shock(lastPlayer.x, lastPlayer.y, 1, HOSTILE, { kind: 'quake', zoom: 0.8, flash: 0, hold: 0.12 });
          burst(lastPlayer.x, lastPlayer.y, col(lastPlayer.element), 40, 600, 5, 1.1);
          ring(lastPlayer.x, lastPlayer.y, HOSTILE, 360, 0.9);
          break;
        case 'denied':
          addShake(2); ring(lastPlayer.x, lastPlayer.y, '#ff6a7a', 40, 0.25);
          break;
        // Generic impact for the sim to emit without renderer changes:
        // { type: 'shock', x, y, element, power (0..1), kind?: 'quake' | 'roar' | ..., dx?, dy?, r? }
        case 'shock':
          shock(x, y, num(e.power, 0.5), c, { kind: e.kind, dx: e.dx, dy: e.dy, r: e.r });
          break;
        default: break;
      }
    }
  }

  // ---------- drawing helpers ----------
  function poly(n, rad, rot, wob, ph) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU, rr = rad * (1 + (wob ? Math.sin(t * 4 + i * 2 + ph) * wob : 0));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function spikes(n, r0, r1, rot, w) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      ctx.moveTo(Math.cos(a - w) * r0, Math.sin(a - w) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a + w) * r0, Math.sin(a + w) * r0);
    }
    ctx.closePath();
  }

  // ---------- floor / background ----------
  const TINT_R = 1100, TINT_A = 0.22;
  // Floor with one element's tint baked in: in steady state (nearly always) this replaces a
  // full-screen additive pass per frame with a single opaque blit.
  const tintedFloors = new Map();
  function tintedFloor(el) {
    let c = tintedFloors.get(el);
    if (c) return c;
    c = makeCanvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(floorCanvas, 0, 0);
    glowTo(g, W / 2, H / 2, TINT_R, col(el), TINT_A);
    tintedFloors.set(el, c);
    return c;
  }
  function drawFloor(dt, state) {
    if (!floorCanvas) buildFloor();
    let target = null;
    if (state && state.player && ELS.indexOf(state.player.element) >= 0) target = state.player.element;
    else if (!state) target = ELS[Math.floor(t / 4) % 4];
    let solo = null, blending = false;
    for (let i = 0; i < 4; i++) {
      const el = ELS[i];
      tintA[el] += ((el === target ? 1 : 0) - tintA[el]) * Math.min(1, dt * 2.2);
      if (tintA[el] > 0.985) solo = el;
      else if (tintA[el] > 0.01) blending = true;
    }
    if (solo && !blending) { ctx.drawImage(tintedFloor(solo), 0, 0); return; }
    ctx.drawImage(floorCanvas, 0, 0);
    for (let i = 0; i < 4; i++) {
      const el = ELS[i];
      if (tintA[el] > 0.01) glow(W / 2, H / 2, TINT_R, col(el), tintA[el] * TINT_A);
    }
  }

  // ---------- entities ----------
  function drawPickups(list) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i]; if (!p) continue;
      const x = num(p.x, 0), y = num(p.y, 0), r = num(p.r, 12), life = num(p.life, 10);
      if (life < 3 && Math.floor(t * (life < 1.5 ? 14 : 7)) % 2 === 0) continue;
      const heal = p.kind === 'heal';
      const c = heal ? '#5dff9a' : '#ffd84d';
      const pulse = 1 + Math.sin(t * 5 + x) * 0.12, bob = Math.sin(t * 3 + y) * 3;
      glow(x, y + bob, r * 3.2 * pulse, c, 0.55);
      ctx.save(); ctx.translate(x, y + bob); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#10151c'; ctx.strokeStyle = c; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c;
      if (heal) {
        const a = r * 0.22, b = r * 0.6;
        ctx.fillRect(-a, -b, a * 2, b * 2); ctx.fillRect(-b, -a, b * 2, a * 2);
      } else {
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * TAU - Math.PI / 2 + t, rr = k % 2 ? r * 0.28 : r * 0.7;
          if (k === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr); else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawEffects(list) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i]; if (!f) continue;
      const x = num(f.x, 0), y = num(f.y, 0), r = num(f.r, 60), ml = num(f.maxLife, 0.5) || 0.5;
      const k = clamp(num(f.life, 0) / ml, 0, 1), p = 1 - k;
      const c = col(f.element);
      switch (f.kind) {
        case 'slam': {
          const e = 1 - (1 - p) * (1 - p) * (1 - p), rr = r * (0.35 + 0.65 * e);
          glow(x, y, rr * 1.4, c, 0.5 * k);
          ctx.save(); ctx.translate(x, y);
          ctx.fillStyle = c; ctx.globalAlpha = 0.22 * k;
          ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill();
          ctx.globalAlpha = Math.min(1, k * 1.5); ctx.strokeStyle = c; ctx.lineWidth = 6 * k + 2;
          ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha = k * 0.8;
          ctx.beginPath(); ctx.arc(0, 0, rr * 0.96, 0, TAU); ctx.stroke();
          // cracks
          ctx.strokeStyle = '#0a0a10'; ctx.lineWidth = 3; ctx.globalAlpha = Math.min(1, k * 2);
          const id = num(f.id, 1);
          ctx.beginPath();
          for (let c2 = 0; c2 < 9; c2++) {
            const a = (c2 / 9) * TAU + hash(id, c2) * 0.5, len = rr * (0.55 + hash(id, c2 + 20) * 0.45) * e;
            let cx = 0, cy = 0; ctx.moveTo(0, 0);
            for (let s = 1; s <= 3; s++) {
              const aa = a + (hash(id, c2 * 7 + s) - 0.5) * 0.45, d = len / 3;
              cx += Math.cos(aa) * d; cy += Math.sin(aa) * d; ctx.lineTo(cx, cy);
            }
          }
          ctx.stroke();
          ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.globalAlpha = k * 0.9; ctx.stroke();
          ctx.restore();
          break;
        }
        case 'explosion': {
          const e = 1 - (1 - p) * (1 - p), rr = r * (0.3 + 0.7 * e);
          glow(x, y, rr * 2.2, c, 0.75 * k);
          glow(x, y, rr * 1.2, '#ffffff', 0.7 * k * k);
          ctx.strokeStyle = c; ctx.globalAlpha = k; ctx.lineWidth = 5 * k + 1;
          ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
          break;
        }
        case 'nova': {
          const e = 1 - (1 - p) * (1 - p) * (1 - p), rr = r * e;
          glow(x, y, rr * 1.15, c, 0.35 * k);
          ctx.globalCompositeOperation = 'lighter';
          for (let n2 = 0; n2 < 3; n2++) {
            const r2 = rr * (1 - n2 * 0.1); if (r2 <= 0) continue;
            ctx.globalAlpha = k * (1 - n2 * 0.28);
            ctx.strokeStyle = n2 === 0 ? '#ffffff' : c; ctx.lineWidth = (14 - n2 * 4) * k + 1;
            ctx.beginPath(); ctx.arc(x, y, r2, 0, TAU); ctx.stroke();
          }
          ctx.globalAlpha = 0.18 * k; ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'telegraph': {
          // p: 0 -> 1 as the strike approaches
          const pulse = 0.5 + 0.5 * Math.sin(t * 16);
          if (Number.isFinite(f.len) && f.len > 0) {
            // directional charge: lane exactly as long/wide as the coming dash
            const w = Math.max(10, r - 12), len = f.len + w;
            ctx.save(); ctx.translate(x, y); ctx.rotate(num(f.angle, 0));
            ctx.fillStyle = HOSTILE; ctx.globalAlpha = 0.1 + 0.14 * p;
            ctx.fillRect(0, -w, len, w * 2);
            ctx.globalAlpha = 0.22 + 0.3 * p + 0.08 * pulse; ctx.fillRect(0, -w * p, len * p, w * 2 * p);
            ctx.globalAlpha = 0.6 + 0.3 * pulse; ctx.strokeStyle = HOSTILE; ctx.lineWidth = 2;
            ctx.setLineDash(DASH); ctx.lineDashOffset = -t * 40;
            ctx.strokeRect(0, -w, len, w * 2); ctx.setLineDash(NODASH);
            // arrow head at the end of the lane
            ctx.globalAlpha = 0.5 + 0.4 * p; ctx.fillStyle = HOSTILE;
            ctx.beginPath(); ctx.moveTo(len + 14, 0); ctx.lineTo(len - 10, -w * 0.8); ctx.lineTo(len - 10, w * 0.8); ctx.closePath(); ctx.fill();
            ctx.restore(); ctx.globalAlpha = 1;
            break;
          }
          ctx.save(); ctx.translate(x, y);
          ctx.fillStyle = HOSTILE; ctx.globalAlpha = 0.07 + 0.1 * p;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.16 + 0.3 * p + 0.1 * pulse;
          ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r * p), 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.65 + 0.35 * pulse; ctx.strokeStyle = HOSTILE; ctx.lineWidth = 3;
          ctx.setLineDash(DASH); ctx.lineDashOffset = -t * 30;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
          ctx.setLineDash(NODASH);
          ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.92, 0, TAU); ctx.stroke();
          ctx.restore();
          break;
        }
        default: {
          ctx.globalAlpha = k * 0.5; ctx.strokeStyle = c; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(x, y, r * (0.3 + 0.7 * p), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawEnemy(e) {
    const type = e.type;
    const defR = type === 'boss' ? 60 : type === 'brute' ? 30 : type === 'swarm' ? 10 : type === 'spitter' ? 16 : 18;
    const r0 = num(e.r, defR);
    const spawnT = clamp(num(e.spawnT, 0), 0, 1);
    const x = num(e.x, 0), y = num(e.y, 0), ang = num(e.angle, 0);
    const c = col(e.element), d = dark(e.element);
    const flashing = num(e.hitFlash, 0) > 0;
    const stun = num(e.stun, 0), slow = num(e.slow, 0), burn = num(e.burn, 0), tg = clamp(num(e.telegraph, 0), 0, 1);
    const ph = num(e.id, 0) * 1.7;

    // spawn-in portal
    if (spawnT > 0) {
      ctx.globalAlpha = 0.9 * spawnT;
      ctx.strokeStyle = c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r0 * (1 + spawnT * 1.6), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      glow(x, y, r0 * (2 + spawnT * 2), c, 0.5 * spawnT);
    }
    // ground shadow
    ctx.globalAlpha = 0.35 * (1 - spawnT); ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + r0 * 0.7, r0 * 0.95, r0 * 0.4, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;

    // telegraph lane (charges). When the sim reports telegraphKind, charge lanes come from the
    // 'telegraph' effect (which carries the real angle + length), so only draw the legacy lane without it.
    if (tg > 0 && e.telegraphKind === undefined && (type === 'brute' || type === 'boss')) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = HOSTILE; ctx.globalAlpha = 0.08 + 0.2 * tg;
      ctx.fillRect(0, -r0, 520, r0 * 2);
      ctx.globalAlpha = 0.2 + 0.4 * tg; ctx.fillRect(0, -r0 * tg, 520 * tg, r0 * 2 * tg);
      ctx.globalAlpha = 0.7; ctx.strokeStyle = HOSTILE; ctx.lineWidth = 2;
      ctx.strokeRect(0, -r0, 520, r0 * 2);
      ctx.restore(); ctx.globalAlpha = 1;
    }

    const tgScale = 1 + 0.12 * tg * (0.6 + 0.4 * Math.sin(t * 30));
    const sc = (1 - spawnT * 0.85) * tgScale;
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 1 - spawnT * 0.6;
    if (type === 'spitter') ctx.translate(0, Math.sin(t * 3 + ph) * 2.5);
    ctx.scale(sc, sc);
    ctx.lineJoin = 'round';
    const body = flashing ? '#ffffff' : d, edge = flashing ? '#ffffff' : c;
    ctx.fillStyle = body; ctx.strokeStyle = edge;

    switch (type) {
      case 'swarm': {
        ctx.rotate(ang);
        const r = r0, w = Math.sin(t * 20 + ph) * 0.12;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r * 0.9, r * (0.85 + w)); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.9, -r * (0.85 + w));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = flashing ? '#fff' : c;
        ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.3, 0, TAU); ctx.fill();
        break;
      }
      case 'spitter': {
        ctx.rotate(ang);
        const r = r0; ctx.lineWidth = 3;
        // barrel
        ctx.fillRect(r * 0.3, -r * 0.28, r * 1.05, r * 0.56); ctx.strokeRect(r * 0.3, -r * 0.28, r * 1.05, r * 0.56);
        poly(6, r, 0, 0, 0); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.rotate(t * 1.5);
        ctx.strokeStyle = flashing ? '#fff' : c; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.7;
        poly(3, r * 0.62, 0, 0, 0); ctx.stroke(); ctx.restore();
        ctx.fillStyle = flashing ? '#fff' : c;
        ctx.beginPath(); ctx.arc(0, 0, r * (0.24 + 0.05 * Math.sin(t * 6 + ph)), 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 1.38, 0, r * 0.16, 0, TAU); ctx.fill();
        break;
      }
      case 'brute': {
        ctx.rotate(ang);
        const r = r0; ctx.lineWidth = 4;
        // shoulder pads
        for (let s = -1; s <= 1; s += 2) {
          ctx.beginPath(); ctx.arc(-r * 0.1, s * r * 0.95, r * 0.38, 0, TAU); ctx.fill(); ctx.stroke();
        }
        // ram plate
        ctx.beginPath(); ctx.moveTo(r * 0.7, -r * 0.55); ctx.lineTo(r * 1.3, -r * 0.3); ctx.lineTo(r * 1.3, r * 0.3); ctx.lineTo(r * 0.7, r * 0.55);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        poly(8, r, Math.PI / 8, 0, 0); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 2; ctx.globalAlpha *= 0.6;
        poly(8, r * 0.68, Math.PI / 8, 0, 0); ctx.stroke(); ctx.globalAlpha = 1 - spawnT * 0.6;
        ctx.fillStyle = flashing ? '#fff' : c;
        ctx.fillRect(r * 0.15, -r * 0.1, r * 0.55, r * 0.2);
        glow(0, 0, r * 0.9, c, 0.25 + 0.2 * tg);
        break;
      }
      case 'boss': {
        const r = r0; ctx.lineWidth = 5;
        glow(0, 0, r * 2.6, c, 0.45 + 0.1 * Math.sin(t * 3));
        ctx.save(); ctx.rotate(t * 0.45);
        ctx.fillStyle = flashing ? '#fff' : d; spikes(10, r * 0.95, r * 1.45, 0, 0.17); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.save(); ctx.rotate(ang);
        poly(12, r, 0, 0, 0); ctx.fill(); ctx.stroke();
        // crown
        ctx.fillStyle = flashing ? '#fff' : c;
        for (let s = -1; s <= 1; s++) {
          ctx.beginPath(); ctx.moveTo(r * 0.75, s * r * 0.35 - r * 0.1); ctx.lineTo(r * 1.35 + (s === 0 ? r * 0.2 : 0), s * r * 0.35); ctx.lineTo(r * 0.75, s * r * 0.35 + r * 0.1);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = flashing ? '#fff' : c; ctx.lineWidth = 3; ctx.globalAlpha *= 0.6;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.stroke();
        ctx.save(); ctx.rotate(-t * 0.9); poly(4, r * 0.55, 0, 0, 0); ctx.stroke(); ctx.restore();
        ctx.globalAlpha = 1 - spawnT * 0.6;
        ctx.fillStyle = flashing ? '#fff' : c;
        ctx.beginPath(); ctx.arc(0, 0, r * (0.28 + 0.04 * Math.sin(t * 5)), 0, TAU); ctx.fill();
        for (let k = 0; k < 4; k++) {
          const a = t * 1.3 + k * (TAU / 4);
          ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15, r * 0.09, 0, TAU); ctx.fill();
        }
        break;
      }
      default: { // grunt and unknown kinds
        ctx.rotate(ang);
        const r = r0; ctx.lineWidth = 3;
        for (let s = -1; s <= 1; s += 2) {
          ctx.beginPath(); ctx.moveTo(r * 0.5, s * r * 0.55); ctx.lineTo(r * 1.35, s * r * 0.85); ctx.lineTo(r * 0.9, s * r * 0.1);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = flashing ? '#fff' : c; ctx.globalAlpha *= 0.85;
        ctx.beginPath(); ctx.arc(-r * 0.25, 0, r * 0.35, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1 - spawnT * 0.6;
        ctx.fillStyle = flashing ? '#fff' : '#ffffff';
        ctx.beginPath(); ctx.arc(r * 0.45, -r * 0.28, r * 0.13, 0, TAU); ctx.arc(r * 0.45, r * 0.28, r * 0.13, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // warning ring for non-lane telegraphs
    if (tg > 0 && type !== 'brute' && type !== 'boss') {
      ctx.strokeStyle = HOSTILE; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.5 * tg;
      ctx.beginPath(); ctx.arc(x, y, r0 * (2.2 - 1.2 * tg), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      glow(x, y, r0 * 2.2, HOSTILE, 0.3 * tg);
    } else if (tg > 0) {
      ctx.strokeStyle = HOSTILE; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.5 * tg;
      ctx.beginPath(); ctx.arc(x, y, r0 * (1.9 - 0.7 * tg), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // status visuals
    if (burn > 0) {
      for (let i = 0; i < 3; i++) {
        const q = (t * 1.7 + i * 0.37 + ph) % 1;
        glow(x + Math.sin(i * 2 + t * 5) * r0 * 0.55, y - r0 * 0.2 - q * r0 * 1.3, r0 * 0.7 * (1 - q * 0.5), '#ff8a30', 0.9 * (1 - q));
      }
    }
    if (slow > 0) {
      ctx.strokeStyle = '#8fd4ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
      ctx.setLineDash(DASH); ctx.lineDashOffset = t * 12;
      ctx.beginPath(); ctx.arc(x, y, r0 * 1.2, 0, TAU); ctx.stroke(); ctx.setLineDash(NODASH); ctx.globalAlpha = 1;
      glow(x, y, r0 * 1.6, '#3da9ff', 0.25);
    }
    if (stun > 0) {
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + i * (TAU / 3);
        glow(x + Math.cos(a) * r0 * 0.7, y - r0 - 8 + Math.sin(a) * 4, 7, '#ffe14d', 1);
      }
    }
    // hp bar
    const hp = num(e.hp, 1), mhp = num(e.maxHp, 1) || 1;
    if (type !== 'boss' && hp < mhp && hp > 0) {
      const bw = Math.max(22, r0 * 2), by = y - r0 - 12, f = clamp(hp / mhp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, 6);
      ctx.fillStyle = c; ctx.fillRect(x - bw / 2, by, bw * f, 4);
    }
  }

  function drawProjectile(p) {
    const x = num(p.x, 0), y = num(p.y, 0), r = num(p.r, 8), ang = num(p.angle, Math.atan2(num(p.vy, 0), num(p.vx, 1)));
    const c = col(p.element);
    const enemy = p.owner === 'enemy';
    switch (p.kind) {
      case 'fireball': {
        const dx = -Math.cos(ang), dy = -Math.sin(ang);
        for (let i = 5; i >= 1; i--) glow(x + dx * i * r * 0.9, y + dy * i * r * 0.9, r * (2.6 - i * 0.35), '#ff8a30', 0.55 - i * 0.07);
        glow(x, y, r * 3.4, c, 0.8);
        ctx.fillStyle = '#fff2cc'; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
        ctx.fillStyle = c; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
        break;
      }
      case 'wave': {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.lineCap = 'round';
        glow(0, 0, r * 2.4, c, 0.4);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 3; i >= 0; i--) {
          const off = -i * r * 0.45;
          ctx.globalAlpha = 0.75 - i * 0.18; ctx.strokeStyle = c; ctx.lineWidth = r * (0.55 - i * 0.08);
          ctx.beginPath(); ctx.arc(off - r * 0.5, 0, r * 1.5, -0.95, 0.95); ctx.stroke();
        }
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#e8f6ff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(-r * 0.5, 0, r * 1.5 + r * 0.2, -0.9, 0.9); ctx.stroke();
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        break;
      }
      case 'dart': {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.lineCap = 'round';
        const len = Math.max(14, r * 4);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5; ctx.strokeStyle = c; ctx.lineWidth = r * 1.8;
        ctx.beginPath(); ctx.moveTo(-len * 1.6, 0); ctx.lineTo(len * 0.3, 0); ctx.stroke();
        ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, r * 0.7);
        ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.6, 0); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        break;
      }
      case 'bolt': {
        glow(x, y, r * 3.6, HOSTILE, 0.6);
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 6 + num(p.id, 0));
        ctx.fillStyle = '#1a0408'; ctx.strokeStyle = HOSTILE; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        spikes(6, r * 0.7, r * 1.5, 0, 0.3); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      default: {
        glow(x, y, r * 3, enemy ? HOSTILE : c, 0.7);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, TAU); ctx.fill();
      }
    }
  }

  function drawPlayer(pl) {
    const x = num(pl.x, W / 2), y = num(pl.y, H / 2), r = num(pl.r, 16), ang = num(pl.angle, 0);
    const el = pl.element, c = col(el), d = dark(el);
    const dashing = num(pl.dashing, 0) > 0, invuln = num(pl.invuln, 0) > 0;
    const flashing = num(pl.hitFlash, 0) > 0;
    // blow ready aura
    const blowReady = num(pl.blow, 0) >= 100;
    glow(x, y, r * (3.4 + (blowReady ? 0.5 * Math.sin(t * 8) : 0)), c, 0.5);
    if (blowReady) {
      ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 8);
      ctx.beginPath(); ctx.arc(x, y, r * 2.1 + Math.sin(t * 8) * 2, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // orbiting element motes
    for (let i = 0; i < 3; i++) {
      const a = t * 2.4 + i * (TAU / 3);
      glow(x + Math.cos(a) * r * 1.7, y + Math.sin(a) * r * 1.7, 9, c, 0.8);
    }
    ctx.globalAlpha = invuln && !dashing ? (Math.floor(t * 18) % 2 ? 0.35 : 0.9) : 1;
    ctx.save(); ctx.translate(x, y);
    ctx.globalAlpha *= 0.4; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, r * 0.75, r * 0.95, r * 0.4, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = invuln && !dashing ? (Math.floor(t * 18) % 2 ? 0.35 : 0.9) : 1;
    if (dashing) { const sp = Math.hypot(num(pl.vx, 0), num(pl.vy, 0)); ctx.rotate(ang); ctx.scale(1.25, 0.85); ctx.rotate(-ang); void sp; }
    ctx.rotate(ang);
    ctx.lineJoin = 'round'; ctx.lineWidth = 3;
    // weapon / staff
    ctx.strokeStyle = flashing ? '#fff' : '#cfd2e8'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r * 0.3, r * 0.55); ctx.lineTo(r * 1.65, r * 0.25); ctx.stroke();
    ctx.fillStyle = flashing ? '#fff' : c;
    const tx = r * 1.7, ty = r * 0.22;
    if (el === 'fire') { ctx.beginPath(); ctx.moveTo(tx - 4, ty + 6); ctx.quadraticCurveTo(tx - 6, ty - 4, tx + 2, ty - 12 - Math.sin(t * 20) * 2); ctx.quadraticCurveTo(tx + 8, ty - 2, tx + 5, ty + 6); ctx.fill(); }
    else if (el === 'water') { ctx.beginPath(); ctx.arc(tx, ty, 7, 0, TAU); ctx.fill(); }
    else if (el === 'earth') { poly(5, 8, 0.3, 0, 0); ctx.save(); ctx.translate(tx, ty); poly(5, 8, 0.3, 0, 0); ctx.fill(); ctx.restore(); }
    else { ctx.save(); ctx.translate(tx, ty); ctx.rotate(t * 5); spikes(3, 3, 10, 0, 0.5); ctx.fill(); ctx.restore(); }
    glow(tx, ty, 22, c, 0.8);
    // body
    ctx.fillStyle = flashing ? '#ffffff' : '#1c1f33'; ctx.strokeStyle = flashing ? '#ffffff' : c; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    // chest emblem in element colour
    ctx.fillStyle = flashing ? '#fff' : d; ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.62, 0, TAU); ctx.fill();
    ctx.fillStyle = flashing ? '#fff' : c; ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.32, 0, TAU); ctx.fill();
    // face / visor, facing direction
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(r * 0.95, 0); ctx.lineTo(r * 0.45, -r * 0.4); ctx.lineTo(r * 0.45, r * 0.4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    // current-element cooldown arc
    const cds = pl.cooldowns, cd = cds ? num(cds[el], 0) : 0;
    if (cd > 0.01) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - clamp(cd, 0, 1))); ctx.stroke();
    }
  }

  // ---------- main render ----------
  function render(state, dtReal) {
    autoQuality(num(dtReal, 0));
    const dt = clamp(num(dtReal, 1 / 60), 0, 0.05);
    t += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // The floor is opaque and covers the whole arena, so only the letterbox bars need clearing.
    ctx.fillStyle = '#04050a';
    const bw = canvas.width, bh = canvas.height, ax = Math.ceil(ox * dpr), ay = Math.ceil(oy * dpr);
    if (ax > 0) { ctx.fillRect(0, 0, ax, bh); ctx.fillRect(bw - ax, 0, ax, bh); }
    if (ay > 0) { ctx.fillRect(0, 0, bw, ay); ctx.fillRect(0, bh - ay, bw, ay); }
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    const pl = state && state.player ? state.player : null;
    if (pl) {
      lastPlayer.x = num(pl.x, lastPlayer.x); lastPlayer.y = num(pl.y, lastPlayer.y);
      if (pl.element) lastPlayer.element = pl.element;
    }

    updateParticles(dt);
    shake *= Math.exp(-dt * 9);
    if (shake < 0.05) shake = 0;
    flashA = Math.max(0, flashA - dt * 2.4);
    updateShock(dt);

    // camera: random shake + oscillating shudder (capped together), rotation wobble, zoom punch
    let offX = 0, offY = 0;
    if (shake > 0) { offX += (Math.random() - 0.5) * shake * 2; offY += (Math.random() - 0.5) * shake * 2; }
    if (shud > 0) {
      const s1 = Math.sin(t * shudF * TAU + shudPh), s2 = Math.sin(t * shudF * TAU * 0.71 + shudPh * 2) * 0.5;
      offX += shud * (shudAx * s1 - shudAy * s2); offY += shud * (shudAy * s1 + shudAx * s2);
    }
    camOff = Math.hypot(offX, offY);
    if (camOff > OFF_MAX) { offX *= OFF_MAX / camOff; offY *= OFF_MAX / camOff; camOff = OFF_MAX; }
    const rot = rotA > 0 ? rotA * Math.sin(t * 9 * TAU + shudPh) : 0;
    // Overscan from the smooth envelopes (not the per-frame offset, which would pump) so that the
    // offset and the rotation never expose the clip's margins; the zoom punch is anchored inside the
    // arena and only adds coverage. Total magnification stays under ZOOM_MAX.
    const over = Math.min(ZOOM_MAX, 1 + 2 * Math.min(OFF_MAX, shake + shud * 1.12) / H + 1.8 * rotA);
    if (camZoom * over > ZOOM_MAX) camZoom = ZOOM_MAX / over;

    ctx.save();
    if (offX || offY) ctx.translate(offX, offY);
    if (over > 1 || rot) { ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(over, over); ctx.translate(-W / 2, -H / 2); }
    if (camZoom > 1) { ctx.translate(zoomX, zoomY); ctx.scale(camZoom, camZoom); ctx.translate(-zoomX, -zoomY); }
    drawFloor(dt, state);
    if (!state) {
      // menu backdrop
      ctx.save(); ctx.translate(W / 2, H / 2);
      for (let i = 0; i < 4; i++) {
        const el = ELS[i];
        ctx.save(); ctx.rotate(t * (0.08 + i * 0.03) * (i % 2 ? -1 : 1));
        ctx.strokeStyle = col(el); ctx.globalAlpha = 0.12 + 0.1 * tintA[el]; ctx.lineWidth = 2;
        poly(i + 3, 260 + i * 70, 0, 0, 0); ctx.stroke(); ctx.restore();
      }
      ctx.restore(); ctx.globalAlpha = 1;
      drawMotes(dt, 70, 1.5);
      // occasional ambient sparks
      if (Math.random() < dt * 4) {
        const el = ELS[(Math.random() * 4) | 0], ex = Math.random() * W, ey = H * (0.5 + Math.random() * 0.5);
        spawn(0, ex, ey, (Math.random() - 0.5) * 30, -40 - Math.random() * 60, 3, 2 + Math.random(), col(el), 0.2, 0);
      }
    } else {
      drawMotes(dt, 24, 0.6);
      if (pl) glow(num(pl.x, W / 2), num(pl.y, H / 2), 260, col(pl.element), 0.16);

      // afterimages
      if (pl && num(pl.dashing, 0) > 0) {
        aTimer -= dt;
        if (aTimer <= 0) {
          aTimer = 0.02;
          const a = after[aHead]; aHead = (aHead + 1) % MAXA;
          a.x = pl.x; a.y = pl.y; a.angle = num(pl.angle, 0); a.life = 0.28; a.color = col(pl.element);
        }
      }
      for (let i = 0; i < MAXA; i++) {
        const a = after[i]; if (a.life <= 0) continue;
        a.life -= dt;
        const k = Math.max(0, a.life / 0.28);
        glow(a.x, a.y, 30 * (0.6 + k * 0.6), a.color, 0.55 * k);
        ctx.globalAlpha = 0.45 * k; ctx.fillStyle = a.color;
        ctx.beginPath(); ctx.arc(a.x, a.y, num(pl && pl.r, 16) * (0.7 + 0.3 * k), 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }

      drawEffects(state.effects || EMPTY);
      drawPickups(state.pickups || EMPTY);
      // enemies sorted lightly by y is skipped for perf; draw in order
      const en = state.enemies || EMPTY;
      for (let i = 0; i < en.length; i++) if (en[i]) drawEnemy(en[i]);
      if (pl) drawPlayer(pl);
      const pr = state.projectiles || EMPTY;
      for (let i = 0; i < pr.length; i++) if (pr[i]) drawProjectile(pr[i]);
    }
    drawParticles();
    drawWaves(dt);
    drawNumbers(dt);
    ctx.restore();

    ctx.drawImage(vignetteCanvas, 0, 0);
    // brief extra vignette darkening after big shocks (one blit, ~0.2 s)
    if (vigA > 0.01) { ctx.globalAlpha = vigA; ctx.drawImage(vignetteCanvas, 0, 0); ctx.globalAlpha = 1; }

    // low hp warning
    if (pl && num(pl.maxHp, 0) > 0 && pl.hp / pl.maxHp < 0.3 && pl.hp > 0) {
      ctx.globalAlpha = 0.14 + 0.1 * Math.sin(t * 6);
      ctx.strokeStyle = HOSTILE; ctx.lineWidth = 40; ctx.strokeRect(0, 0, W, H); ctx.globalAlpha = 1;
    }

    // boss bar
    if (state && state.enemies) {
      let boss = null;
      for (let i = 0; i < state.enemies.length; i++) if (state.enemies[i] && state.enemies[i].type === 'boss') { boss = state.enemies[i]; break; }
      if (boss) {
        const f = clamp(num(boss.hp, 0) / (num(boss.maxHp, 1) || 1), 0, 1);
        bossGhost += (f - bossGhost) * Math.min(1, dt * 2.5); if (bossGhost < f) bossGhost = f;
        const bw = 700, bx = (W - bw) / 2, by = bossBarY(), bh = 18, c = col(boss.element);
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.45; ctx.fillRect(bx, by, bw * bossGhost, bh); ctx.globalAlpha = 1;
        ctx.fillStyle = c; ctx.fillRect(bx, by, bw * f, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(bx, by, bw * f, bh * 0.35);
        ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.strokeRect(bx - 4, by - 4, bw + 8, bh + 8);
        ctx.font = '800 15px system-ui, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round';
        const label = 'ELEMENTAL TITAN \u00b7 ' + String(boss.element || '').toUpperCase();
        ctx.strokeText(label, W / 2, by + bh + 9); ctx.fillStyle = c; ctx.fillText(label, W / 2, by + bh + 9);
      } else bossGhost = 1;
    } else bossGhost = 1;

    if (flashA > 0.005) {
      ctx.globalAlpha = Math.min(0.7, flashA); ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
  }

  // The DOM HUD's top-centre block (wave label) lives in window space; park the boss bar just
  // below it (in world units) so the two never overlap, whatever the letterboxing.
  let hudTc = null, bossBarCache = 22, bossBarAt = -1;
  function bossBarY() {
    if (typeof document === 'undefined') return 22;
    if (t - bossBarAt < 0.5 && bossBarAt >= 0) return bossBarCache;
    bossBarAt = t;
    if (!hudTc || !hudTc.isConnected) hudTc = document.querySelector('.hud-tc');
    let y = 22;
    if (hudTc) {
      const rc = hudTc.getBoundingClientRect();
      if (rc.height > 0) {
        const cr = canvas.getBoundingClientRect();
        const wy = (rc.bottom - cr.top - oy) / scale;
        if (Number.isFinite(wy)) y = clamp(wy + 10, 22, 160);
      }
    }
    bossBarCache = y;
    return y;
  }

  // ---------- sizing ----------
  // Dynamic resolution: watch the wall-clock frame time the main loop hands us (sim + draw +
  // HUD + compositing). Sustained long frames step the backing store down; after a quiet
  // spell it creeps back up. Each step reallocates the canvas, so steps are rate limited.
  function autoQuality(dtRaw) {
    if (!(dtRaw > 0) || dtRaw > 0.1) return;           // paused, or a hitch (tab switch, GC) - not load
    ftAvg += (dtRaw - ftAvg) * 0.06;                   // ~16-frame average
    qCooldown -= dtRaw;
    if (qCooldown > 0) return;
    if (ftAvg > 1 / 45 && quality > Q_MIN) {           // > 22 ms sustained: drop a notch
      quality = Math.max(Q_MIN, quality - 0.1);
      qCooldown = 1.0; ftAvg = 1 / 60;
      resize();
    } else if (ftAvg < 1 / 57 && quality < Q_MAX) {    // comfortably under 17.5 ms: creep back
      quality = Math.min(Q_MAX, quality + 0.05);
      qCooldown = 4.0;
      resize();
    }
  }
  function resize() {
    bossBarAt = -1;
    // Cap at 2: a 3x backing store is over twice the pixels per frame for no visible gain.
    const native = Math.min(2, window.devicePixelRatio || 1);
    cssW = Math.max(1, window.innerWidth); cssH = Math.max(1, window.innerHeight);
    // Pixel budget: a 4K screen (8.3 MP at dpr 1, or 1920x1080 at dpr 2) is scaled down to fit
    // MAX_PIXELS; the browser upsamples the canvas to the window via CSS.
    const px = cssW * cssH * native * native;
    dpr = (px > MAX_PIXELS ? native * Math.sqrt(MAX_PIXELS / px) : native) * quality;
    canvas.width = Math.max(1, Math.round(cssW * dpr)); canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    scale = Math.min(cssW / W, cssH / H);
    ox = (cssW - W * scale) / 2; oy = (cssH - H * scale) / 2;
  }
  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
  }

  resize();
  if (typeof window !== 'undefined') window.addEventListener('resize', resize);
  const stats = () => ({ quality, dpr, backing: canvas.width + 'x' + canvas.height, frameMs: Math.round(ftAvg * 10000) / 10,
    shock: { shudder: Math.round(shud * 10) / 10, shake: Math.round(shake * 10) / 10, offset: Math.round(camOff * 10) / 10, zoom: Math.round(camZoom * 1000) / 1000, waves: waves.filter((s) => s.life > 0).length } });
  // Debug hook (not wired to main.js): fire a shock at world x, y with the player's element colour.
  const debugShock = (x, y, power, kind) => shock(x, y, power, col(lastPlayer.element), { kind });
  return { resize, render, handleEvents, screenToWorld, stats, debugShock };
}

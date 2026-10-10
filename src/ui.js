// Elemental Blow - DOM overlays + HUD. Zero imports; element data is hardcoded from the contract.

const ELEMENTS = ['fire', 'water', 'earth', 'air'];
const COLORS = { fire: '#ff6a3d', water: '#3da9ff', earth: '#8bd450', air: '#e8e6ff' };
const BEATS = { water: 'fire', fire: 'air', air: 'earth', earth: 'water' };
const NAMES = { fire: 'Fire', water: 'Water', earth: 'Earth', air: 'Air' };
const SURGE_BONUS = 0.3; // max nova damage bonus from holding the meter full (mirrors config ULT.surgeBonus)

const ICONS = {
  fire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 2 2 2 0-3 0-5 1-7z"/></svg>',
  water: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C9 7 5 10 5 15a7 7 0 0 0 14 0c0-5-4-8-7-13z"/></svg>',
  earth: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l9 6.5-3 11.5H6L3 9z"/></svg>',
  air: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7"/></svg>',
};

function h(tag, cls, text, attrs) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function colorOf(el) { return COLORS[el] || '#c9b6ff'; }
function fmt(n) {
  n = Number(n);
  if (!isFinite(n)) n = 0;
  return Math.floor(n).toLocaleString('en-US');
}
function num(v, d) { v = Number(v); return isFinite(v) ? v : (d || 0); }

// Element cycle diagram: water > fire > air > earth > water, clockwise.
function cycleSVG() {
  const pos = { water: [150, 45], fire: [255, 150], air: [150, 255], earth: [45, 150] };
  const arcs = [
    ['water', 'M180.7 49.6 A105 105 0 0 1 250.4 119.4'],
    ['fire', 'M250.4 180.6 A105 105 0 0 1 180.7 250.4'],
    ['air', 'M119.3 250.4 A105 105 0 0 1 49.6 180.6'],
    ['earth', 'M49.6 119.4 A105 105 0 0 1 119.3 49.6'],
  ];
  let s = '<svg class="cycle-svg" viewBox="0 0 300 300" role="img" aria-label="Element cycle: water beats fire, fire beats air, air beats earth, earth beats water"><defs>';
  ELEMENTS.forEach((e) => {
    s += `<marker id="ah-${e}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${COLORS[e]}"/></marker>`;
  });
  s += '</defs>';
  arcs.forEach(([e, d]) => {
    s += `<path d="${d}" fill="none" stroke="${COLORS[e]}" stroke-width="5" stroke-linecap="round" marker-end="url(#ah-${e})" opacity=".9"/>`;
  });
  for (const e in pos) {
    const [x, y] = pos[e];
    s += `<g transform="translate(${x} ${y})" style="color:${COLORS[e]}"><circle r="30" fill="#120f1f" stroke="${COLORS[e]}" stroke-width="3"/>`
      + `<g transform="translate(-13 -17) scale(1.08)">${ICONS[e].replace(/^<svg[^>]*>/, '').replace('</svg>', '')}</g>`
      + `<text y="21" text-anchor="middle" font-size="9.5" font-weight="800" letter-spacing="1" fill="${COLORS[e]}">${NAMES[e].toUpperCase()}</text></g>`;
  }
  s += '<text x="150" y="146" text-anchor="middle" font-size="34" font-weight="900" fill="#fff">2&#215;</text>'
    + '<text x="150" y="168" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="2" fill="#9d93c4">DAMAGE</text></svg>';
  return s;
}

const CONTROLS = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['Mouse'], 'Aim'],
  [['Click'], 'Attack'],
  [['1', '2', '3', '4'], 'Element'],
  [['Q', 'E'], 'Cycle element'],
  [['Shift'], 'Dash'],
  [['Space'], 'Blow (ultimate)'],
  [['P'], 'Pause'],
  [['H'], 'Manual'],
  [['M'], 'Mute'],
  [['F'], 'Full screen'],
];

function controlsList(cls, rows) {
  const list = h('ul', 'controls ' + (cls || ''));
  (rows || CONTROLS).forEach(([keys, label]) => {
    const li = h('li');
    const k = h('span', 'keys');
    keys.forEach((x) => k.appendChild(h('kbd', null, x)));
    li.appendChild(k);
    li.appendChild(h('span', 'lbl', label));
    list.appendChild(li);
  });
  return list;
}

export function createUI(callbacks) {
  const cb = callbacks || {};
  const call = (name, arg) => {
    try { if (typeof cb[name] === 'function') cb[name](arg); } catch (e) { console.error(e); }
  };
  const root = document.getElementById('ui') || document.body.appendChild(h('div', null, null, { id: 'ui' }));
  root.textContent = '';

  let current = null; // 'menu' | 'pause' | 'gameover' | 'upgrade' | null
  let lockUntil = 0;
  let upgradePicked = false;
  let lastUpgrades = null;
  let currentChoices = [];
  let namePending = false; // game over: waiting for a high-score name
  const muteButtons = [];
  let mutedNow = false;
  try { mutedNow = localStorage.getItem('elemental-blow-muted') === '1'; } catch (e) { /* ignore */ }

  // ------------------------------------------------------------ HUD
  const hud = h('div', 'hud');
  hud.hidden = true;

  // top-left: HP + blow
  const tl = h('div', 'hud-tl');
  const hpBar = h('div', 'bar hp');
  const hpFill = h('div', 'fill');
  const hpGhost = h('div', 'ghost');
  const hpText = h('div', 'bar-text', '100 / 100');
  const hpLabel = h('div', 'bar-label', 'HP');
  hpBar.append(hpGhost, hpFill, hpLabel, hpText);
  const blowWrap = h('div', 'blow');
  const blowBar = h('div', 'bar blowbar');
  const blowFill = h('div', 'fill');
  const blowLabel = h('div', 'bar-label', 'BLOW');
  const blowText = h('div', 'bar-text', '0%');
  const blowSurge = h('div', 'surge'); // bright core that grows while the meter is held full
  blowBar.append(blowFill, blowSurge, blowLabel, blowText);
  const blowHint = h('div', 'blow-hint');
  const blowHintText = h('span', 'surge-text', 'UNLEASH'); // reads "SURGE +x%" while the meter is held full
  blowHint.append(h('kbd', null, 'SPACE'), blowHintText);
  blowWrap.append(blowBar, blowHint);
  tl.append(hpBar, blowWrap);

  // top-centre: wave
  const tc = h('div', 'hud-tc');
  const waveEl = h('div', 'wave', 'WAVE 1');
  const remEl = h('div', 'remaining', '');
  const cdEl = h('div', 'countdown', '');
  tc.append(waveEl, remEl, cdEl);

  // top-right: score + combo
  const tr = h('div', 'hud-tr');
  const scoreLbl = h('div', 'score-label', 'SCORE');
  const scoreEl = h('div', 'score', '0');
  const comboWrap = h('div', 'combo');
  const comboEl = h('div', 'combo-mult', '×1');
  const comboBar = h('div', 'combo-bar');
  const comboFill = h('div', 'fill');
  comboBar.appendChild(comboFill);
  comboWrap.append(comboEl, comboBar);
  tr.append(scoreLbl, scoreEl, comboWrap);

  // bottom-centre: element slots + dash
  const bc = h('div', 'hud-bc');
  const slots = {};
  const slotRow = h('div', 'slots');
  ELEMENTS.forEach((e, i) => {
    const s = h('div', 'slot');
    s.style.setProperty('--c', COLORS[e]);
    s.dataset.el = e;
    const key = h('span', 'slot-key', String(i + 1));
    const icon = h('span', 'slot-icon');
    icon.innerHTML = ICONS[e];
    const name = h('span', 'slot-name', NAMES[e]);
    const beats = h('span', 'slot-beats');
    const dot = h('i');
    dot.style.background = COLORS[BEATS[e]];
    beats.append(h('b', null, '2×'), dot, h('span', null, NAMES[BEATS[e]]));
    const cd = h('span', 'slot-cd');
    s.append(cd, key, icon, name, beats);
    slotRow.appendChild(s);
    slots[e] = { el: s, cd, active: false, cdVal: -1 };
  });
  const dash = h('div', 'dash');
  const dashRing = h('div', 'dash-ring');
  const dashLabel = h('div', 'dash-label', 'DASH');
  const dashKey = h('kbd', null, 'SHIFT');
  dash.append(dashRing, dashLabel, dashKey);
  bc.append(slotRow, dash);

  hud.append(tl, tc, tr, bc);

  // banners
  const banners = h('div', 'banners');
  const flash = h('div', 'flash');

  // ------------------------------------------------------------ overlays
  const overlays = {};
  function makeOverlay(name, cls) {
    const o = h('div', 'overlay ' + (cls || ''), null, { 'data-name': name });
    o.hidden = true;
    overlays[name] = o;
    return o;
  }
  function button(label, kind, hint, handler) {
    const b = h('button', 'btn ' + (kind || ''), null, { type: 'button', tabindex: '-1' });
    b.appendChild(h('span', 'btn-label', label));
    if (hint) b.appendChild(h('kbd', null, hint));
    let last = 0;
    b.addEventListener('click', () => {
      b.blur();
      const now = performance.now();
      if (now - last < 250) return;
      last = now;
      handler();
    });
    return b;
  }
  function muteButton() {
    const b = h('button', 'btn ghost mute', null, { type: 'button', tabindex: '-1' });
    const lbl = h('span', 'btn-label');
    b.append(lbl, h('kbd', null, 'M'));
    b.addEventListener('click', () => { b.blur(); call('onToggleMute'); });
    muteButtons.push(lbl);
    paintMute(lbl);
    return b;
  }
  function paintMute(lbl) { lbl.textContent = mutedNow ? 'Sound: Off' : 'Sound: On'; }

  // MENU
  const menu = makeOverlay('menu', 'menu');
  {
    const left = h('div', 'menu-main');
    const title = h('h1', 'title');
    title.innerHTML = '<span class="t1">ELEMENTAL</span><span class="t2">BLOW</span>';
    const tag = h('p', 'tagline', 'Read the elements. Break the cycle. Survive the waves.');
    const play = button('PLAY', 'primary big', 'ENTER', () => call('onStart'));
    const bestEl = h('div', 'best');
    menu._best = bestEl;
    menu._board = h('section', 'panel scores');
    const row = h('div', 'menu-row');
    row.append(button('Manual', 'ghost', 'H', () => call('onOpenManual')), muteButton());
    left.append(title, tag, play, bestEl, menu._board, row);

    const right = h('div', 'menu-side');
    const cyc = h('section', 'panel cycle');
    cyc.appendChild(h('h2', null, 'The Element Cycle'));
    const svgWrap = h('div', 'cycle-wrap');
    svgWrap.innerHTML = cycleSVG();
    cyc.appendChild(svgWrap);
    cyc.appendChild(h('p', 'cycle-text', 'Water > Fire > Air > Earth > Water'));
    cyc.appendChild(h('p', 'cycle-sub', 'Hit an enemy with the element that beats it for double damage. Hit with the element that beats yours, or the same one, for half. Like resists like: enemies of your current element also deal half damage to you.'));
    const ctl = h('section', 'panel');
    ctl.appendChild(h('h2', null, 'Controls'));
    ctl.appendChild(controlsList('two-col'));
    right.append(cyc, ctl);
    menu.append(left, right);
  }

  // UPGRADE
  const upgrade = makeOverlay('upgrade', 'upgrade');
  const upTitle = h('h2', 'ov-title', 'CHOOSE AN UPGRADE');
  const upSub = h('p', 'ov-sub', 'Press 1, 2 or 3, or click a card · H opens the manual');
  const cards = h('div', 'cards');
  const owned = h('div', 'owned');
  upgrade.append(upTitle, upSub, cards, owned);

  // PAUSE
  const pause = makeOverlay('pause', 'pause');
  {
    const box = h('div', 'panel dialog');
    box.appendChild(h('h2', 'ov-title', 'PAUSED'));
    const btns = h('div', 'btn-col');
    btns.append(
      button('Resume', 'primary', 'ENTER', () => call('onResume')),
      button('Restart', '', 'R', () => call('onRestart')),
      button('Quit to menu', '', 'Q', () => call('onQuitToMenu')),
      button('Manual', '', 'H', () => call('onOpenManual')),
      muteButton()
    );
    box.appendChild(btns);
    box.appendChild(controlsList('compact'));
    pause.appendChild(box);
  }

  // GAME OVER
  const over = makeOverlay('gameover', 'gameover');
  const ov = {};
  {
    const box = h('div', 'panel dialog');
    box.appendChild(h('h2', 'ov-title bad', 'YOU FELL'));
    ov.badge = h('div', 'newbest', 'NEW BEST!');
    ov.badge.hidden = true;
    box.appendChild(ov.badge);
    const stats = h('div', 'stats');
    const stat = (k, big) => {
      const d = h('div', 'stat' + (big ? ' big' : ''));
      const v = h('div', 'v', '0');
      d.append(v, h('div', 'k', k));
      stats.appendChild(d);
      return v;
    };
    ov.score = stat('SCORE', true);
    ov.wave = stat('WAVE');
    ov.kills = stat('KILLS');
    ov.best = stat('BEST');
    box.appendChild(stats);
    ov.entry = h('div', 'name-entry');
    ov.entryLabel = h('div', 'name-label', 'HIGH SCORE! ENTER YOUR NAME');
    ov.name = h('input', 'name-input', null, {
      type: 'text', maxlength: '12', placeholder: 'YOUR NAME', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your name',
    });
    // keys still held from gameplay must not type into the field
    ov.name.addEventListener('keydown', (e) => {
      if (performance.now() < lockUntil || (e.repeat && e.key.length === 1)) e.preventDefault();
    });
    const entryRow = h('div', 'name-row');
    entryRow.append(ov.name, button('Save', 'primary', 'ENTER', () => commitName()));
    ov.entry.append(ov.entryLabel, entryRow);
    ov.entry.hidden = true;
    box.appendChild(ov.entry);
    const btns = h('div', 'btn-row');
    btns.append(
      button('Play again', 'primary', 'ENTER', () => { commitName(); call('onRestart'); }),
      button('Menu', '', 'ESC', () => { commitName(); call('onQuitToMenu'); })
    );
    box.appendChild(btns);
    ov.board = h('section', 'panel scores');
    over.append(box, ov.board);
  }

  // opts: limit, mark (0-based row to highlight), extra (the player's own row below the list: { rank, name, score, wave }),
  // note, scroll (a scrolling list that opens on the highlighted row)
  function renderBoard(box, title, scores, opts) {
    const o = opts || {};
    box.textContent = '';
    const rows = (Array.isArray(scores) ? scores : []).slice(0, o.limit);
    box.hidden = !rows.length && !o.note;
    if (box.hidden) return;
    box.appendChild(h('h2', null, title));
    if (rows.length) {
      const list = h('ol', 'board' + (o.scroll ? ' scroll' : ''));
      let mine = null;
      const add = (s, rank, me) => {
        const li = h('li', 'board-row' + (me ? ' me' : ''));
        li.append(
          h('span', 'board-rank', String(rank)), h('span', 'board-name', String((s && s.name) || '???')),
          h('span', 'board-wave', 'W' + num(s && s.wave)), h('span', 'board-score', fmt(s && s.score))
        );
        list.appendChild(li);
        if (me) mine = li;
      };
      rows.forEach((s, i) => add(s, i + 1, i === o.mark));
      if (o.extra) add(o.extra, num(o.extra.rank), true);
      box.appendChild(list);
      if (o.scroll && mine) {
        const li = mine;
        requestAnimationFrame(() => { list.scrollTop = li.offsetTop - (list.clientHeight - li.offsetHeight) / 2; });
      }
    }
    if (o.note) box.appendChild(h('p', 'board-note', o.note));
  }

  // Board panels: this device's scores (top `limit`), or the whole friends board (status 'loading' | 'ok' | 'error')
  // when one is active.
  const boards = {
    menu: { box: menu._board, limit: 5, local: [], mark: -1, friends: null, fScores: [], fMe: null },
    gameover: { box: ov.board, limit: 10, local: [], mark: -1, friends: null, fScores: [], fMe: null },
  };
  function paintBoard(which) {
    const b = boards[which];
    if (!b.friends) {
      renderBoard(b.box, 'High Scores', b.local, { limit: b.limit, mark: b.mark });
    } else if (b.friends === 'error') {
      renderBoard(b.box, 'High Scores', b.local, { limit: b.limit, mark: b.mark, note: 'Friends board unreachable right now' });
    } else {
      const me = b.fMe;
      const shown = me && me.rank <= b.fScores.length;
      let note = '';
      if (b.friends === 'loading') note = 'Loading…';
      else if (!b.fScores.length) note = 'No scores yet. Be the first!';
      renderBoard(b.box, 'Friends Board', b.fScores, {
        scroll: true, mark: shown ? me.rank - 1 : -1, extra: me && !shown ? me : null, note,
      });
    }
    if (which === 'menu') menu._best.hidden = !menu._board.hidden; // the board replaces the single best line
  }
  /** Friends board state for 'menu' or 'gameover'; data ({ scores, me }) comes with 'ok'. */
  function setFriends(which, status, data) {
    const b = boards[which];
    if (!b || !b.friends) return;
    b.friends = status;
    if (data) {
      b.fScores = Array.isArray(data.scores) ? data.scores : [];
      b.fMe = data.me || null;
    }
    paintBoard(which);
  }
  // Saves the pending high score under the typed name (a no-op when no entry is pending).
  function commitName() {
    if (!namePending) return;
    namePending = false;
    ov.entry.hidden = true;
    ov.name.blur();
    call('onSubmitScore', ov.name.value);
  }
  function setScores(scores, mark) {
    boards.gameover.local = scores;
    boards.gameover.mark = num(mark, -1);
    paintBoard('gameover');
  }

  root.append(hud, banners, flash, menu, upgrade, pause, over);

  function setOverlay(name) {
    current = name;
    for (const k in overlays) overlays[k].hidden = (k !== name);
    root.classList.toggle('has-overlay', !!name);
    hud.hidden = name === 'menu' || !seenState;
    if (name === 'menu') banners.textContent = '';
  }
  let seenState = false;

  // ------------------------------------------------------------ public: screens
  function showMenu(best, scores, friends) {
    const b = best && (num(best.score) > 0 || num(best.wave) > 0) ? best : null;
    namePending = false;
    menu._best.textContent = '';
    Object.assign(boards.menu, { local: scores, mark: -1, friends: friends ? 'loading' : null, fMe: null });
    paintBoard('menu');
    if (b) {
      menu._best.append(
        h('span', 'best-k', 'BEST'), h('span', 'best-v', fmt(b.score)),
        h('span', 'best-sep', '/'), h('span', 'best-k', 'WAVE'), h('span', 'best-v', String(num(b.wave)))
      );
    } else {
      menu._best.append(h('span', 'best-k', 'No runs yet — go set a record'));
    }
    seenState = false;
    setOverlay('menu');
  }
  function showPause() { setOverlay('pause'); }
  function showGameOver(r) {
    r = r || {};
    lockUntil = performance.now() + 600; // a held key from gameplay can't skip the screen
    ov.score.textContent = fmt(r.score);
    ov.wave.textContent = String(num(r.wave));
    ov.kills.textContent = fmt(r.kills);
    const best = r.best || null;
    ov.best.textContent = best ? fmt(Math.max(num(best.score), r.isNewBest ? num(r.score) : 0)) : '-';
    ov.badge.hidden = !r.isNewBest;
    const rank = num(r.rank, -1);
    boards.gameover.friends = r.friends ? 'loading' : null;
    boards.gameover.fMe = null;
    setScores(r.scores, -1);
    namePending = rank >= 0 || !!r.askName;
    ov.entry.hidden = !namePending;
    setOverlay('gameover');
    if (namePending) {
      ov.entryLabel.textContent = r.friends ? 'ENTER YOUR NAME FOR THE FRIENDS BOARD' : '#' + (rank + 1) + ' ON THE BOARD! ENTER YOUR NAME';
      ov.name.value = r.lastName || '';
      ov.name.focus();
      ov.name.select();
    }
  }
  function showUpgrade(choices) {
    currentChoices = Array.isArray(choices) ? choices.slice(0, 3) : [];
    upgradePicked = false;
    lockUntil = performance.now() + 450;
    cards.textContent = '';
    cards.classList.remove('done'); // left over from the previous pick; it dims and disables the cards
    cards.classList.add('locked');
    setTimeout(() => cards.classList.remove('locked'), 450);
    currentChoices.forEach((c, i) => {
      const card = h('button', 'card', null, { type: 'button', tabindex: '-1' });
      card.style.setProperty('--accent', c && c.element ? colorOf(c.element) : '#ffd36b');
      const top = h('div', 'card-top');
      top.append(h('span', 'card-key', String(i + 1)));
      if (c && c.element) {
        const ic = h('span', 'card-icon');
        ic.innerHTML = ICONS[c.element] || '';
        top.appendChild(ic);
      }
      card.append(top, h('div', 'card-name', (c && c.name) || 'Upgrade'), h('div', 'card-desc', (c && c.desc) || ''));
      card.addEventListener('click', () => { card.blur(); pick(i); });
      cards.appendChild(card);
    });
    owned.textContent = '';
    if (lastUpgrades && lastUpgrades.length) {
      owned.appendChild(h('div', 'owned-title', 'YOUR UPGRADES'));
      const list = h('div', 'owned-list');
      lastUpgrades.forEach((u) => {
        if (!u) return;
        const chip = h('span', 'chip', (u.name || u.id || '?') + (num(u.count, 1) > 1 ? ' ×' + u.count : ''));
        list.appendChild(chip);
      });
      owned.appendChild(list);
    }
    setOverlay('upgrade');
  }
  function pick(i) {
    if (current !== 'upgrade' || upgradePicked) return;
    if (performance.now() < lockUntil) return;
    const c = currentChoices[i];
    if (!c) return;
    upgradePicked = true;
    const el = cards.children[i];
    if (el) el.classList.add('picked');
    cards.classList.add('done');
    call('onPickUpgrade', c.id);
  }
  function hideOverlays() {
    setOverlay(null);
  }

  // ------------------------------------------------------------ keyboard (only while an overlay is shown)
  window.addEventListener('keydown', (e) => {
    if (!current || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const now = performance.now();
    let handled = true;
    switch (current) {
      case 'menu':
        if (k === 'Enter' || k === ' ') call('onStart');
        else if (k === 'h' || k === 'H') call('onOpenManual');
        else handled = false;
        break;
      case 'upgrade':
        if (k === '1' || k === '2' || k === '3') pick(Number(k) - 1);
        else if (k === 'h' || k === 'H') call('onOpenManual');
        else handled = false;
        break;
      case 'pause':
        if (k === 'Enter') call('onResume');
        else if (k === 'h' || k === 'H') call('onOpenManual');
        else if (k === 'r' || k === 'R') call('onRestart');
        else if (k === 'q' || k === 'Q') call('onQuitToMenu');
        else handled = false;
        break;
      case 'gameover':
        if (namePending) { // typing a name: only Enter / Esc act, everything else goes to the field
          if (k === 'Enter') { if (now >= lockUntil) commitName(); }
          else if (k === 'Escape') { commitName(); call('onQuitToMenu'); }
          else handled = false;
          break;
        }
        if (now < lockUntil) { handled = false; break; }
        if (k === 'Enter' || k === 'r' || k === 'R') call('onRestart');
        else if (k === 'Escape') call('onQuitToMenu');
        else handled = false;
        break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // ------------------------------------------------------------ HUD update (cached writes)
  const cache = {};
  function setText(key, el, val) {
    if (cache[key] !== val) { cache[key] = val; el.textContent = val; }
  }
  function setCls(key, el, cls, on) {
    on = !!on;
    if (cache[key] !== on) { cache[key] = on; el.classList.toggle(cls, on); }
  }
  function setVar(key, el, name, val) {
    if (cache[key] !== val) { cache[key] = val; el.style.setProperty(name, val); }
  }

  function updateHUD(state) {
    if (!state) return;
    try {
      const p = state.player || {};
      if (!seenState) {
        seenState = true;
        if (current !== 'menu') hud.hidden = false;
      }
      if (Array.isArray(p.upgrades)) lastUpgrades = p.upgrades;

      // Fade HUD clusters when the player is underneath them
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        const W = window.innerWidth, H = window.innerHeight;
        const sc = Math.min(W / 1600, H / 900);
        const sx = (W - 1600 * sc) / 2 + p.x * sc, sy = (H - 900 * sc) / 2 + p.y * sc;
        const pad = 34 * sc;
        const under = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && sx > r.left - pad && sx < r.right + pad && sy > r.top - pad && sy < r.bottom + pad;
        };
        setCls('fdtl', tl, 'faded', under(tl));
        setCls('fdtr', tr, 'faded', under(tr));
        setCls('fdbc', bc, 'faded', under(bc));
        // Soften the top and bottom strips while the player fights near those edges, so enemies
        // under the HP card or the element slots stay visible (world units, 1600x900 arena).
        setCls('nrt', hud, 'near-top', p.y < 110);
        setCls('nrb', hud, 'near-bottom', p.y > 900 - 110);
      }

      // HP
      const maxHp = Math.max(1, num(p.maxHp, 100));
      const hp = Math.max(0, num(p.hp, maxHp));
      const hpPct = Math.round(Math.min(1, hp / maxHp) * 1000) / 10;
      setVar('hpw', hpFill, 'width', hpPct + '%');
      setVar('hpg', hpGhost, 'width', hpPct + '%');
      setText('hpt', hpText, Math.ceil(hp) + ' / ' + Math.ceil(maxHp));
      setCls('hplow', hpBar, 'low', hp / maxHp < 0.3);
      setCls('hphurt', hpBar, 'hurt', num(p.hitFlash) > 0);

      // Blow
      const blow = Math.max(0, Math.min(100, num(p.blow)));
      const full = blow >= 99.99;
      setVar('blw', blowFill, 'width', Math.round(blow * 10) / 10 + '%');
      setText('blt', blowText, full ? 'READY' : Math.floor(blow) + '%');
      setCls('blf', blowWrap, 'full', full);
      // surge: 0..1 while the meter is held full; the nova bonus tops out at SURGE_BONUS (config ULT.surgeBonus)
      const surge = full ? Math.max(0, Math.min(1, num(p.blowSurge))) : 0;
      const surgePct = Math.round(surge * SURGE_BONUS * 100);
      setVar('bls', blowBar, '--surge', (Math.round(surge * 100) / 100) + '');
      setCls('blsg', blowWrap, 'surging', surgePct > 0);
      setText('blst', blowHintText, surgePct > 0 ? 'SURGE +' + surgePct + '%' : 'UNLEASH');
      // nova rush: brief tint on the meter while blow cooldowns run faster after a nova
      setCls('blr', blowWrap, 'rush', num(p.novaRush) > 0);

      // Elements
      for (let i = 0; i < ELEMENTS.length; i++) {
        const e = ELEMENTS[i];
        const s = slots[e];
        const act = p.element === e;
        if (s.active !== act) { s.active = act; s.el.classList.toggle('active', act); }
        const cd = Math.max(0, Math.min(1, num(p.cooldowns && p.cooldowns[e])));
        const q = Math.round(cd * 100);
        if (s.cdVal !== q) {
          s.cdVal = q;
          s.cd.style.setProperty('--cd', (q * 3.6) + 'deg');
          s.el.classList.toggle('cooling', q > 0);
        }
      }
      setVar('acc', hud, '--active', colorOf(p.element));

      // Dash
      const dMax = Math.max(0.001, num(p.dashCdMax, 1));
      const dCd = Math.max(0, num(p.dashCd));
      const dq = Math.round(Math.min(1, dCd / dMax) * 100);
      setVar('dsh', dashRing, '--cd', (dq * 3.6) + 'deg');
      setCls('dsr', dash, 'ready', dCd <= 0);

      // Wave
      const wi = state.waveInfo || {};
      const isBoss = !!wi.isBoss;
      setText('wv', waveEl, (isBoss ? 'BOSS WAVE ' : 'WAVE ') + num(state.wave, 1));
      setCls('wvb', tc, 'boss', isBoss);
      const cdn = num(wi.countdown);
      if (cdn > 0) {
        setText('rem', remEl, '');
        setText('cdt', cdEl, 'NEXT WAVE IN ' + Math.ceil(cdn));
      } else {
        setText('cdt', cdEl, '');
        setText('rem', remEl, num(wi.remaining) + (wi.total ? ' / ' + num(wi.total) : '') + ' foes');
      }

      // Score + combo
      setText('sc', scoreEl, fmt(state.score));
      const combo = num(state.combo, 1);
      const showCombo = combo > 1.001;
      setCls('cbs', comboWrap, 'on', showCombo);
      if (showCombo) {
        setText('cbt', comboEl, '×' + (Math.round(combo * 10) / 10));
        setVar('cbw', comboFill, 'width', Math.round(Math.max(0, Math.min(1, num(state.comboTimer))) * 100) + '%');
      }
    } catch (e) {
      if (!cache.err) { cache.err = true; console.error('ui.updateHUD', e); }
    }
  }

  // ------------------------------------------------------------ events / banners
  function banner(text, cls, ms) {
    const b = h('div', 'banner ' + (cls || ''));
    b.appendChild(h('span', null, text));
    banners.appendChild(b);
    while (banners.children.length > 3) banners.removeChild(banners.firstChild);
    setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, ms || 2200);
  }
  function flashScreen(color) {
    flash.style.setProperty('--fc', color);
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
  }

  function handleEvents(events) {
    if (!events || !events.length) return;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev) continue;
      try {
        switch (ev.type) {
          case 'waveStart':
            if (ev.isBoss) banner('BOSS WAVE', 'boss', 2600);
            else banner('WAVE ' + num(ev.wave, 1), 'wave', 2000);
            break;
          case 'waveClear':
            banner('WAVE CLEARED', 'clear', 1800);
            break;
          case 'blowReady':
            // no stacking under a wave / boss banner; the meter itself says READY
            if (!banners.querySelector('.banner.wave, .banner.clear, .banner.boss, .banner.warn')) banner('BLOW READY', 'ready', 1400);
            flashScreen('rgba(255,240,170,.35)');
            break;
          case 'blow':
            // the nova fired: a lingering READY banner would be stale
            banners.querySelectorAll('.banner.ready').forEach((b) => b.remove());
            break;
          case 'bossSpawn':
            banner('WARNING', 'warn', 2600);
            flashScreen('rgba(255,40,40,.35)');
            break;
          case 'bossPhase':
            flashScreen('rgba(255,120,60,.22)');
            break;
          case 'playerHit':
            flashScreen('rgba(255,30,30,.16)');
            break;
          default: break;
        }
      } catch (err) { /* never throw */ }
    }
  }

  function setMuted(m) {
    mutedNow = !!m;
    muteButtons.forEach(paintMute);
  }

  setMuted(mutedNow);
  setOverlay(null);
  hud.hidden = true;

  return { showMenu, showPause, showGameOver, showUpgrade, hideOverlays, updateHUD, handleEvents, setMuted, setScores, setFriends };
}

// Friends board: a shared high-score list kept by leaderboard/scores.php on a server you control
// (setup: leaderboard/README.md). It is on only when BOARD_URL is set and the game was opened once
// with ?board=CODE; this browser remembers the code. Otherwise the game keeps its local board only.

// Address of scores.php. `npm run dist` sets 'scores.php' (next to index.html) in the zip it builds;
// a copy of the game served elsewhere can use a full address, e.g. 'https://games.example.com/scores.php'.
export const BOARD_URL = '';

const CODE_KEY = 'elemental-blow-board';
const CODE_RE = /^[a-z0-9-]{3,32}$/;
const TIMEOUT_MS = 6000;
const NAME_MAX = 12;

function readCode() {
  let code = null;
  try {
    code = new URLSearchParams(window.location.search).get('board');
  } catch {
    /* no location */
  }
  code = code ? code.trim().toLowerCase() : '';
  try {
    if (CODE_RE.test(code)) window.localStorage.setItem(CODE_KEY, code);
    else code = window.localStorage.getItem(CODE_KEY) || '';
  } catch {
    /* storage unavailable: the code only lasts for this page load */
  }
  return CODE_RE.test(code) ? code : '';
}

/** `text` without the characters the board refuses (anything but letters, digits, spaces and . _ ' ! ? -);
 *  the name field applies it while typing, so the name shown is the name saved. */
export function stripName(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._'!?-]|[\u115F\u1160\u3164\uFFA0]/gu, ''); // the second set: blank "letters"
}

/** `name` as the board accepts it (letters, digits, spaces and . _ ' ! ? -, at most 12), or '' if nothing is left. */
export function boardName(name) {
  const kept = stripName(name)
    .replace(/ {2,}/g, ' ')
    .trim();
  const cut = Array.from(kept).slice(0, NAME_MAX).join('').trim();
  return /[\p{L}\p{N}]/u.test(cut) ? cut : '';
}

function row(r) {
  return {
    name: String((r && r.name) || '???').slice(0, 24),
    score: Number.isFinite(r && r.score) ? r.score : 0,
    wave: Number.isFinite(r && r.wave) ? r.wave : 0,
  };
}

async function call(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init, signal: ctl.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    const body = await res.json();
    if (!res.ok || !body || !Array.isArray(body.scores)) throw new Error((body && body.error) || `HTTP ${res.status}`);
    const me = body.me && Number.isFinite(body.me.rank) ? { rank: body.me.rank, ...row(body.me) } : null;
    return { scores: body.scores.map(row), me };
  } finally {
    clearTimeout(timer);
  }
}

export function createBoard() {
  const code = BOARD_URL ? readCode() : '';
  let lastPost = Promise.resolve();
  return {
    active: !!code,
    /** Current top of the board ({ scores }); waits for a score still being sent. */
    top() {
      return lastPost.then(() => call(`${BOARD_URL}?board=${encodeURIComponent(code)}`, { method: 'GET' }));
    },
    /** Sends a finished run ({ name, score, wave }); resolves to { scores, me }. */
    submit(run) {
      const p = call(BOARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // a "simple" request: no CORS preflight
        body: JSON.stringify({ board: code, name: run.name, score: run.score, wave: run.wave }),
      });
      lastPost = p.catch(() => {});
      return p;
    },
  };
}

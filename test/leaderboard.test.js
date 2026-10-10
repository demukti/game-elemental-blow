// leaderboard/scores.php, run under PHP's built-in server. Skipped when `php` is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'leaderboard', 'scores.php');
const HAS_PHP = !spawnSync('php', ['-v']).error;
const HAS_CGI = !spawnSync('php-cgi', ['-v']).error;
const ORIGIN = 'http://localhost:5181';
const skip = HAS_PHP ? false : 'php not installed';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** A fresh temp folder with www/scores.php (configured unless told not to) and an empty data/ folder. */
function setUp({ boards = ['wolfpack'], dataDir = 'data/eb', configure = true } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eb-board-')));
  const www = path.join(tmp, 'www');
  fs.mkdirSync(www);
  fs.mkdirSync(path.join(tmp, 'data'));
  let src = fs.readFileSync(SCRIPT, 'utf8');
  if (configure) {
    const set = (from, to) => {
      assert.ok(src.includes(from), `setting line missing: ${from}`);
      src = src.replace(from, to);
    };
    set("const BOARDS = ['change-me'];", `const BOARDS = ${JSON.stringify(boards).replace(/"/g, "'")};`);
    set("const ALLOWED_ORIGINS = ['https://demukti.github.io'];", `const ALLOWED_ORIGINS = ['${ORIGIN}'];`);
    set("const DATA_DIR = '';", `const DATA_DIR = '${path.join(tmp, dataDir)}';`);
  }
  fs.writeFileSync(path.join(www, 'scores.php'), src);
  return { tmp, www, script: path.join(www, 'scores.php'), dataDir: path.join(tmp, dataDir) };
}

/** Serves a set-up copy of scores.php under PHP's built-in server. */
async function startPhp(opts) {
  const { tmp, www, dataDir } = setUp(opts);
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', www], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/scores.php`;
  for (let i = 0; ; i++) {
    try {
      await fetch(url);
      break;
    } catch (err) {
      if (i > 50) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return {
    url,
    file: path.join(dataDir, 'scores.json'),
    www,
    stop() {
      proc.kill();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

async function post(srv, body, headers = {}) {
  const res = await fetch(srv.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function get(srv, board) {
  const res = await fetch(`${srv.url}?board=${encodeURIComponent(board)}`, { headers: { Origin: ORIGIN } });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

let srv;
before(async () => {
  if (HAS_PHP) srv = await startPhp();
});
after(() => srv && srv.stop());

test('leaderboard: refuses to run with the placeholder settings', { skip }, async () => {
  const s = await startPhp({ configure: false });
  try {
    assert.equal((await get(s, 'change-me')).status, 503);
  } finally {
    s.stop();
  }
});

test('leaderboard: keeps each name\'s best run, best first', { skip }, async () => {
  assert.deepEqual((await get(srv, 'wolfpack')).body, { scores: [] });
  let r = await post(srv, { board: 'wolfpack', name: '  Sam  ', score: 1234, wave: 5 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.me, { rank: 1, name: 'Sam', score: 1234, wave: 5 });
  r = await post(srv, { board: 'wolfpack', name: 'sam', score: 100, wave: 2 }); // lower: ignored
  assert.deepEqual(r.body.scores, [{ name: 'Sam', score: 1234, wave: 5 }]);
  await post(srv, { board: 'wolfpack', name: 'Zoë-2', score: 3000, wave: 6 });
  r = await post(srv, { board: 'wolfpack', name: 'SAM', score: 5000, wave: 7 }); // higher: replaces
  assert.deepEqual(r.body.scores, [
    { name: 'SAM', score: 5000, wave: 7 },
    { name: 'Zoë-2', score: 3000, wave: 6 },
  ]);
  assert.equal(r.body.me.rank, 1);
  assert.deepEqual((await get(srv, 'wolfpack')).body.scores, r.body.scores);
});

test('leaderboard: rejects bad input without touching the file', { skip }, async () => {
  const before = fs.readFileSync(srv.file, 'utf8');
  const ok = { board: 'wolfpack', name: 'Ok', score: 10, wave: 1 };
  const cases = [
    [{ ...ok, board: 'other' }, 404],
    [{ ...ok, board: ['wolfpack'] }, 400], // nested: too deep
    [{ ...ok, name: '<b>hi</b>' }, 400],
    [{ ...ok, name: '' }, 400],
    [{ ...ok, name: '   ' }, 400],
    [{ ...ok, name: '...' }, 400],
    [{ ...ok, name: 'a'.repeat(13) }, 400],
    [{ ...ok, name: 'á' }, 400], // combining mark
    [{ ...ok, name: 'a‮b' }, 400], // bidi override
    [{ ...ok, name: 'a\nb' }, 400],
    [{ ...ok, name: 'Sam\n' }, 400], // `$` before a final newline
    [{ ...ok, name: 'Sam \n' }, 400],
    [{ ...ok, name: '\u3164' }, 400], // blank Hangul filler "letter"
    [{ ...ok, name: 'a\u3164' }, 400],
    [{ ...ok, name: '😀' }, 400],
    [{ ...ok, score: 10.5 }, 400],
    [{ ...ok, score: '10' }, 400],
    [{ ...ok, score: 0 }, 400],
    [{ ...ok, score: 20001, wave: 1 }, 400], // above the plausibility cap
    [{ ...ok, wave: 0 }, 400],
    [{ ...ok, wave: 501 }, 400],
    ['{"board":"wolfpack","name":{"a":1},"score":10,"wave":1}', 400], // nested
    ['not json', 400],
    ['x'.repeat(600), 413],
  ];
  for (const [body, status] of cases) {
    const r = await post(srv, body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await post(srv, ok, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(srv.url, { method: 'PUT' })).status, 405);
  assert.equal(fs.readFileSync(srv.file, 'utf8'), before);
});

test('leaderboard: safe response headers; CORS only for the allowed origin', { skip }, async () => {
  const r = await get(srv, 'wolfpack');
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('x-powered-by'), null);
  const other = await fetch(`${srv.url}?board=wolfpack`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('leaderboard: parallel posts all land; a board is capped at 100 rows', { skip }, async () => {
  const s = await startPhp();
  try {
    await Promise.all(
      Array.from({ length: 120 }, (_, i) => post(s, { board: 'wolfpack', name: `P${i}`, score: 1000 + i, wave: 3 })),
    );
    const saved = JSON.parse(fs.readFileSync(s.file, 'utf8')).wolfpack;
    assert.equal(saved.length, 100);
    assert.equal(saved[0].score, 1119);
    assert.equal(saved[99].score, 1020);
    const r = await get(s, 'wolfpack');
    assert.equal(r.body.scores.length, 100);
    assert.deepEqual(r.body.scores[0], { name: 'P119', score: 1119, wave: 3 });
    assert.deepEqual(r.body.scores[99], { name: 'P20', score: 1020, wave: 3 });
    // a run too low for the full board is not kept and has no rank
    assert.equal((await post(s, { board: 'wolfpack', name: 'Low', score: 5, wave: 1 })).body.me, null);
  } finally {
    s.stop();
  }
});

test('leaderboard: a broken score file is left alone, not overwritten', { skip }, async () => {
  const s = await startPhp();
  try {
    await post(s, { board: 'wolfpack', name: 'Sam', score: 50, wave: 1 });
    const broken = fs.readFileSync(s.file, 'utf8').replace('"Sam",', '"Sam"'); // a hand-edit typo
    fs.writeFileSync(s.file, broken);
    assert.equal((await post(s, { board: 'wolfpack', name: 'Kai', score: 60, wave: 1 })).status, 500);
    assert.equal((await get(s, 'wolfpack')).status, 500);
    assert.equal(fs.readFileSync(s.file, 'utf8'), broken);
  } finally {
    s.stop();
  }
});

test('leaderboard: refuses a data folder inside the web root', { skip }, async () => {
  const s = await startPhp({ dataDir: 'www/eb-data' });
  try {
    assert.equal((await post(s, { board: 'wolfpack', name: 'Sam', score: 50, wave: 1 })).status, 500);
    assert.equal(fs.existsSync(path.join(s.www, 'eb-data')), false);
  } finally {
    s.stop();
  }
});

test('leaderboard: a run that changes nothing writes nothing; a daily backup keeps the previous file', { skip }, async () => {
  const s = await startPhp();
  const dir = path.dirname(s.file);
  const today = new Date().toISOString().slice(0, 10);
  const bak = path.join(dir, `scores.bak.${today}.json`);
  try {
    await post(s, { board: 'wolfpack', name: 'Sam', score: 500, wave: 2 });
    assert.equal(fs.existsSync(bak), false); // nothing to back up yet
    const first = fs.readFileSync(s.file, 'utf8');
    const mtime = fs.statSync(s.file).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    await post(s, { board: 'wolfpack', name: 'sam', score: 100, wave: 1 }); // lower: no change
    assert.equal(fs.statSync(s.file).mtimeMs, mtime);
    await post(s, { board: 'wolfpack', name: 'Kai', score: 900, wave: 3 });
    assert.equal(fs.readFileSync(bak, 'utf8'), first); // the state before the change
    await post(s, { board: 'wolfpack', name: 'Ana', score: 950, wave: 3 });
    assert.equal(fs.readFileSync(bak, 'utf8'), first); // at most one backup a day
    assert.deepEqual(fs.readdirSync(dir).sort(), [`scores.bak.${today}.json`, 'scores.json', 'scores.lock']);
  } finally {
    s.stop();
  }
});

test('leaderboard: keeps the last 7 daily backups and never rewrites an earlier day', { skip }, async () => {
  const s = await startPhp();
  const dir = path.dirname(s.file);
  const today = new Date().toISOString().slice(0, 10);
  try {
    await post(s, { board: 'wolfpack', name: 'Sam', score: 500, wave: 2 });
    const old = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
    for (const d of old) fs.writeFileSync(path.join(dir, `scores.bak.${d}.json`), `{"day":"${d}"}`);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine'); // other files are left alone
    await post(s, { board: 'wolfpack', name: 'Kai', score: 900, wave: 3 });
    const baks = fs.readdirSync(dir).filter((f) => f.startsWith('scores.bak.')).sort();
    assert.deepEqual(baks, [...old.slice(2).map((d) => `scores.bak.${d}.json`), `scores.bak.${today}.json`]);
    assert.equal(fs.readFileSync(path.join(dir, 'scores.bak.2026-01-08.json'), 'utf8'), '{"day":"2026-01-08"}');
    assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
  } finally {
    s.stop();
  }
});

test('leaderboard: refuses to write when the web root is unknown', { skip: HAS_CGI ? false : 'php-cgi not installed' }, () => {
  const { tmp, script, dataDir } = setUp();
  try {
    const run = (extra) => {
      const env = {
        PATH: process.env.PATH, REDIRECT_STATUS: '200', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: 'GET',
        SCRIPT_FILENAME: script, QUERY_STRING: 'board=wolfpack', ...extra,
      };
      return spawnSync('php-cgi', [], { env, encoding: 'utf8' }).stdout;
    };
    for (const extra of [{}, { DOCUMENT_ROOT: '' }, { DOCUMENT_ROOT: path.join(tmp, 'missing') }]) {
      const out = run(extra);
      assert.match(out, /^Status: 500/m, JSON.stringify(extra));
      assert.equal(fs.existsSync(dataDir), false);
    }
    assert.match(run({ DOCUMENT_ROOT: path.join(tmp, 'www') }), /"scores":\[\]/); // a known root outside the data folder
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

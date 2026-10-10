<?php
// Elemental Blow friends leaderboard: one file, no database. Scores live in a JSON file in a
// folder outside the web root. Setup, moderation and security notes: README.md next to this file.
//
//   GET  scores.php?board=CODE   ->  {"scores": [{"name", "score", "wave"}, ...]}  (best first)
//   POST scores.php              ->  the same, plus "me": {"rank", "name", "score", "wave"}
//        body (sent as text/plain, so browsers skip the CORS preflight):
//        {"board": "CODE", "name": "Sam", "score": 12345, "wave": 7}
//
// A board keeps one row per name: that player's best run. Needs PHP 7.1 or newer.

declare(strict_types=1);

// ---- Settings: edit these after uploading ----------------------------------------------------
// Board codes this script accepts. Share the game link with one: .../game-elemental-blow/?board=CODE
// 3 to 32 characters: lowercase letters, digits and dashes.
const BOARDS = ['change-me'];
// Pages allowed to read the board from a browser (scheme and host, no trailing slash).
const ALLOWED_ORIGINS = ['https://demukti.github.io'];
// Folder for the score file. Leave '' when the script sits anywhere under a folder named public_html or
// private_html (DirectAdmin, cPanel): it then uses elemental-blow-data next to the outermost one, e.g.
// /home/you/domains/example.com/elemental-blow-data, outside every site's web root. Otherwise set an
// absolute path outside the web root of every site on the account, e.g. '/home/you/elemental-blow-data'.
// The script refuses a folder inside its own web root (it cannot know other sites' roots). It creates
// the folder if the parent exists and is writable.
const DATA_DIR = '';
// -----------------------------------------------------------------------------------------------

const MAX_BODY = 512;     // bytes; a real submission is under 100
const MAX_PLAYERS = 100;  // rows kept per board
const SHOW = 100;         // rows returned: the whole board
const MAX_WAVE = 500;
const SCORE_PER_WAVE2 = 20000; // plausibility cap: score <= this * wave^2 (real runs stay far below)
const BACKUP_DAYS = 7;    // daily copies kept (scores.bak.YYYY-MM-DD.json)

if (function_exists('ini_set')) { // some hosts disable it
    ini_set('display_errors', '0');
}
header_remove('X-Powered-By');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('Referrer-Policy: no-referrer');
header('Vary: Origin');

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if (in_array($origin, ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
}

function reply(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
    exit;
}

function fail(int $status, string $error, string $log = ''): void
{
    if ($log !== '') {
        error_log('elemental-blow scores.php: ' . $log);
    }
    reply($status, ['error' => $error]);
}

function configured(): bool
{
    if (!BOARDS || in_array('change-me', BOARDS, true)) {
        return false;
    }
    foreach (BOARDS as $b) {
        if (!is_string($b) || !preg_match('/^[a-z0-9-]{3,32}$/', $b)) {
            return false;
        }
    }
    return data_path() !== '';
}

/** DATA_DIR if it is an absolute path; when it is empty, elemental-blow-data next to the outermost
 *  public_html / private_html above this script; '' if neither applies. */
function data_path(): string
{
    if (DATA_DIR !== '') {
        return preg_match('#^(/|[A-Za-z]:[\\\\/])#', DATA_DIR) === 1 ? DATA_DIR : '';
    }
    $here = str_replace('\\', '/', __DIR__);
    return preg_match('#^(/.*?)/(?:public_html|private_html)(?:/|$)#', $here, $m) === 1 ? $m[1] . '/elemental-blow-data' : '';
}

function valid_board($b): bool
{
    return is_string($b) && in_array($b, BOARDS, true);
}

/** Trimmed name of 1-12 letters, digits, spaces and . _ ' ! ? - with at least one letter or digit; null otherwise.
 *  D: `$` must not match before a final newline. Blank Hangul filler "letters" are refused too. */
function clean_name($name): ?string
{
    if (!is_string($name) || strlen($name) > 64) {
        return null;
    }
    $name = preg_replace('/ {2,}/', ' ', trim($name, ' '));
    if (!is_string($name)
        || preg_match("/^[\\p{L}\\p{N} ._'!?-]{1,12}$/Du", $name) !== 1
        || preg_match('/[\x{115F}\x{1160}\x{3164}\x{FFA0}]/u', $name) !== 0
        || preg_match('/[\p{L}\p{N}]/u', $name) !== 1) {
        return null;
    }
    return $name;
}

/** True when $path is inside this site's web root or the script's own folder, or when the web root is unknown
 *  (fail closed). Best effort: other sites' web roots on the same account cannot be known from here. */
function in_web_root(string $path): bool
{
    $doc = (string) ($_SERVER['DOCUMENT_ROOT'] ?? '');
    if ($doc === '') {
        return true;
    }
    $roots = [$doc, __DIR__];
    if ((string) ($_SERVER['CONTEXT_DOCUMENT_ROOT'] ?? '') !== '') {
        $roots[] = (string) $_SERVER['CONTEXT_DOCUMENT_ROOT'];
    }
    foreach ($roots as $root) {
        $real = realpath($root);
        if ($real === false
            || strpos($path . DIRECTORY_SEPARATOR, rtrim($real, '/\\') . DIRECTORY_SEPARATOR) === 0) {
            return true;
        }
    }
    return false;
}

/** The score folder (created if missing), or a failed reply if it is unusable or inside the web root. */
function data_dir(): string
{
    $dir = rtrim(data_path(), '/\\');
    $parent = realpath(dirname($dir));
    if ($parent === false) {
        fail(500, 'storage', 'the parent folder of the data folder does not exist');
    }
    $dir = $parent . DIRECTORY_SEPARATOR . basename($dir);
    if (in_web_root($dir)) { // checked before creating anything
        fail(500, 'storage', 'the data folder is inside the web root (or the web root is unknown); set DATA_DIR outside');
    }
    if (!is_dir($dir) && !@mkdir($dir, 0755)) {
        fail(500, 'storage', 'cannot create the data folder ' . $dir);
    }
    $real = realpath($dir); // again after resolving links
    if ($real === false || in_web_root($real)) {
        fail(500, 'storage', 'the data folder is missing or resolves into the web root');
    }
    return $real;
}

/** The decoded score file ([] when it does not exist yet), or null when it is unreadable or not valid JSON. */
function load(string $file): ?array
{
    if (!file_exists($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    $data = is_string($raw) ? json_decode($raw, true) : null;
    return is_array($data) ? $data : null;
}

/** Well-formed rows of one board, best first (a hand edit cannot break the output). */
function rows($list): array
{
    $out = [];
    foreach (is_array($list) ? $list : [] as $r) {
        if (is_array($r) && is_string($r['name'] ?? null) && is_int($r['score'] ?? null) && is_int($r['wave'] ?? null)) {
            $out[] = ['name' => $r['name'], 'score' => $r['score'], 'wave' => $r['wave'], 'time' => is_int($r['time'] ?? null) ? $r['time'] : 0];
        }
    }
    usort($out, function (array $a, array $b): int {
        return [$b['score'], $a['time'], $a['name']] <=> [$a['score'], $b['time'], $b['name']];
    });
    return $out;
}

/** Writes $content to $target through a fresh temporary file and a rename: never a partial file, never
 *  through a planted link. */
function write_atomic(string $dir, string $target, string $content): bool
{
    $tmp = $dir . DIRECTORY_SEPARATOR . 'scores-' . bin2hex(random_bytes(8)) . '.tmp';
    $fh = @fopen($tmp, 'x');
    if ($fh === false) {
        return false;
    }
    $ok = fwrite($fh, $content) === strlen($content);
    $ok = fclose($fh) && $ok;
    if (!$ok || !@rename($tmp, $target)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function public_row(array $r): array
{
    return ['name' => $r['name'], 'score' => $r['score'], 'wave' => $r['wave']];
}

function top(array $rows): array
{
    return array_map('public_row', array_slice($rows, 0, SHOW));
}

$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'POST') {
    header('Allow: GET, POST');
    fail(405, 'method not allowed');
}
if (!configured()) {
    fail(503, 'not configured'); // not logged: anyone could fill the log before setup
}

if ($method !== 'POST') {
    $board = $_GET['board'] ?? null;
    if (!valid_board($board)) {
        fail(404, 'unknown board');
    }
    $data = load(data_dir() . '/scores.json');
    if ($data === null) {
        fail(500, 'storage', 'scores.json is not valid JSON');
    }
    reply(200, ['scores' => top(rows($data[$board] ?? []))]);
}

if ($origin !== '' && !in_array($origin, ALLOWED_ORIGINS, true)) {
    fail(403, 'origin not allowed');
}
$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if (!is_string($raw) || strlen($raw) > MAX_BODY) {
    fail(413, 'too large');
}
$in = json_decode($raw, true, 2);
if (!is_array($in)) {
    fail(400, 'bad request');
}
$board = $in['board'] ?? null;
$name = clean_name($in['name'] ?? null);
$score = $in['score'] ?? null;
$wave = $in['wave'] ?? null;
if (!valid_board($board)) {
    fail(404, 'unknown board');
}
if ($name === null) {
    fail(400, 'bad name');
}
if (!is_int($wave) || $wave < 1 || $wave > MAX_WAVE) {
    fail(400, 'bad wave');
}
if (!is_int($score) || $score < 1 || $score > SCORE_PER_WAVE2 * $wave * $wave) {
    fail(400, 'bad score');
}

$dir = data_dir();
$file = $dir . '/scores.json';
$lock = @fopen($dir . '/scores.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX)) {
    fail(500, 'storage', 'cannot lock scores.lock');
}
$data = load($file);
if ($data === null) {
    // most likely a hand edit with a typo: keep the file as it is rather than overwrite it
    fail(500, 'storage', 'scores.json is not valid JSON; fix or delete it');
}

$before = rows($data[$board] ?? []);
$rows = $before;
$key = strtolower($name);
$found = false;
foreach ($rows as $i => $r) {
    if (strtolower($r['name']) === $key) {
        $found = true;
        if ($score > $r['score']) {
            $rows[$i] = ['name' => $name, 'score' => $score, 'wave' => $wave, 'time' => time()];
        }
        break;
    }
}
if (!$found) {
    $rows[] = ['name' => $name, 'score' => $score, 'wave' => $wave, 'time' => time()];
}
$rows = array_slice(rows($rows), 0, MAX_PLAYERS);

if ($rows !== $before) { // a run that changes nothing writes nothing
    // Before the first change of each day (UTC), keep the file as it was in scores.bak.YYYY-MM-DD.json, for the
    // last BACKUP_DAYS days. Rows pushed off a full board (say, by a flood of fake scores) can be restored from
    // an earlier day's copy, which no later request can change.
    $bak = $dir . '/scores.bak.' . gmdate('Y-m-d') . '.json';
    if (file_exists($file) && !file_exists($bak)) {
        $old = @file_get_contents($file);
        if (!is_string($old) || !write_atomic($dir, $bak, $old)) {
            fail(500, 'storage', 'cannot write the daily backup');
        }
        $baks = preg_grep('/^scores\.bak\.\d{4}-\d{2}-\d{2}\.json$/', scandir($dir) ?: []);
        sort($baks); // dated names sort oldest first
        foreach (array_slice($baks, 0, max(0, count($baks) - BACKUP_DAYS)) as $name) {
            @unlink($dir . '/' . $name);
        }
    }
    $data[$board] = $rows;
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || !write_atomic($dir, $file, $json . "\n")) {
        fail(500, 'storage', 'cannot write scores.json');
    }
}
flock($lock, LOCK_UN);
fclose($lock);

$me = null;
foreach ($rows as $i => $r) {
    if (strtolower($r['name']) === $key) {
        $me = ['rank' => $i + 1] + public_row($r);
        break;
    }
}
reply(200, ['scores' => top($rows), 'me' => $me]);

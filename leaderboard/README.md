# Friends board

A shared high-score list for a group of players. `scores.php` is the whole server side: one PHP file, no database, scores in a JSON file. It normally sits next to the game's `index.html` on your own site; the game sends each finished run to it and shows the group's board: everyone, best first, in a scrolling list that opens on your own row.

Without it, or for anyone who opens the game without a board code, the game keeps its local high-score list as before.

## Setup

**Quick way (DirectAdmin, cPanel):** `npm run dist -- CODE HOST` (for example `npm run dist -- wolfpack games.example.com`; a random code is made if you leave it out) builds `dist/elemental-blow.zip`, the whole game ready to unpack: `index.html`, `style.css`, `src/` (with `BOARD_URL` set to `scores.php`) and `scores.php` with the code filled in. `dist/UPLOAD.txt` has step-by-step instructions for that site. Upload the zip into the site's `public_html` with the file manager and Extract it; nothing needs editing. Players open `https://HOST/?board=CODE`. `dist/` is git-ignored because it contains the board code.

**By hand:**

1. Put the game files and `scores.php` (PHP 7.1 or newer) in a site's folder, ideally its own subdomain such as `games.example.com`, not inside a business site. A separate hosting account is better still: then the script cannot even read the other sites' files.
2. Set `BOARD_URL` in `src/board.js` to `'scores.php'`, and edit the settings at the top of `scores.php`:
   - `BOARDS`: the board code(s) you will share, e.g. `['wolfpack']` (3 to 32 lowercase letters, digits, dashes).
   - `ALLOWED_ORIGINS`: leave it empty. The game's own site is always allowed; list another site only if a copy of the game served elsewhere should use this board (and give that copy the full address of `scores.php` as `BOARD_URL`).
   - `DATA_DIR`: leave it empty when the script sits anywhere under a `public_html` (or `private_html`) folder: it then keeps the scores in `elemental-blow-data` next to the outermost one, e.g. `/home/you/domains/games.example.com/elemental-blow-data` on DirectAdmin or `/home/you/elemental-blow-data` on cPanel. Otherwise set an absolute path **outside the web root of every site on the account**. The script creates the folder if its parent exists. As a safety net it refuses a folder inside its own site's web root, and refuses to store anything if the server does not say where that root is; it cannot know other sites' roots, so choosing the folder is up to you.
3. Open `https://games.example.com/scores.php?board=wolfpack` in a browser. `{"scores":[]}` means it works. `not configured` means a setting still has its placeholder. `storage` means the data folder cannot be created or written; the reason is in the server's PHP error log.
4. Send the players the link with the code: `https://games.example.com/?board=wolfpack`. Their browser remembers the code, so later visits without it still show the board.

## Moderation

Each board keeps one row per name (that player's best run), at most 100. To remove a rude name or a fake score, delete its entry from `scores.json` in the data folder. If an edit leaves the file invalid JSON, the board stops (the game shows the local scores) and the file is left untouched until you fix or delete it. Deleting the file clears every board.

Before the first change of each day (UTC), the script saves the previous `scores.json` as `scores.bak.YYYY-MM-DD.json` and keeps the last 7 days. A backup is never changed after that day. If a flood of fake scores pushed real players off a full board, copy the newest backup from before the flood over `scores.json`.

To retire a code, remove it from `BOARDS`: that board stops accepting and showing scores.

## Security

The script is written to add as little as possible to the server:

- It never runs, includes or evaluates anything it receives, never builds a file path from input, and has no database, so there is nothing to inject into.
- It writes only in `DATA_DIR`: `scores.json`, up to 7 daily `scores.bak.YYYY-MM-DD.json` copies, `scores.lock`, and short-lived temporary files. Writes are locked and atomic (a new temporary file, then a rename), so a crash or a full disk never leaves a half-written file, and a run that changes nothing writes nothing. With `DATA_DIR` outside every web root the files cannot be downloaded; even if they could, the stored text can never contain `<`, so it cannot be run as a page.
- Input is checked strictly: the board must be one of `BOARDS`; names are 1 to 12 letters, digits, spaces and `. _ ' ! ? -` (no line breaks, no invisible "blank" letters); score and wave must be whole numbers in range; bodies over 512 bytes are refused.
- Storage cannot grow: a fixed set of boards, 100 rows each.
- Replies are JSON only, with `nosniff`, a `default-src 'none'` content security policy and no caching. Pages on other websites cannot post to the board or read it from a visitor's browser (only the game's own site and any `ALLOWED_ORIGINS` can), and it uses no cookies or sessions.
- No admin page and no passwords: moderation is editing the file. PHP errors are never shown to visitors; problems go to the server's error log, and nothing is logged before the script is configured.

What it cannot do: stop a player who knows the board code and uses developer tools from posting a made-up score. Scores above a generous plausibility cap for the wave reached are refused; anything else is fixed by deleting the row (or, if the fakes filled the board, by restoring a daily backup). Request flooding is left to the host's usual protection, as for any other page.

An independent review of `scores.php` (code execution, inclusion, path traversal, header injection, XSS on the hosting domain, parsing edge cases, races, disk growth, error leaks) found no way in. Its low-severity findings (a web-root check that could pass when the server did not report its root, a name check a trailing newline could slip past, and a single backup an attacker could overwrite) are fixed and covered by `test/leaderboard.test.js`. The web-root check stays best effort, as described under Setup.

## Testing

`npm test` includes `test/leaderboard.test.js`, which runs `scores.php` under PHP's built-in server and `php-cgi` (each part is skipped when that program is not installed).

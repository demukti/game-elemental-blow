#!/bin/sh
# Builds dist/elemental-blow.zip, the whole game ready to unpack into a website's folder: index.html,
# style.css, touch.css, og.jpg, .htaccess and src/ (with BOARD_URL set to the scores.php next to them) plus scores.php
# with the board code filled in, and dist/UPLOAD.txt with step-by-step instructions.
# Usage: npm run dist [-- CODE [HOST]]   CODE: board code; HOST: the site, e.g. games.example.com, used in
# UPLOAD.txt and the link preview. Left out, both come from the last build (dist/UPLOAD.txt), since a new
# code cuts off every link already shared; with no last build the code is random.
# dist/ holds the board code, so it is git-ignored: keep it out of the public repo.
set -eu
cd "$(dirname "$0")/.."

prev_code=''
prev_host=''
if [ -f dist/UPLOAD.txt ]; then
  prev_code=$(sed -n 's/^Board code: *//p' dist/UPLOAD.txt | head -n 1)
  prev_host=$(sed -n "s|^Players' link: *https://\([^/]*\)/.*|\1|p" dist/UPLOAD.txt | head -n 1)
fi
if [ -z "${1:-}" ] && [ -n "$prev_code" ]; then
  echo "Reusing board code $prev_code from the last build (pass a CODE to change it)" >&2
fi
code="${1:-${prev_code:-eb-$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 6)}}"
host="${2:-${prev_host:-YOUR-SITE}}"
if ! printf '%s' "$code" | grep -Eq '^[a-z0-9-]{3,32}$'; then
  echo "board code: 3 to 32 lowercase letters, digits and dashes" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist/stage/src
cp index.html style.css touch.css og.jpg .htaccess dist/stage/
cp src/*.js dist/stage/src/
if [ "$host" != YOUR-SITE ]; then # link previews (chat apps) need the image's full address
  sed -i.bak "s|content=\"og.jpg\"|content=\"https://$host/og.jpg\"|" dist/stage/index.html
  rm dist/stage/index.html.bak
  grep -q "content=\"https://$host/og.jpg\"" dist/stage/index.html
fi
sed -i.bak "s|^export const BOARD_URL = '';|export const BOARD_URL = 'scores.php';|" dist/stage/src/board.js
rm dist/stage/src/board.js.bak
grep -q "^export const BOARD_URL = 'scores.php';" dist/stage/src/board.js
sed "s|^const BOARDS = \['change-me'\];|const BOARDS = ['$code'];|" leaderboard/scores.php > dist/stage/scores.php
grep -q "^const BOARDS = \['$code'\];" dist/stage/scores.php
(cd dist/stage && zip -qrX ../elemental-blow.zip index.html style.css touch.css og.jpg .htaccess src scores.php)
rm -rf dist/stage

cat > dist/UPLOAD.txt <<EOF
Elemental Blow: upload the game with its friends board (DirectAdmin)
====================================================================

Board code:    $code
Players' link: https://$host/?board=$code

1. The site needs its own (sub)domain with HTTPS: DirectAdmin > Subdomain
   Management (keep the Default document root, domains/$host/public_html),
   then SSL/TLS Certificates, so that https://$host/ shows no certificate
   warning.

2. In File Manager open domains > $host > public_html and delete what
   DirectAdmin or an earlier upload put there (index.html, scores.php, old
   zips). cgi-bin can stay.

3. Upload elemental-blow.zip there, select it and choose Extract. You get
   index.html, style.css, touch.css, og.jpg, scores.php, a src folder and .htaccess
   (it tells browsers to check for a newer game on every visit). Delete the
   zip.

4. Open the players' link above. The menu shows "Friends Board" with
   "No scores yet. Be the first!". Every run that scores asks for a name.
   The scores are kept in domains/$host/elemental-blow-data, next to
   public_html, so they cannot be opened from the web.

5. Send the players' link to the players. Their browser remembers the code,
   so https://$host/ alone works for them afterwards. Anyone who opens the
   site without the code plays with scores kept only on their own device.


Updating the game later
-----------------------
Build again with the same code (npm run dist -- $code $host; a plain
npm run dist reuses it too), then upload and Extract the new zip over the
old files. The scores are outside public_html, so they stay, and players get
the new version on their next visit.


If something is off
-------------------
https://$host/scores.php?board=$code should show the board as text, like
{"scores":[]}. If it shows:

{"error":"storage"}
    PHP could not make the data folder. In File Manager, create a folder named
    elemental-blow-data in domains/$host (next to public_html) and reload.

{"error":"not configured"}
    scores.php is not inside a public_html folder. Open it in the File Manager
    editor and set DATA_DIR near the top to a folder outside public_html, e.g.
    '/home/YOUR-USER/domains/$host/elemental-blow-data'.

"500 Internal Server Error" on every page
    The host does not allow the .htaccess lines. Delete .htaccess in
    public_html; the game works without it (browsers may then keep an old
    version for a while after an update).

"Friends board unreachable right now" in the game
    The game could not load scores.php from its own folder: check the address
    above.


Looking after the board
-----------------------
Scores: domains/$host/elemental-blow-data/scores.json (the File Manager
editor can change it). To remove a rude name or a fake score, delete that
player's { ... } entry and keep the commas between entries valid. If the file
is left broken, the board pauses (the game shows local scores) until it is
fixed.

Backups: the same folder keeps scores.bak.YYYY-MM-DD.json for the last 7 days.
Copy one over scores.json to undo a flood of fake scores.

Another code or a second board: edit the BOARDS line near the top of scores.php,
e.g.  const BOARDS = ['$code', 'cousins'];
Each code is its own board; a removed code stops working.
EOF

echo "Built dist/elemental-blow.zip and dist/UPLOAD.txt (board code: $code, site: $host)"

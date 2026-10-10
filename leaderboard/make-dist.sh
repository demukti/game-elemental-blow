#!/bin/sh
# Builds dist/elemental-blow-board.zip (a folder with scores.php, board code filled in) and dist/UPLOAD.txt,
# for a PHP host's file manager: upload the zip, Extract.
# Usage: npm run dist [-- CODE]   CODE is the board code; a random one is made if it is left out.
# dist/ holds the board code, so it is git-ignored: keep it out of the public repo.
set -eu
cd "$(dirname "$0")/.."

code="${1:-eb-$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 6)}"
if ! printf '%s' "$code" | grep -Eq '^[a-z0-9-]{3,32}$'; then
  echo "board code: 3 to 32 lowercase letters, digits and dashes" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist/stage/elemental-blow-board
sed "s|^const BOARDS = \['change-me'\];|const BOARDS = ['$code'];|" leaderboard/scores.php > dist/stage/elemental-blow-board/scores.php
grep -q "^const BOARDS = \['$code'\];" dist/stage/elemental-blow-board/scores.php
(cd dist/stage && zip -qrX ../elemental-blow-board.zip elemental-blow-board)
rm -rf dist/stage

cat > dist/UPLOAD.txt <<EOF
Elemental Blow friends board: upload with DirectAdmin
=====================================================

Board code: $code

1. In DirectAdmin open File Manager, then domains > YOUR-DOMAIN > public_html.
   For a subdomain, go one level further, into its folder inside public_html.

2. Upload elemental-blow-board.zip there, select it and choose Extract.
   You now have a folder "elemental-blow-board" with scores.php in it.
   Delete the zip afterwards.

3. Check it in a browser:
     https://YOUR-DOMAIN/elemental-blow-board/scores.php?board=$code
   {"scores":[]} means it works. It has made the folder
   domains/YOUR-DOMAIN/elemental-blow-data (next to public_html, so it cannot be
   opened from the web), where the scores are kept.

4. Send Claude the address without the ?board=... part, so the game can use it:
     https://YOUR-DOMAIN/elemental-blow-board/scores.php

5. Then the players' link is:
     https://demukti.github.io/game-elemental-blow/?board=$code


If step 3 shows something else
------------------------------
{"error":"storage"}
    PHP could not make the data folder. In File Manager, create a folder named
    elemental-blow-data in domains/YOUR-DOMAIN (next to public_html) and reload.

{"error":"not configured"}
    scores.php is not inside a public_html folder. Open it in the File Manager
    editor and set DATA_DIR near the top to a folder outside public_html, e.g.
    '/home/YOUR-USER/domains/YOUR-DOMAIN/elemental-blow-data'.

Page not found on https://
    This domain keeps its https files in private_html. Extract the zip there
    instead; the scores still go to domains/YOUR-DOMAIN/elemental-blow-data.


Looking after the board
-----------------------
Scores: domains/YOUR-DOMAIN/elemental-blow-data/scores.json (the File Manager
editor can change it). To remove a rude name or a fake score, delete that
player's { ... } entry and keep the commas between entries valid. If the file
is left broken, the board pauses (the game shows local scores) until it is fixed.

Backups: the same folder keeps scores.bak.YYYY-MM-DD.json for the last 7 days.
Copy one over scores.json to undo a flood of fake scores.

Another code or a second board: edit the BOARDS line near the top of scores.php,
e.g.  const BOARDS = ['$code', 'cousins'];
Each code is its own board; a removed code stops working.
EOF

echo "Built dist/elemental-blow-board.zip and dist/UPLOAD.txt (board code: $code)"

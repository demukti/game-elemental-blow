#!/bin/sh
# Builds dist/elemental-blow-board.zip (scores.php with the board code filled in) and dist/UPLOAD.txt, for a
# PHP host's file manager: upload the zip into the site's folder, Extract. The instructions use BOARD_URL from
# src/board.js when it is set.
# Usage: npm run dist [-- CODE]   CODE is the board code; a random one is made if it is left out.
# dist/ holds the board code, so it is git-ignored: keep it out of the public repo.
set -eu
cd "$(dirname "$0")/.."

code="${1:-eb-$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 6)}"
if ! printf '%s' "$code" | grep -Eq '^[a-z0-9-]{3,32}$'; then
  echo "board code: 3 to 32 lowercase letters, digits and dashes" >&2
  exit 1
fi
url=$(sed -n "s|^export const BOARD_URL = '\([^']*\)'.*|\1|p" src/board.js)
host=$(printf '%s' "$url" | sed -n 's|^https://\([^/]*\)/.*|\1|p')
if [ -n "$url" ]; then
  game_line="The game already points at $url."
else
  url='https://YOUR-SUBDOMAIN/scores.php'
  host='YOUR-SUBDOMAIN'
  game_line="Set BOARD_URL in src/board.js to $url and publish the game."
fi

rm -rf dist
mkdir -p dist/stage
sed "s|^const BOARDS = \['change-me'\];|const BOARDS = ['$code'];|" leaderboard/scores.php > dist/stage/scores.php
grep -q "^const BOARDS = \['$code'\];" dist/stage/scores.php
(cd dist/stage && zip -qX ../elemental-blow-board.zip scores.php)
rm -rf dist/stage

cat > dist/UPLOAD.txt <<EOF
Elemental Blow friends board: upload with DirectAdmin
=====================================================

Board code:  $code
Address:     $url

1. Create the subdomain: DirectAdmin > Subdomain Management, add the first
   part of $host (for games.example.com that is "games").

2. Give it HTTPS: DirectAdmin > SSL Certificates > Let's Encrypt, and make sure
   $host is ticked. Opening https://$host/ must not show a certificate
   warning. The game runs on https and browsers refuse to talk to an address
   without a valid certificate.

3. In File Manager open the subdomain's folder: domains > (main domain) >
   public_html > (subdomain name). Upload elemental-blow-board.zip there,
   select it and choose Extract. scores.php is now in that folder.
   Delete the zip afterwards.

4. Check it in a browser:
     $url?board=$code
   {"scores":[]} means it works. It has made the folder
   domains/(main domain)/elemental-blow-data, next to public_html, so it
   cannot be opened from the web. The scores are kept there.

5. $game_line
   The players' link is:
     https://demukti.github.io/game-elemental-blow/?board=$code


If step 4 shows something else
------------------------------
{"error":"storage"}
    PHP could not make the data folder. In File Manager, create a folder named
    elemental-blow-data in domains/(main domain), next to public_html, and reload.

{"error":"not configured"}
    scores.php is not inside a public_html folder. Open it in the File Manager
    editor and set DATA_DIR near the top to a folder outside public_html, e.g.
    '/home/YOUR-USER/domains/YOUR-DOMAIN/elemental-blow-data'.

Page not found
    The subdomain's files may live elsewhere (some setups use private_html for
    https). Put scores.php in the folder the subdomain actually serves; the
    scores still go to domains/(main domain)/elemental-blow-data.


Looking after the board
-----------------------
Scores: domains/(main domain)/elemental-blow-data/scores.json (the File
Manager editor can change it). To remove a rude name or a fake score, delete
that player's { ... } entry and keep the commas between entries valid. If the
file is left broken, the board pauses (the game shows local scores) until it is
fixed.

Backups: the same folder keeps scores.bak.YYYY-MM-DD.json for the last 7 days.
Copy one over scores.json to undo a flood of fake scores.

Another code or a second board: edit the BOARDS line near the top of scores.php,
e.g.  const BOARDS = ['$code', 'cousins'];
Each code is its own board; a removed code stops working.
EOF

echo "Built dist/elemental-blow-board.zip and dist/UPLOAD.txt (board code: $code, address: $url)"

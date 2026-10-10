# Elemental Blow

A top-down arena wave-survival brawler: switch elements to hit each enemy with the one that beats it, survive the waves, and beat a boss every fifth wave. Plain ES modules, canvas and WebAudio. No dependencies, no build step.

## Run

Requires Node 18 or newer (only used for the static server and tests).

```
npm start
```

Then open http://localhost:5180/. Set `PORT=8080 npm start` to use another port.

Add `?seed=123` to the URL for a reproducible run (same seed and same inputs give the same game).

Add `?bot=1` (or `?bot=simple` for the plain bot) to let the test bot play: it starts from the menu, takes the first upgrade and restarts after game over; its runs are not saved to the high-score board.

## Test

```
npm test
```

Runs `node --test` over `test/` (simulation rules, wave progression, determinism, soak tests with bots).

## Controls

| Action | Input |
| --- | --- |
| Move | WASD or arrow keys |
| Aim | Mouse |
| Fire current blow | Left mouse button (hold) |
| Switch element | 1 Fire, 2 Water, 3 Earth, 4 Air (also numpad), Q / E or mouse wheel to cycle |
| Dash (brief invulnerability) | Shift or right mouse button |
| Blow ultimate (needs full meter) | Space |
| Pause / resume | P or Esc |
| Mute | M |
| Full screen (Esc leaves it) | F or the corner button |

Menus: Enter or Space starts, Enter resumes, R or Enter restarts after game over, Esc returns to the menu.

## How it plays

**Element cycle.** Water beats fire, fire beats air, air beats earth, earth beats water. A hit with the element that beats the target deals 2x damage; the same element or the element that beats the attacker deals 0.5x; anything else is 1x. Like resists like in both directions: an enemy (or its bolt) of the element you currently hold deals only half damage to you, so matching an enemy is defensive and countering it is offensive. Every enemy carries an element, and early waves only use 2 to 4 of them, so keep switching.

**The four blows** (each has its own cooldown):

- Fire: fireball with splash damage and burn.
- Water: wide piercing wave that knocks back and slows.
- Earth: short-range slam that stuns and knocks back.
- Air: fast 3-dart volley.

**Blow meter.** Dealing damage and getting kills fills the meter. At 100, Space unleashes a nova that damages, burns, slows and stuns everything nearby and gives brief invulnerability.

**Enemies.** Grunts (flank in groups and lunge when close, from wave 2), swarms (small and fast; a pack circles you, then dives together), spitters (keep distance, flank your aim and lead their bolts; a 3-bolt fan from wave 9) and brutes (slow, heavy, telegraph then charge where you are heading; they raise a shield when you hold their counter at range). Survivors scatter for a moment after a nova or a quick 3-kill burst.

**Boss.** Every 5th wave: a big enemy that fires bolt bursts and spirals, summons minions and charges. It changes element at 66% and 33% HP, and later bosses are tougher.

Between waves you pick 1 of 3 random upgrades (damage per element, speed, cooldowns, healing, and more). Clearing a wave heals a little; orbs dropped by enemies restore health or charge the Blow meter. Kill combos multiply score.

## Layout

```
index.html, style.css   page shell
server.js               tiny static file server (PORT env, default 5180)
src/config.js           all constants and tuning tables
src/sim.js              game rules: pure, deterministic, no DOM or audio
src/main.js             app loop, pause/mute, ?seed=, localStorage
src/input.js            keyboard and mouse -> per-step input object
src/bot.js              autoplay bot (tests and the ?bot=1 playtest mode)
src/render.js           canvas drawing, particles, shake
src/ui.js               menus, HUD, upgrade screen
src/audio.js            WebAudio sound and music
test/                   node:test suites
```

`sim.js` imports nothing browser-specific and runs in Node, which is how the tests drive it. Its API is `createGame(seed)`, `update(state, input, dt)` (fixed 1/60 s steps, events emitted on `state` for render/audio/UI), `applyUpgrade`, `spawnEnemy`, `random`, `elementMultiplier` and `counterOf`. Render, UI and audio react to the events; they never change game state.

**High scores.** A run that makes the top 10 asks for a name on the game-over screen (Enter saves; leaving the screen saves too, as ANON if empty). The board shows on the game-over screen and the top 5 on the menu. It is per browser, not shared online.

The browser stores these in `localStorage`: `elemental-blow-best` (best run), `elemental-blow-scores` (top 10 board), `elemental-blow-name` (last name entered) and `elemental-blow-muted`.

## Tweaking balance

Edit `src/config.js` and reload; no build needed. Tables: `PLAYER` (HP, speed, dash), `BLOWS` (cooldown, damage, range per element), `ULT`, `ENEMIES`, `BOSS`, `WAVE`, `COMBO`, `PICKUPS`, `CAPS` and `UPGRADES`. Run `npm test` after changes, since some tests assume the default numbers.

The difficulty curve is the `WAVE` table. A regular wave spends a budget (`budgetBase + budgetPerWave * (wave - 1)`, times `breather` on the wave right after a boss) on bodies priced by `ENEMIES[type].cost`; `maxPerWave` caps the bodies and leftover budget becomes enemy HP up to `spongeCap`. `scale` sets the per-wave HP (linear + quadratic), damage (linear) and speed (soft-capped at `1 + speedMax`) multipliers. `palette` is how many elements a wave mixes (2 on waves 1-2, 3 on 3-5, 4 from 6), `unlock` the first wave of each type, `spitterSolo` / `spitterPerWave` and `brutePer` ration the two dangerous types, and `swarmPack` sizes the packs. Spawn cadence: `1 + floor(wave / groupEvery)` groups (max `groupMax`) every `spawnIntervalBase - spawnIntervalPerWave * (wave - 1)` seconds while fewer than `aliveBase + alivePerWave * wave` enemies are alive. Two rules shape the feel: pressure (when fewer enemies are alive than one group holds, the next group arrives after `pressureInterval` instead, so a wave is dense rather than a trickle) and mercy (below `mercyHp` of max HP on waves up to `mercyUntil`, spawn intervals stretch by `mercySlow`). The simultaneous element count and the spitter count are the main cognitive-load levers; damage scale and sustain (clear heal, orb drop rates, Siphon) decide how far a good run gets. `test/difficulty.test.js` pins these rules, and the `?bot=1` / `?bot=simple` modes let you watch a curve change play out.

## Performance

The renderer is fill-rate bound: additive glows, particles and the full-screen floor and vignette passes cost in proportion to the canvas backing store, not the window size. `src/render.js` therefore caps the backing store at 2560x1440 pixels regardless of screen size (a 4K display is upsampled by the browser) and scales it down further while frames run long, creeping back once they recover. Read the current state in the console with `elementalBlow.render` (`quality` 0.55 to 1, `backing` size, `frameMs` average). Adjust `MAX_PIXELS`, `Q_MIN` and the thresholds in `autoQuality` to taste.

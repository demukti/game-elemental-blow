// Shared helpers for the sim tests (not a test file itself).
// The bot lives in src/bot.js (it also drives the in-browser `?bot=1` mode); re-exported here.
export { IDLE, botInput, nearestEnemy } from '../src/bot.js';

export const STEP = 1 / 60;

/** Walk the whole state tree and return the path of the first non-finite number, or null. */
export function findNonFinite(value, path = 'state', seen = new Set()) {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findNonFinite(value[i], `${path}[${i}]`, seen);
      if (r) return r;
    }
    return null;
  }
  for (const k of Object.keys(value)) {
    const r = findNonFinite(value[k], `${path}.${k}`, seen);
    if (r) return r;
  }
  return null;
}

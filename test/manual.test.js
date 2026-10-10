import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualHTML } from '../src/manual.js';
import { PLAYER } from '../src/config.js';

test('manual: builds from the tuning tables without missing values', () => {
  const html = manualHTML();
  for (const bad of ['undefined', 'NaN', 'Infinity', '[object']) {
    const i = html.indexOf(bad);
    assert.equal(i, -1, `"${bad}" in the manual near: ${html.slice(Math.max(0, i - 120), i + 40)}`);
  }
  // a derived number (dash distance) is printed from config
  assert.ok(html.includes(`${PLAYER.dashSpeed * PLAYER.dashTime}&nbsp;px in`), 'dash distance');
});

test('manual: every link and nav entry points at a section', () => {
  const html = manualHTML();
  const ids = new Set([...html.matchAll(/id="m-([a-z]+)"/g)].map((m) => m[1]));
  assert.ok(ids.size >= 10, 'sections');
  const targets = [...html.matchAll(/data-goto="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length > ids.size, 'nav plus in-text links');
  for (const t of targets) assert.ok(ids.has(t), `link to missing section "${t}"`);
});

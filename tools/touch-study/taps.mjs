// Touch study, follow-up: aim stick (fires while pushed) + element by tap series (2 taps = next element,
// 3 = the one after, 4 = the farthest), compared with pads and the auto-aim prototype on the same seeds.
//
//   node tools/touch-study/taps.mjs [seeds=60] [cap=30]
//
// Shared run loop (runner.mjs), same difficulty proxy as compare.mjs. Not a fun measure.

import { compare, args } from './runner.mjs';
import { PRESETS } from './model.mjs';

const KEYS = ['fire', 'water', 'earth', 'air']; // the 1-4 keys and Q / E
const CYCLE = ['water', 'fire', 'air', 'earth']; // the beats cycle: each beats the next
const T = { order: KEYS, think: 0.15, tapIv: 0.17, window: 0.25, immediate: false, thumb: 'right' };
const twin = PRESETS.touchTwin;
const taps = (t = {}, o = {}) => ({ ...twin, hopFireGap: false, taps: { ...T, ...t }, ...o });

const VARIANTS = [
  ['desktop proxy', 'desktop', {}],
  ['twin-stick + element pads (right thumb hops)', 'touchTwin', {}],
  ['auto-aim prototype + pads', 'touchPads', { aim: 'proto' }],
  ['aim stick + tap series (right thumb)', 'touchTwin', taps()],
  ['  taps: each tap applies at once (no end window)', 'touchTwin', taps({ immediate: true })],
  ['  taps: quick and sure (0.13 s/tap, think 0.05, miscount 2%)', 'touchTwin', taps({ tapIv: 0.13, think: 0.05, window: 0.2 }, { mistap: 0.02 })],
  ['  taps: under pressure (0.2 s/tap, think 0.3, miscount 10%)', 'touchTwin', taps({ tapIv: 0.2, think: 0.3 }, { mistap: 0.1 })],
  ['  taps along the beats cycle instead of 1-4 order', 'touchTwin', taps({ order: CYCLE })],
  ['  taps with the left thumb (movement stops, fire goes on)', 'touchTwin', taps({ thumb: 'left' })],
  ['auto-aim + tap series (reference)', 'touchPads', { aim: 'proto', taps: { ...T }, hop: 0 }],
];

compare(VARIANTS, { ...args(), steps: true });

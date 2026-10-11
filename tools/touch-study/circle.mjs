// Touch study, follow-up: four element buttons in a circle on the right. Pressing one selects that
// element and the same touch becomes the aim stick, firing while held; earth fires on a tap (or on
// release after a drag). Compared with pads and the auto-aim prototype on the same seeds.
//
//   node tools/touch-study/circle.mjs [seeds=60] [cap=30]

import { compare, args } from './runner.mjs';
import { PRESETS } from './model.mjs';

const TOUCHY = { moveDelay: 0.17, react: 0.25, moveNoise: 10 }; // +50 ms touch latency, stick wobble
const BUTTON_DASH = { dashMotor: 0.15, dashFireGap: 0.3, dashBlockedBySwitch: true }; // right thumb lifts off
const FLICK_DASH = { dashMotor: 0.12, dashFireGap: 0, dashBlockedBySwitch: false }; // flick the move stick
const circle = (o = {}) => ({
  ...PRESETS.touchTwin, hop: 0.18, hopFireGap: true, mistap: 0.03, circle: { earthTap: 0.12 }, ...o,
});
const auto = { aim: 'proto', reacquire: 0 }; // holding without dragging fires at the auto-aim target
const manual = { aim: 'manual', reacquire: 0.15 }; // every press has to be aimed by hand

const VARIANTS = [
  ['desktop proxy', 'desktop', {}],
  ['twin-stick + element pads', 'touchTwin', {}],
  ['auto-aim prototype + pads', 'touchPads', { aim: 'proto' }],
  ['circle, hold = auto-aim, dash button', 'touchTwin', circle({ ...auto, ...BUTTON_DASH })],
  ['circle, hold = auto-aim, dash = stick flick', 'touchTwin', circle({ ...auto, ...FLICK_DASH })],
  ['circle, manual aim only, dash button', 'touchTwin', circle({ ...manual, ...BUTTON_DASH })],
  ['circle, manual aim only, dash = stick flick', 'touchTwin', circle({ ...manual, ...FLICK_DASH })],
  ['  circle, auto + flick, slower presses (hop 0.3, 8% wrong)', 'touchTwin', circle({ ...auto, ...FLICK_DASH, hop: 0.3, mistap: 0.08 })],
  ['  circle, auto + flick, earth only on cooldown + 0.3 s', 'touchTwin', circle({ ...auto, ...FLICK_DASH, circle: { earthTap: 0.3 } })],
  ['  circle, auto + flick, + touch latency and wobble', 'touchTwin', circle({ ...auto, ...FLICK_DASH, ...TOUCHY })],
  ['  prototype, + touch latency and wobble', 'touchPads', { aim: 'proto', ...TOUCHY }],
];

compare(VARIANTS, args());

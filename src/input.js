// Keyboard + mouse -> the contracted per-step input object:
//   { moveX, moveY, aimX, aimY, fire, dash, blow, switchTo, cycle }
// Held state (move, fire) is sampled every step; edge-triggered fields (dash, blow, switchTo,
// cycle) are latched when pressed and consumed by the first sim step that samples them.

import { ELEMENTS } from './config.js';

const MOVE = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

const SWITCH = {
  Digit1: ELEMENTS[0],
  Digit2: ELEMENTS[1],
  Digit3: ELEMENTS[2],
  Digit4: ELEMENTS[3],
  Numpad1: ELEMENTS[0],
  Numpad2: ELEMENTS[1],
  Numpad3: ELEMENTS[2],
  Numpad4: ELEMENTS[3],
};

const GAME_KEYS = new Set([...Object.keys(MOVE), ...Object.keys(SWITCH), 'Space', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE']);

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [data-ui-click]';

/**
 * @param {{ canvas: HTMLCanvasElement, renderer: { screenToWorld(x:number, y:number): {x:number,y:number} } }} opts
 */
export function createInput({ canvas, renderer }) {
  const held = new Set();
  let mouseX = null;
  let mouseY = null;
  let mouseDown = false;
  let active = false;
  // edge latches
  let dash = false;
  let blow = false;
  let switchTo = null;
  let cycle = 0;
  let lastWheel = 0;

  function clearEdges() {
    dash = false;
    blow = false;
    switchTo = null;
    cycle = 0;
  }

  function releaseAll() {
    held.clear();
    mouseDown = false;
    clearEdges();
  }

  const isInteractive = (target) => !!(target && target !== canvas && target.closest && target.closest(INTERACTIVE));

  function onKeyDown(e) {
    if (!active || e.ctrlKey || e.metaKey || e.altKey) return;
    const c = e.code;
    if (GAME_KEYS.has(c)) e.preventDefault();
    held.add(c);
    if (e.repeat) return;
    if (c === 'Space') blow = true;
    else if (c === 'ShiftLeft' || c === 'ShiftRight') dash = true;
    else if (c === 'KeyQ') cycle = -1;
    else if (c === 'KeyE') cycle = 1;
    else if (SWITCH[c]) switchTo = SWITCH[c];
  }

  function onKeyUp(e) {
    held.delete(e.code);
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  function onMouseDown(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!active || isInteractive(e.target)) return;
    if (e.button === 0) {
      mouseDown = true;
    } else if (e.button === 2) {
      dash = true;
      e.preventDefault();
    }
  }

  function onMouseUp(e) {
    if (e.button === 0) mouseDown = false;
  }

  function onWheel(e) {
    if (!active) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 1) return;
    const now = performance.now();
    if (now - lastWheel < 110) return; // one switch per notch; tames trackpad inertia
    lastWheel = now;
    cycle = e.deltaY > 0 ? 1 : -1;
  }

  function onContextMenu(e) {
    if (active || e.target === canvas) e.preventDefault();
  }

  function onBlur() {
    releaseAll();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', onBlur);

  function aim(state) {
    if (mouseX !== null && renderer && typeof renderer.screenToWorld === 'function') {
      const w = renderer.screenToWorld(mouseX, mouseY);
      if (w && Number.isFinite(w.x) && Number.isFinite(w.y)) return w;
    }
    const p = state && state.player;
    if (p) return { x: p.x + Math.cos(p.angle) * 100, y: p.y + Math.sin(p.angle) * 100 };
    return { x: 0, y: 0 };
  }

  return {
    /** Build the input object for one sim step and consume the edge latches. */
    sample(state) {
      let mx = 0;
      let my = 0;
      for (const c of held) {
        const v = MOVE[c];
        if (v) {
          mx += v[0];
          my += v[1];
        }
      }
      mx = Math.max(-1, Math.min(1, mx));
      my = Math.max(-1, Math.min(1, my));
      const a = aim(state);
      const out = {
        moveX: mx,
        moveY: my,
        aimX: a.x,
        aimY: a.y,
        fire: active && mouseDown,
        dash,
        blow,
        switchTo,
        cycle,
      };
      clearEdges();
      return out;
    },
    /** Gameplay input is only captured while active (app state 'playing'). */
    setActive(on) {
      active = !!on;
      if (!active) releaseAll();
    },
    /** Drop held keys/buttons and pending edges (e.g. after a menu or the upgrade screen). */
    reset() {
      releaseAll();
    },
    releaseAll,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', onBlur);
    },
  };
}

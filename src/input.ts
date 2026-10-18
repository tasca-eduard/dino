import { BUILD_ORDER, PLANT_ORDER, TOOLS } from '../shared/constants';
import { QUALITY, setQuality } from './game/quality';
import { sendAction } from './net';
import { game } from './store';

/** Keys currently held (KeyboardEvent.code). */
export const keys = new Set<string>();
/** Keys pressed since the last consume (edge-triggered). */
const pressed = new Set<string>();

export const mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false, leftPressed: false, rightPressed: false };

export function consumePress(code: string): boolean {
  return pressed.delete(code);
}

/** Drop presses nobody consumed this frame so they don't fire later. */
export function clearPresses() {
  pressed.clear();
}

export function consumeMouse() {
  const m = { dx: mouse.dx, dy: mouse.dy, wheel: mouse.wheel, leftPressed: mouse.leftPressed, rightPressed: mouse.rightPressed };
  mouse.dx = mouse.dy = mouse.wheel = 0;
  mouse.leftPressed = mouse.rightPressed = false;
  return m;
}

export function initInput(canvas: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const s = game();
    if (s.chatOpen || s.phase !== 'playing') return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab') e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit) s.set({ tool: Number(digit[1]) - 1 });
    const toolId = TOOLS[s.tool].id;
    switch (e.code) {
      case 'KeyR':
        if (toolId === 'seeds') s.set({ seedIdx: (s.seedIdx + (e.shiftKey ? PLANT_ORDER.length - 1 : 1)) % PLANT_ORDER.length });
        if (toolId === 'hammer') s.set({ buildIdx: (s.buildIdx + (e.shiftKey ? BUILD_ORDER.length - 1 : 1)) % BUILD_ORDER.length });
        break;
      case 'KeyT':
        s.set({ buildRot: (s.buildRot + 1) % 4 });
        break;
      case 'KeyH':
        s.set({ helpOpen: !s.helpOpen });
        if (!s.helpOpen) document.exitPointerLock?.();
        break;
      case 'Escape':
        if (s.helpOpen) s.set({ helpOpen: false });
        break;
      case 'Enter':
        e.preventDefault();
        keys.clear();
        s.set({ chatOpen: true });
        document.exitPointerLock?.();
        break;
      case 'KeyG':
        if (!e.repeat) setQuality((s.gfxLevel + 1) % QUALITY.length);
        break;
      case 'KeyF':
        if (!e.repeat) sendAction({ a: 'heal' });
        break;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  };
  const onMouseDown = (e: MouseEvent) => {
    const s = game();
    if (document.pointerLockElement !== canvas) {
      if (!s.chatOpen && !s.helpOpen) canvas.requestPointerLock?.();
      return;
    }
    if (e.button === 0) {
      mouse.left = true;
      mouse.leftPressed = true;
    }
    if (e.button === 2) {
      mouse.right = true;
      mouse.rightPressed = true;
    }
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  };
  const onWheel = (e: WheelEvent) => {
    mouse.wheel += Math.sign(e.deltaY);
  };
  const onLockChange = () => {
    const locked = document.pointerLockElement === canvas;
    game().set({ pointerLocked: locked });
    if (!locked) {
      mouse.left = mouse.right = false;
      keys.clear();
    }
  };
  const onBlur = () => {
    keys.clear();
    mouse.left = mouse.right = false;
  };
  const noMenu = (e: Event) => e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('contextmenu', noMenu);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', noMenu);
    document.removeEventListener('pointerlockchange', onLockChange);
    window.removeEventListener('blur', onBlur);
  };
}

// Mutable, non-reactive world state. Updated by the network layer at 20 Hz and read
// inside useFrame loops. Never put these in React state.
import { WORLD } from '../shared/constants';
import { V } from '../shared/terrain';
import type { FxKind } from '../shared/protocol';

export interface Ent {
  id: number;
  /** current rendered position (interpolated each frame by renderers) */
  x: number;
  y: number;
  z: number;
  ry: number;
  /** latest authoritative position from the server */
  tx: number;
  ty: number;
  tz: number;
  try: number;
  anim: number;
  hp: number;
  maxHp: number;
  type: number;
  slowed: boolean;
  hungry: boolean;
  dead: boolean;
  fresh: boolean;
}

export interface FxEvent {
  k: FxKind;
  x: number;
  y: number;
  z: number;
  dx?: number;
  dz?: number;
  r?: number;
}

const N2 = WORLD.N * WORLD.N;

export const world = {
  heights: new Float32Array(V * V),
  tiles: new Uint8Array(N2),
  wetUntil: new Float32Array(N2),
  irr: new Uint8Array(N2),
  /** tile indices whose geometry/colour must be rebuilt */
  dirtyTiles: new Set<number>(),
  /** bumped whenever heights change (obstacles / props re-snap to ground) */
  heightsVersion: 0,

  // server clock sync
  serverTime: 0,
  serverTimeAt: 0,

  players: new Map<number, Ent>(),
  enemies: new Map<number, Ent>(),
  animals: new Map<number, Ent>(),
  projectiles: new Map<number, Ent>(),
  /** live positions of walking wild plants (wanderroots) */
  walkers: new Map<number, { x: number; z: number }>(),

  /** the local player's simulated state, read by the camera, HUD, etc. */
  me: { x: 0, y: 0, z: 0, ry: 0, vy: 0, flying: false, swimming: false, speed: 0, anim: 0 },
};

/** Best estimate of the current server time in seconds. */
export function serverNow(): number {
  return world.serverTime + (performance.now() - world.serverTimeAt) / 1000;
}

export function makeEnt(id: number): Ent {
  return { id, x: 0, y: 0, z: 0, ry: 0, tx: 0, ty: 0, tz: 0, try: 0, anim: 0, hp: 0, maxHp: 0, type: 0, slowed: false, hungry: false, dead: false, fresh: true };
}

// ---------------------------------------------------------------- effects bus
type FxListener = (fx: FxEvent) => void;
const fxListeners = new Set<FxListener>();

export function onFx(fn: FxListener): () => void {
  fxListeners.add(fn);
  return () => fxListeners.delete(fn);
}

export function emitFx(fx: FxEvent) {
  for (const fn of fxListeners) fn(fx);
}

/** Smoothly move an entity's rendered transform toward its server target. */
export function interpolate(e: Ent, dt: number, rate = 12) {
  if (e.fresh) {
    e.x = e.tx;
    e.y = e.ty;
    e.z = e.tz;
    e.ry = e.try;
    e.fresh = false;
    return;
  }
  const k = 1 - Math.exp(-dt * rate);
  e.x += (e.tx - e.x) * k;
  e.y += (e.ty - e.y) * k;
  e.z += (e.tz - e.z) * k;
  let d = e.try - e.ry;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  e.ry += d * k;
}

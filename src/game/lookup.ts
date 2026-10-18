// Derived, non-reactive caches rebuilt when the relevant store slices change.
import { BUILDINGS, WORLD } from '../../shared/constants';
import { heightAt } from '../../shared/terrain';
import { useGame } from '../store';
import { world } from '../world';

export interface Obstacle {
  x: number;
  z: number;
  r: number;
  top: number;
}

export const lookup = {
  /** tile index -> planted plant id */
  plantByTile: new Map<number, number>(),
  obstacles: [] as Obstacle[],
};

/** Where the crosshair points, updated every frame by the local player controller. */
export const aim = {
  hit: false,
  x: 0,
  y: 0,
  z: 0,
  /** targeted tile within reach, or null */
  tile: null as [number, number] | null,
  /** horizontal camera forward */
  fx: 0,
  fz: 1,
  /** full 3D camera forward */
  dir: [0, 0, 1] as [number, number, number],
};

function rebuildPlants() {
  lookup.plantByTile.clear();
  for (const p of Object.values(useGame.getState().plants)) if (!p.wild && p.tx >= 0) lookup.plantByTile.set(p.tz * WORLD.N + p.tx, p.id);
}

function rebuildObstacles() {
  const s = useGame.getState();
  const list: Obstacle[] = [];
  for (const n of Object.values(s.nodes)) {
    const g = heightAt(world.heights, n.x, n.z);
    if (n.kind === 'tree') list.push({ x: n.x, z: n.z, r: n.amount > 0 ? 0.45 * n.s : 0.35, top: g + (n.amount > 0 ? 6 * n.s : 0.6) });
    else if (n.amount > 0) list.push({ x: n.x, z: n.z, r: 0.95 * n.s, top: g + 1.2 * n.s });
  }
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.type];
    if (b.type === 'spikes') continue;
    list.push({ x: b.x, z: b.z, r: def.radius * 0.9, top: heightAt(world.heights, b.x, b.z) + def.height });
  }
  lookup.obstacles = list;
}

let started = false;
export function startLookups() {
  if (started) return;
  started = true;
  useGame.subscribe((s, prev) => {
    if (s.plants !== prev.plants) rebuildPlants();
    if (s.nodes !== prev.nodes || s.buildings !== prev.buildings) rebuildObstacles();
  });
  rebuildPlants();
  rebuildObstacles();
}

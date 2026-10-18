import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BUILDINGS, BUILD_ORDER, PLANT_ORDER, TILE_T, TOOLS, WORLD, canAfford } from '../../shared/constants';
import { V, isWaterTile, tileCenter, tileIndex } from '../../shared/terrain';
import { BuildingModel } from '../models/Buildings';
import { game, useGame } from '../store';
import { world } from '../world';
import { aim, lookup } from './lookup';
import { terrainHeight } from './Terrain';

const FARM_TOOLS = new Set(['hoe', 'shovel', 'can', 'seeds']);

function farmValid(toolId: string, tx: number, tz: number): boolean {
  const s = game();
  const i = tileIndex(tx, tz);
  const water = isWaterTile(world.heights, tx, tz);
  const t = world.tiles[i];
  const planted = lookup.plantByTile.has(i);
  switch (toolId) {
    case 'hoe':
      return !water && t === TILE_T.GRASS && !planted;
    case 'shovel':
      return true;
    case 'can':
      return water || t === TILE_T.SOIL;
    case 'seeds': {
      const st = s.seeds[PLANT_ORDER[s.seedIdx]];
      return !water && t === TILE_T.SOIL && !planted && st.wild + st.heirloom > 0;
    }
  }
  return false;
}

function buildValid(tx: number, tz: number): boolean {
  const s = game();
  const type = BUILD_ORDER[s.buildIdx];
  const def = BUILDINGS[type];
  if (!canAfford(s.res, def.cost) || isWaterTile(world.heights, tx, tz)) return false;
  const [x, z] = tileCenter(tx, tz);
  for (const b of Object.values(s.buildings)) if (Math.hypot(b.x - x, b.z - z) < (def.radius + BUILDINGS[b.type].radius) * 0.85) return false;
  for (const o of lookup.obstacles) if (Math.hypot(o.x - x, o.z - z) < def.radius + o.r * 0.8) return false;
  for (const p of Object.values(s.plants)) if (!p.wild && Math.hypot(p.x - x, p.z - z) < def.radius + 0.3) return false;
  return true;
}

/** Outline of the targeted farm tile, conformed to the terrain. */
export function TileCursor() {
  const line = useRef<THREE.LineLoop>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }), []);
  useFrame(({ clock }) => {
    const s = game();
    const l = line.current;
    if (!l) return;
    const toolId = TOOLS[s.tool].id;
    const tile = aim.tile;
    l.visible = !!tile && FARM_TOOLS.has(toolId) && s.pointerLocked && !s.dead;
    if (!l.visible || !tile) return;
    const [tx, tz] = tile;
    const k = tz * V + tx;
    const h = world.heights;
    const x0 = -WORLD.HALF + tx * WORLD.TILE;
    const z0 = -WORLD.HALF + tz * WORLD.TILE;
    const T = WORLD.TILE;
    const lift = 0.06;
    const pos = geo.attributes.position.array as Float32Array;
    pos.set([x0, Math.max(h[k], -0.1) + lift, z0, x0 + T, Math.max(h[k + 1], -0.1) + lift, z0, x0 + T, Math.max(h[k + V + 1], -0.1) + lift, z0 + T, x0, Math.max(h[k + V], -0.1) + lift, z0 + T]);
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    mat.color.set(farmValid(toolId, tx, tz) ? '#b8ff8a' : '#ff6b6b');
    mat.opacity = 0.65 + Math.sin(clock.elapsedTime * 6) * 0.3;
  });
  return <lineLoop ref={line} geometry={geo} material={mat} renderOrder={20} />;
}

/** Translucent preview of the selected building while holding the hammer. */
export function BuildGhost() {
  const tool = useGame((s) => s.tool);
  const buildIdx = useGame((s) => s.buildIdx);
  const rot = useGame((s) => s.buildRot);
  const [valid, setValid] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const active = TOOLS[tool].id === 'hammer';
  useFrame(() => {
    const g = ref.current;
    const s = game();
    if (!g) return;
    const tile = aim.tile;
    g.visible = active && !!tile && s.pointerLocked && !s.dead;
    if (!g.visible || !tile) return;
    const [x, z] = tileCenter(tile[0], tile[1]);
    g.position.set(x, terrainHeight(x, z), z);
    const v = buildValid(tile[0], tile[1]);
    if (v !== valid) setValid(v);
  });
  if (!active) return null;
  return (
    <group ref={ref}>
      <group rotation-y={(rot * Math.PI) / 2}>
        <BuildingModel type={BUILD_ORDER[buildIdx]} ghost valid={valid} />
      </group>
    </group>
  );
}

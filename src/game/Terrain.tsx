import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TILE_T, WORLD } from '../../shared/constants';
import { V, heightAt } from '../../shared/terrain';
import { RoughProps } from '../models/Nature';
import { useGame } from '../store';
import { serverNow, world } from '../world';

const { N, TILE, HALF } = WORLD;
const VERTS_PER_TILE = 6;

const C = {
  grass: new THREE.Color('#6aae45'),
  grass2: new THREE.Color('#5c9e3c'),
  rough: new THREE.Color('#8a8a55'),
  soil: new THREE.Color('#8a5a32'),
  soilWet: new THREE.Color('#4e3119'),
  sand: new THREE.Color('#dcc98f'),
  seabed: new THREE.Color('#9c8a5c'),
  rock: new THREE.Color('#8b8378'),
  snow: new THREE.Color('#f2f2f2'),
};
const tmp = new THREE.Color();

const hash = (i: number) => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return ((Math.imul(h, 0xc2b2ae35) >>> 0) % 1000) / 1000;
};

/** Is this soil tile currently watered (client-side mirror of the server rule)? */
export function tileWet(i: number): boolean {
  return useGame.getState().rain || world.wetUntil[i] > serverNow() || world.irr[i] === 1;
}

function tileColor(i: number, avgH: number, out: THREE.Color) {
  const t = world.tiles[i];
  const j = hash(i);
  if (avgH < 0) out.copy(C.seabed).multiplyScalar(0.85 + j * 0.15);
  else if (t === TILE_T.SOIL) out.copy(tileWet(i) ? C.soilWet : C.soil).multiplyScalar(0.94 + j * 0.08);
  else if (t === TILE_T.SAND) out.copy(C.sand).multiplyScalar(0.95 + j * 0.05);
  else if (avgH > 13) out.copy(C.snow);
  else if (avgH > 8) out.copy(C.rock).multiplyScalar(0.9 + j * 0.15);
  else if (t === TILE_T.ROUGH) out.copy(C.rough).multiplyScalar(0.9 + j * 0.12);
  else out.copy(C.grass).lerp(C.grass2, j).multiplyScalar(1 - Math.max(0, avgH - 4) * 0.04);
  return out;
}

export function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null);
  const wetState = useRef(new Uint8Array(N * N));
  const recolorTimer = useRef(0);
  const [roughTiles, setRoughTiles] = useState<number[]>([]);
  const roughDirty = useRef(true);
  const roughSet = useRef(new Set<number>());

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = N * N * VERTS_PER_TILE;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), HALF * 1.5);
    return g;
  }, []);

  const writeTile = (i: number) => {
    const pos = geometry.attributes.position.array as Float32Array;
    const nor = geometry.attributes.normal.array as Float32Array;
    const col = geometry.attributes.color.array as Float32Array;
    const tx = i % N;
    const tz = Math.floor(i / N);
    const k = tz * V + tx;
    const h = world.heights;
    const x0 = -HALF + tx * TILE;
    const z0 = -HALF + tz * TILE;
    const a = [x0, h[k], z0];
    const b = [x0 + TILE, h[k + 1], z0];
    const c = [x0, h[k + V], z0 + TILE];
    const d = [x0 + TILE, h[k + V + 1], z0 + TILE];
    const tris = [a, c, b, b, c, d];
    const o = i * VERTS_PER_TILE * 3;
    for (let v = 0; v < 6; v++) {
      pos[o + v * 3] = tris[v][0];
      pos[o + v * 3 + 1] = tris[v][1];
      pos[o + v * 3 + 2] = tris[v][2];
    }
    for (let t = 0; t < 2; t++) {
      const [p0, p1, p2] = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let v = 0; v < 3; v++) {
        const q = o + (t * 3 + v) * 3;
        nor[q] = nx; nor[q + 1] = ny; nor[q + 2] = nz;
      }
    }
    const avg = (h[k] + h[k + 1] + h[k + V] + h[k + V + 1]) / 4;
    wetState.current[i] = tileWet(i) ? 1 : 0;
    tileColor(i, avg, tmp);
    // slight per-triangle shade variation gives the faceted low-poly look
    for (let v = 0; v < 6; v++) {
      const s = v < 3 ? 1 : 0.95;
      col[o + v * 3] = tmp.r * s;
      col[o + v * 3 + 1] = tmp.g * s;
      col[o + v * 3 + 2] = tmp.b * s;
    }
  };

  useLayoutEffect(() => {
    // (re)mounting (e.g. after a graphics quality change) needs the whole mesh written again
    for (let i = 0; i < N * N; i++) world.dirtyTiles.add(i);
    return () => geometry.dispose();
  }, [geometry]);

  useFrame((_, dt) => {
    let dirty = false;
    if (world.dirtyTiles.size) {
      for (const i of world.dirtyTiles) {
        writeTile(i);
        if (world.tiles[i] === TILE_T.ROUGH || roughSet.current.has(i)) roughDirty.current = true;
      }
      world.dirtyTiles.clear();
      dirty = true;
    }
    // wetness expires over time; refresh soil colours once a second
    recolorTimer.current += dt;
    if (recolorTimer.current > 1) {
      recolorTimer.current = 0;
      for (let i = 0; i < N * N; i++) {
        if (world.tiles[i] !== TILE_T.SOIL) continue;
        const w = tileWet(i) ? 1 : 0;
        if (w !== wetState.current[i]) {
          writeTile(i);
          dirty = true;
        }
      }
      if (roughDirty.current) {
        roughDirty.current = false;
        const list: number[] = [];
        for (let i = 0; i < N * N; i++) if (world.tiles[i] === TILE_T.ROUGH && heightAtTile(i) >= 0) list.push(i);
        roughSet.current = new Set(list);
        setRoughTiles(list);
      }
    }
    if (dirty) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    }
  });

  return (
    <>
      <mesh ref={meshRef} geometry={geometry} receiveShadow name="terrain">
        <meshStandardMaterial vertexColors flatShading roughness={0.95} metalness={0} />
      </mesh>
      <RoughProps tiles={roughTiles} heightAt={terrainHeight} />
    </>
  );
}

function heightAtTile(i: number) {
  const tx = i % N;
  const tz = Math.floor(i / N);
  const k = tz * V + tx;
  const h = world.heights;
  return (h[k] + h[k + 1] + h[k + V] + h[k + V + 1]) / 4;
}

export const terrainHeight = (x: number, z: number) => heightAt(world.heights, x, z);

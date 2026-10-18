import { TILE_T, WORLD } from './constants';

const { N, TILE, HALF } = WORLD;
export const V = N + 1; // vertices per side

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float32Array.from({ length: 256 }, () => rnd() * 2 - 1);
  const lat = (ix: number, iz: number) => vals[perm[(ix & 255) + perm[iz & 255]]];
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const u = fade(x - ix);
    const v = fade(z - iz);
    const a = lat(ix, iz) + (lat(ix + 1, iz) - lat(ix, iz)) * u;
    const b = lat(ix, iz + 1) + (lat(ix + 1, iz + 1) - lat(ix, iz + 1)) * u;
    return a + (b - a) * v;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const LAKES = [
  { x: 50, z: 34, r: 19 },
  { x: -42, z: -52, r: 9 },
];

export interface WorldData {
  heights: Float32Array; // V*V vertex heights
  tiles: Uint8Array; // N*N tile types
}

export function generateWorld(seed: number): WorldData {
  const heights = new Float32Array(V * V);
  const tiles = new Uint8Array(N * N);
  const n1 = makeNoise(seed);
  const n2 = makeNoise(seed + 1);
  const n3 = makeNoise(seed + 2);
  const fbm = (x: number, z: number) => n1(x, z) * 0.6 + n1(x * 2.1, z * 2.1) * 0.28 + n1(x * 4.3, z * 4.3) * 0.12;

  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const x = -HALF + i * TILE;
      const z = -HALF + j * TILE;
      let h = fbm(x / 38, z / 38) * 5 + 2;
      for (const L of LAKES) {
        const d = Math.hypot(x - L.x, z - L.z) / L.r;
        if (d < 1.7) h = lerp(-3.4, h, smoothstep(0.5, 1.7, d));
      }
      // flat clearing for the farm in the middle
      const cd = Math.hypot(x, z);
      h = lerp(1.3 + n2(x / 9, z / 9) * 0.25, h, smoothstep(16, 32, cd));
      // mountains around the edge keep everybody inside
      const ed = Math.max(Math.abs(x), Math.abs(z));
      const m = smoothstep(72, 98, ed);
      h += m * m * 16 + m * Math.abs(n3(x / 11, z / 11)) * 6;
      heights[j * V + i] = h;
    }
  }

  for (let tz = 0; tz < N; tz++) {
    for (let tx = 0; tx < N; tx++) {
      const h = tileHeight(heights, tx, tz);
      const [cx, cz] = tileCenter(tx, tz);
      const cd = Math.hypot(cx, cz);
      let t: number = TILE_T.GRASS;
      if (h < 0.55) t = TILE_T.SAND;
      else if (cd > 9 && n3(tx * 0.35, tz * 0.35) > 0.32) t = TILE_T.ROUGH;
      else if (h > 9) t = TILE_T.ROUGH;
      tiles[tz * N + tx] = t;
    }
  }
  return { heights, tiles };
}

export const tileIndex = (tx: number, tz: number) => tz * N + tx;
export const inBounds = (tx: number, tz: number) => tx >= 0 && tz >= 0 && tx < N && tz < N;

export function tileAt(x: number, z: number): [number, number] {
  return [Math.floor((x + HALF) / TILE), Math.floor((z + HALF) / TILE)];
}

export function tileCenter(tx: number, tz: number): [number, number] {
  return [-HALF + (tx + 0.5) * TILE, -HALF + (tz + 0.5) * TILE];
}

export function tileHeight(heights: Float32Array, tx: number, tz: number): number {
  const i = tz * V + tx;
  return (heights[i] + heights[i + 1] + heights[i + V] + heights[i + V + 1]) / 4;
}

export function isWaterTile(heights: Float32Array, tx: number, tz: number): boolean {
  return tileHeight(heights, tx, tz) < 0;
}

/** Bilinear terrain height at a world position (matches the rendered mesh closely). */
export function heightAt(heights: Float32Array, x: number, z: number): number {
  const fx = Math.min(N - 0.0001, Math.max(0, (x + HALF) / TILE));
  const fz = Math.min(N - 0.0001, Math.max(0, (z + HALF) / TILE));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const k = j * V + i;
  const a = heights[k] + (heights[k + 1] - heights[k]) * u;
  const b = heights[k + V] + (heights[k + V + 1] - heights[k + V]) * u;
  return a + (b - a) * v;
}

/** Height of whatever surface a walker stands on: ground or water surface. */
export function surfaceAt(heights: Float32Array, x: number, z: number): number {
  return Math.max(heightAt(heights, x, z), -0.35);
}

/** Corner vertex indices of a tile. */
export function tileCorners(tx: number, tz: number): number[] {
  const i = tz * V + tx;
  return [i, i + 1, i + V, i + V + 1];
}

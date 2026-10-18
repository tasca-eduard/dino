// Building models. Model space: Y up, base at y = 0, centred on the footprint, door/front on +Z.
// Fences and walls span 2 units along local X so neighbours on the 2-unit grid connect.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BuildingType } from '../../shared/constants';
import { G, Joint, Kit, Parts, damaged, ghostMat, hash01, lerp, mat, membrane, once, type MergedPart, type SlotMats, type V3 } from './materials';

type Grp = THREE.Group;
const PI = Math.PI;

const CONE12 = new THREE.ConeGeometry(1, 1, 12);
const CYL14 = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
const BAND = new THREE.TorusGeometry(1, 0.035, 4, 24);

const PAL: Record<string, string> = {
  wood: '#8b5a2b',
  woodLight: '#a8743f',
  woodDark: '#5e3b1c',
  wattle: '#b08850',
  stone: '#9aa0a6',
  stoneDark: '#737a80',
  stoneLight: '#b8bdc1',
  moss: '#6b8e3a',
  thatch: '#d9b45a',
  thatchDark: '#b8913c',
  straw: '#e6c86e',
  hay: '#e3c15a',
  hayDark: '#b9952f',
  bone: '#efe6cf',
  dark: '#1f150d',
  rope: '#c9a66b',
  red: '#a8432e',
  roof: '#6e3426',
  trim: '#efe3c8',
  metal: '#5b5f63',
  cloth: '#d9483b',
  stakeTip: '#e2c48f',
};
const BASE_MATS: SlotMats = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, mat(v)]));
BASE_MATS.water = mat('#3fa7d6', { rough: 0.15, emissive: '#0d4a6e', ei: 0.4 });
BASE_MATS.orb = mat('#6dffc8', { emissive: '#3dffb0', ei: 1.8, rough: 0.3 });

const rnd = (i: number, salt: number) => hash01(i, salt);
const pick = (i: number, salt: number, slots: string[]) => slots[Math.floor(rnd(i, salt) * slots.length) % slots.length];

// ---------------------------------------------------------------- static kits
const FENCE = once(() => {
  const k = new Kit();
  for (const x of [-0.92, 0.92]) {
    k.add(G.cyl, 'wood', [x, 0.62, 0], [0.11, 1.24, 0.11])
      .add(G.cone, 'woodLight', [x, 1.33, 0], [0.11, 0.18, 0.11])
      .add(BAND, 'rope', [x, 0.5, 0], [0.13, 0.13, 1.2], [PI / 2, 0, 0])
      .add(BAND, 'rope', [x, 1.0, 0], [0.13, 0.13, 1.2], [PI / 2, 0, 0]);
  }
  k.add(G.box, 'woodLight', [0, 0.5, 0.02], [2.0, 0.13, 0.08], [0, 0, 0.02]).add(G.box, 'woodLight', [0, 1.0, 0.02], [2.0, 0.12, 0.08], [0, 0, -0.025]);
  return k.build();
});

const WALL = once(() => {
  const k = new Kit().add(G.box, 'stoneDark', [0, 0.08, 0], [2.0, 0.16, 1.0]);
  const rows = [
    [0.7, 0.6, 0.7],
    [0.5, 0.5, 0.5, 0.5],
    [0.6, 0.8, 0.6],
  ];
  let n = 0;
  rows.forEach((row, r) => {
    let x = -1;
    for (const w of row) {
      n++;
      const d = 0.86 - rnd(n, 1) * 0.08;
      const h = 0.56 - rnd(n, 2) * 0.05;
      k.add(G.box, pick(n, 3, ['stone', 'stone', 'stoneDark', 'stoneLight']), [x + w / 2, 0.16 + r * 0.56 + h / 2, (rnd(n, 4) - 0.5) * 0.05], [w - 0.05, h, d], [0, (rnd(n, 5) - 0.5) * 0.06, (rnd(n, 6) - 0.5) * 0.04]);
      if (r === 2 && rnd(n, 7) > 0.4) k.add(G.sphere, 'moss', [x + w * 0.4, 1.86, 0.2], [0.18, 0.04, 0.14]);
      x += w;
    }
  });
  for (const x of [-0.72, 0, 0.72]) {
    n++;
    k.add(G.box, pick(n, 3, ['stone', 'stoneLight']), [x, 2.0, 0], [0.46, 0.4, 0.8], [0, (rnd(n, 5) - 0.5) * 0.08, 0]);
  }
  return k.build();
});

const HOUSE = once(() => {
  const k = new Kit().add(CYL14, 'wattle', [0, 1.05, 0], [1.95, 2.1, 1.95]).add(G.disc, 'woodDark', [0, 0.02, 0], 1.95);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * PI * 2;
    k.add(G.dodeca, pick(i, 1, ['stone', 'stoneDark', 'stoneLight']), [Math.sin(a) * 2.08, 0.1, Math.cos(a) * 2.08], 0.2 + rnd(i, 2) * 0.1);
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.32) continue; // doorway on +Z
    const h = 2.1 + rnd(i, 3) * 0.2;
    k.add(G.cyl, i % 2 ? 'wood' : 'woodLight', [Math.sin(a) * 2.0, h / 2, Math.cos(a) * 2.0], [0.13, h, 0.13], [0, a, 0]);
  }
  for (const y of [0.55, 1.75]) k.add(BAND, 'rope', [0, y, 0], [2.08, 2.08, 3], [PI / 2, 0, 0]);
  // tiered thatch roof
  k.add(CONE12, 'thatch', [0, 3.2, 0], [2.55, 2.4, 2.55])
    .add(CONE12, 'thatchDark', [0, 3.6, 0], [1.9, 1.7, 1.9], [0, 0.13, 0])
    .add(CONE12, 'thatch', [0, 4.18, 0], [1.05, 0.9, 1.05])
    .add(G.cyl, 'rope', [0, 4.55, 0], [0.16, 0.24, 0.16]);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * PI * 2 + 0.1;
    k.add(G.cone, 'thatchDark', [Math.sin(a) * 2.45, 1.92, Math.cos(a) * 2.45], [0.12, 0.3, 0.12], [PI, 0, 0]);
  }
  // doorway
  k.add(G.box, 'dark', [0, 0.85, 1.9], [0.95, 1.7, 0.32])
    .add(G.cyl, 'woodDark', [-0.56, 0.92, 2.04], [0.12, 1.84, 0.12])
    .add(G.cyl, 'woodDark', [0.56, 0.92, 2.04], [0.12, 1.84, 0.12])
    .add(G.box, 'woodDark', [0, 1.86, 2.06], [1.4, 0.17, 0.18])
    .add(G.box, 'woodLight', [0, 0.04, 2.25], [1.0, 0.08, 0.5]);
  // crossed bones on the lintel
  for (const s of [-1, 1]) {
    const a: V3 = [-0.42 * s, 1.72, 2.18];
    const b: V3 = [0.42 * s, 2.02, 2.18];
    k.between(G.cyl, 'bone', a, b, 0.045).add(G.sphere, 'bone', a, 0.07).add(G.sphere, 'bone', b, 0.07);
  }
  // horned skull finial on the peak
  k.add(G.sphere, 'bone', [0, 4.8, 0.05], [0.24, 0.2, 0.22])
    .add(G.sphere, 'bone', [0, 4.72, 0.24], [0.13, 0.11, 0.13])
    .add(G.sphere, 'dark', [0.09, 4.83, 0.22], 0.05)
    .add(G.sphere, 'dark', [-0.09, 4.83, 0.22], 0.05);
  for (const s of [-1, 1]) k.addDir(G.cone, 'bone', [s * 0.27, 4.95, 0.02], [s, 0.9, 0.15], [0.06, 0.3, 0.06]);
  return k.build();
});

const COOP = once(() => {
  const k = new Kit();
  for (const [x, z] of [
    [0.75, 0.55],
    [-0.75, 0.55],
    [0.75, -0.55],
    [-0.75, -0.55],
  ]) {
    k.add(G.cyl, 'woodDark', [x, 0.32, z], [0.08, 0.64, 0.08]);
  }
  k.add(G.box, 'wood', [0, 0.65, 0], [1.8, 0.1, 1.4])
    .add(G.box, 'woodLight', [0, 1.25, 0], [1.7, 1.2, 1.3])
    .add(G.box, 'woodLight', [0, 2.0, -0.4], [1.7, 0.35, 0.5])
    .add(G.box, 'thatch', [0, 2.1, 0], [2.1, 0.12, 1.9], [0.25, 0, 0])
    .add(G.box, 'thatchDark', [0, 2.12, 0.02], [2.15, 0.06, 1.95], [0.25, 0, 0])
    .add(G.box, 'dark', [0, 1.1, 0.655], [0.45, 0.52, 0.04])
    .add(G.box, 'woodDark', [0, 0.82, 0.69], [0.6, 0.06, 0.06])
    .add(G.cyl, 'woodDark', [0, 1.45, 0.72], [0.025, 0.7, 0.025], [0, 0, PI / 2]);
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    for (const z of [-0.66, 0.66]) if (!(z > 0 && Math.abs(x) < 0.3)) k.add(G.box, 'wood', [x, 1.25, z], [0.04, 1.2, 0.02]);
  }
  for (const [x, z] of [
    [0.86, 0.66],
    [-0.86, 0.66],
    [0.86, -0.66],
    [-0.86, -0.66],
  ]) {
    k.add(G.box, 'woodDark', [x, 1.3, z], [0.09, 1.3, 0.09]);
  }
  // ramp with cleats
  k.between(G.box, 'wood', [0, 0.72, 0.72], [0, 0.03, 1.5], [0.42, 0.05]);
  for (let i = 1; i < 4; i++) {
    const u = i / 4;
    k.add(G.box, 'woodDark', [0, lerp(0.72, 0.03, u) + 0.04, lerp(0.72, 1.5, u)], [0.42, 0.03, 0.04]);
  }
  // straw and an egg
  k.add(G.ico, 'straw', [0.3, 0.04, 0.2], [0.35, 0.06, 0.28])
    .add(G.ico, 'straw', [-0.4, 0.04, -0.25], [0.3, 0.05, 0.3])
    .add(G.ico, 'straw', [0, 0.73, 0.55], [0.3, 0.04, 0.1])
    .add(G.ico, 'straw', [0.85, 2.0, 0.6], [0.15, 0.05, 0.25])
    .add(G.sphere, 'bone', [0.52, 0.09, 1.0], [0.07, 0.09, 0.07]);
  return k.build();
});

const BARN = once(() => {
  const k = new Kit()
    .add(G.box, 'red', [0, 1.1, 0], [3.4, 2.2, 3.4])
    .add(G.prism, 'red', [0, 2.2 + 0.5 * 0.933, 0], [1.96, 0.933, 3.4])
    .add(G.box, 'stoneDark', [0, 0.1, 0], [3.5, 0.2, 3.5]);
  for (const s of [-1, 1]) {
    k.add(G.box, 'roof', [s * 0.925, 2.92, 0], [2.55, 0.14, 3.8], [0, 0, -s * 0.719]);
    for (const z of [-1.72, 1.72]) k.add(G.box, 'woodDark', [s * 1.72, 1.1, z], [0.14, 2.2, 0.14]);
    for (let i = 0; i < 5; i++) k.add(G.box, 'woodDark', [s * 1.71, 1.1, -1.2 + i * 0.6], [0.02, 2.2, 0.05]);
  }
  k.add(G.cyl, 'woodDark', [0, 3.72, 0], [0.1, 3.9, 0.1], [PI / 2, 0, 0]);
  // big front door with white X braces
  k.add(G.box, 'woodDark', [0, 0.95, 1.71], [1.7, 1.9, 0.05]).add(G.box, 'trim', [0, 1.92, 1.74], [1.86, 0.12, 0.05]);
  for (const s of [-1, 1]) {
    k.add(G.box, 'trim', [s * 0.88, 0.95, 1.74], [0.12, 1.9, 0.05]).add(G.box, 'trim', [0, 0.95, 1.745], [2.4, 0.11, 0.04], [0, 0, s * 0.84]);
  }
  // loft window with hay
  k.add(G.box, 'dark', [0, 2.75, 1.71], [0.62, 0.5, 0.05]).add(G.box, 'trim', [0, 2.75, 1.715], [0.74, 0.62, 0.03]).add(G.box, 'hay', [0, 2.6, 1.82], [0.5, 0.2, 0.25]);
  // hay bales
  for (const [p, r] of [
    [[1.95, 0.3, 0.6], 0.08],
    [[1.95, 0.3, -0.45], -0.06],
    [[1.95, 0.88, 0.05], 0.02],
  ] as [V3, number][]) {
    k.add(G.box, 'hay', p, [0.5, 0.58, 0.9], [0, r, 0]);
    for (const dz of [-0.22, 0.22]) k.add(G.box, 'hayDark', [p[0], p[1], p[2] + dz], [0.52, 0.6, 0.04], [0, r, 0]);
  }
  k.add(G.ico, 'hay', [-1.25, 0.1, 1.95], [0.5, 0.18, 0.35]);
  return k.build();
});

const WELL = once(() => {
  const k = new Kit().add(G.disc, 'water', [0, 0.55, 0], 0.72);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    k.add(G.box, pick(i, 1, ['stone', 'stoneDark', 'stone']), [Math.sin(a) * 0.85, 0.35, Math.cos(a) * 0.85], [0.56, 0.7, 0.3], [0, a, 0]);
    const b = a + PI / 10;
    k.add(G.box, pick(i, 2, ['stoneLight', 'stone']), [Math.sin(b) * 0.85, 0.76, Math.cos(b) * 0.85], [0.5, 0.14, 0.34], [0, b, 0]);
  }
  for (const s of [-1, 1]) {
    k.add(G.cyl, 'wood', [s * 0.85, 1.4, 0], [0.08, 1.4, 0.08]).add(G.box, 'roof', [s * 0.5, 2.25, 0], [1.25, 0.08, 1.2], [0, 0, -s * 0.54]);
  }
  k.add(G.cyl, 'woodDark', [0, 1.75, 0], [0.06, 1.85, 0.06], [0, 0, PI / 2])
    .add(G.cyl, 'rope', [0, 1.75, 0], [0.1, 0.45, 0.1], [0, 0, PI / 2])
    .add(G.box, 'woodDark', [1.0, 1.64, 0], [0.05, 0.26, 0.05])
    .add(G.cyl, 'woodDark', [1.0, 1.52, 0.08], [0.03, 0.16, 0.03], [PI / 2, 0, 0])
    .add(G.cyl, 'woodDark', [0, 2.58, 0], [0.05, 1.3, 0.05], [PI / 2, 0, 0]);
  return k.build();
});
const WELL_PIVOT: V3 = [0, 1.7, 0];
const BUCKET = once(() =>
  new Kit()
    .between(G.cyl, 'rope', WELL_PIVOT, [0, 1.13, 0], 0.015)
    .add(G.cylTaper, 'woodDark', [0, 1.0, 0], [0.15, 0.25, 0.15], [PI, 0, 0])
    .add(BAND, 'metal', [0, 1.06, 0], [0.135, 0.135, 1], [PI / 2, 0, 0])
    .add(G.disc, 'water', [0, 1.1, 0], 0.11)
    .build(),
);

const SPIKES = once(() => {
  const k = new Kit().add(G.box, 'woodDark', [0, 0.06, 0], [1.6, 0.12, 1.6]);
  for (const z of [-0.45, 0.45]) k.add(G.cyl, 'wood', [0, 0.15, z], [0.08, 1.65, 0.08], [0, 0, PI / 2]);
  const stake = (a: number, r: number, lean: number, h: number, i: number) => {
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const base: V3 = [dx * r, 0.1, dz * r];
    const top: V3 = [dx * (r + lean), 0.1 + h, dz * (r + lean)];
    const dir: V3 = [top[0] - base[0], top[1] - base[1], top[2] - base[2]];
    const l = Math.hypot(...dir);
    k.between(G.cyl, i % 2 ? 'wood' : 'woodLight', base, top, 0.055);
    k.addDir(G.cone, 'stakeTip', [top[0] + (dir[0] / l) * 0.08, top[1] + (dir[1] / l) * 0.08, top[2] + (dir[2] / l) * 0.08], dir, [0.055, 0.17, 0.055]);
  };
  for (let i = 0; i < 8; i++) stake((i / 8) * PI * 2 + 0.2, 0.55, 0.16, 0.3, i);
  for (let i = 0; i < 4; i++) stake((i / 4) * PI * 2 + 0.9, 0.24, 0.06, 0.36, i + 1);
  stake(0, 0, 0, 0.42, 0);
  return k.build();
});

const TOWER_LEG = (sx: number, sz: number, y: number): V3 => {
  const f = lerp(1.0, 0.85, y / 4.6);
  return [sx * f, y, sz * f];
};
const TOWER = once(() => {
  const k = new Kit();
  const corners: [number, number][] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (const [sx, sz] of corners) k.between(G.cyl, 'wood', TOWER_LEG(sx, sz, 0), TOWER_LEG(sx, sz, 4.6), 0.12);
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    for (const [y0, y1] of [
      [0.35, 2.3],
      [2.4, 4.4],
    ]) {
      k.between(G.box, 'woodLight', TOWER_LEG(ax, az, y0), TOWER_LEG(bx, bz, y1), 0.07);
      k.between(G.box, 'woodLight', TOWER_LEG(bx, bz, y0), TOWER_LEG(ax, az, y1), 0.07);
    }
    k.between(G.box, 'woodDark', TOWER_LEG(ax, az, 2.35), TOWER_LEG(bx, bz, 2.35), 0.09);
  }
  k.add(G.box, 'woodLight', [0, 4.65, 0], [2.5, 0.16, 2.5]).add(G.box, 'woodDark', [0, 4.53, 0], [2.3, 0.1, 2.3]);
  for (const [sx, sz] of [...corners, [1, 0], [-1, 0], [0, -1]] as [number, number][]) {
    k.add(G.cyl, 'wood', [sx * 1.15, 5.03, sz * 1.15], [0.05, 0.6, 0.05]);
  }
  for (const s of [-1, 1]) {
    k.add(G.box, 'woodLight', [s * 1.15, 5.28, 0], [0.08, 0.08, 2.38]).add(G.box, 'woodLight', [0, 5.28, -1.15], [2.38, 0.08, 0.08]);
    k.add(G.box, 'woodLight', [s * 0.8, 5.28, 1.15], [0.75, 0.08, 0.08]);
    k.between(G.cyl, 'woodDark', [s * 0.27, 0, 1.3], [s * 0.27, 4.6, 0.98], 0.045);
  }
  for (let y = 0.4; y < 4.6; y += 0.42) k.add(G.box, 'woodLight', [0, y, lerp(1.3, 0.98, y / 4.6)], [0.58, 0.05, 0.06]);
  for (let i = 0; i < 4; i++) {
    const [sx, sz] = corners[i];
    k.add(G.dodeca, 'stone', [sx * 1.02, 0.12, sz * 1.02], 0.26);
  }
  k.between(G.cyl, 'woodDark', [-1.1, 4.7, -1.1], [-1.1, 6.25, -1.1], 0.04);
  return k.build();
});
const BALLISTA_AT: V3 = [0, 4.73, 0];
const BALLISTA = once(() => {
  const k = new Kit()
    .add(G.cyl, 'woodDark', [0, 4.95, 0], [0.12, 0.45, 0.12])
    .add(G.box, 'metal', [0, 5.2, 0], [0.3, 0.15, 0.3])
    .add(G.box, 'wood', [0, 5.32, 0.1], [0.16, 0.12, 1.5])
    .add(G.cyl, 'woodLight', [0, 5.42, 0.3], [0.03, 1.2, 0.03], [PI / 2, 0, 0])
    .add(G.cone4, 'metal', [0, 5.42, 0.95], [0.055, 0.15, 0.055], [PI / 2, 0, 0])
    .add(G.cyl, 'woodDark', [0, 5.32, -0.62], [0.09, 0.3, 0.09], [0, 0, PI / 2]);
  for (const s of [-1, 1]) {
    k.between(G.cyl, 'woodDark', [s * 0.08, 5.35, 0.65], [s * 0.85, 5.35, 0.38], 0.05)
      .between(G.cyl, 'woodDark', [s * 0.85, 5.35, 0.38], [s * 0.97, 5.35, 0.16], 0.04)
      .between(G.cyl, 'rope', [s * 0.97, 5.35, 0.16], [0, 5.36, -0.35], 0.012)
      .add(G.cyl, 'rope', [s * 0.12, 5.35, 0.6], [0.07, 0.26, 0.07]);
  }
  return k.build();
});
const FLAG_AT: V3 = [-1.1, 6.05, -1.1];
const FLAG = once(() =>
  new Kit()
    .add(membrane([FLAG_AT, [FLAG_AT[0] + 0.75, FLAG_AT[1] - 0.12, FLAG_AT[2]], [FLAG_AT[0], FLAG_AT[1] - 0.36, FLAG_AT[2]]], [[0, 1, 2]]), 'cloth')
    .build(),
);

const LANTERN = once(() => {
  const k = new Kit()
    .between(G.cyl, 'wood', [0, 0, 0], [0, 2.32, 0], 0.07)
    .between(G.box, 'woodDark', [-0.05, 2.22, 0], [0.55, 2.26, 0], [0.07, 0.07])
    .between(G.cyl, 'woodDark', [0, 1.85, 0], [0.32, 2.21, 0], 0.035)
    .add(G.cone, 'woodDark', [0, 2.38, 0], [0.09, 0.12, 0.09]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    k.add(G.dodeca, pick(i, 9, ['stone', 'stoneDark']), [Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2], 0.13);
  }
  return k.build();
});
const ORB_PIVOT: V3 = [0.48, 2.22, 0];
const ORB_AT: V3 = [0.48, 1.8, 0];
const ORB = once(() =>
  new Kit()
    .between(G.cyl, 'rope', ORB_PIVOT, [0.48, 1.98, 0], 0.012)
    .add(G.cone, 'woodDark', [0.48, 1.99, 0], [0.12, 0.09, 0.12])
    .add(G.ball, 'orb', ORB_AT, 0.15)
    .add(BAND, 'woodDark', ORB_AT, [0.19, 0.19, 1])
    .add(BAND, 'woodDark', ORB_AT, [0.19, 0.19, 1], [0, PI / 2, 0])
    .build(),
);

const STATIC: Record<BuildingType, () => MergedPart[]> = {
  fence: FENCE,
  wall: WALL,
  house: HOUSE,
  coop: COOP,
  barn: BARN,
  well: WELL,
  spikes: SPIKES,
  tower: TOWER,
  lantern: LANTERN,
};

// ---------------------------------------------------------------- animated bits
function Bucket({ mats, shadow }: { mats: SlotMats; shadow: boolean }) {
  const g = useRef<Grp>(null!);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime + seed;
    g.current.rotation.z = Math.sin(t * 1.3) * 0.06;
    g.current.rotation.x = Math.sin(t * 0.9) * 0.04;
  });
  return (
    <Joint at={WELL_PIVOT} gref={g}>
      <Parts parts={BUCKET()} mats={mats} shadow={shadow} />
    </Joint>
  );
}

function Ballista({ mats, shadow }: { mats: SlotMats; shadow: boolean }) {
  const g = useRef<Grp>(null!);
  const flag = useRef<Grp>(null!);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime + seed;
    g.current.rotation.y = Math.sin(t * 0.33) * 1.5 + Math.sin(t * 0.9) * 0.15;
    flag.current.rotation.y = Math.sin(t * 3.1) * 0.3 + 0.2;
  });
  return (
    <>
      <Joint at={BALLISTA_AT} gref={g}>
        <Parts parts={BALLISTA()} mats={mats} shadow={shadow} />
      </Joint>
      <Joint at={FLAG_AT} gref={flag}>
        <Parts parts={FLAG()} mats={mats} shadow={shadow} />
      </Joint>
    </>
  );
}

function Orb({ mats, ghost }: { mats: SlotMats; ghost: boolean }) {
  const g = useRef<Grp>(null!);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime + seed;
    g.current.rotation.z = Math.sin(t * 1.1) * 0.07;
    g.current.rotation.x = Math.sin(t * 0.8) * 0.05;
  });
  return (
    <Joint at={ORB_PIVOT} gref={g}>
      <Parts parts={ORB()} mats={mats} shadow={!ghost} />
      {!ghost && <pointLight position={ORB_AT} color="#8fffd0" intensity={6} distance={10} decay={2} castShadow={false} />}
    </Joint>
  );
}

// ---------------------------------------------------------------- public
export function BuildingModel(props: { type: BuildingType; ghost?: boolean; valid?: boolean; hpFrac?: number }) {
  const { type, ghost = false, valid = true, hpFrac = 1 } = props;
  const hurt = !ghost && hpFrac < 0.5;
  const mats = useMemo<SlotMats>(() => {
    if (ghost) {
      const g = ghostMat(valid);
      return new Proxy({}, { get: () => g }) as SlotMats;
    }
    if (!hurt) return BASE_MATS;
    const d: SlotMats = {};
    for (const [k, m] of Object.entries(BASE_MATS)) d[k] = k === 'orb' ? m : damaged(m);
    return d;
  }, [ghost, valid, hurt]);
  const shadow = !ghost;
  const tilt = useMemo(() => (hurt ? ([(Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.1] as V3) : ([0, 0, 0] as V3)), [hurt]);
  return (
    <group rotation={tilt}>
      <Parts parts={STATIC[type]()} mats={mats} shadow={shadow} receive={shadow} />
      {type === 'well' && <Bucket mats={mats} shadow={shadow} />}
      {type === 'tower' && <Ballista mats={mats} shadow={shadow} />}
      {type === 'lantern' && <Orb mats={mats} ghost={ghost} />}
    </group>
  );
}

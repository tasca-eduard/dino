// Instanced trees / rocks (resource nodes) and rough-tile clutter.
import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { NodeView } from '../../shared/protocol';
import { G, Kit, hash01, mat, once, type V3 } from './materials';

const PI = Math.PI;
const WHITE = mat('#ffffff');

// ---------------------------------------------------------------- geometries (base at y = 0)
const TRUNK = new THREE.CylinderGeometry(0.75, 1, 1, 7).translate(0, 0.5, 0);
const CONE = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
const ROCK_A = new THREE.DodecahedronGeometry(1, 0);
const ROCK_B = new THREE.IcosahedronGeometry(1, 0);

/** a fern/cycad frond of length 1 along +Z, base at the origin, arching then drooping */
const FROND = once(() => {
  const k = new Kit();
  const N = 8;
  const pt = (u: number): V3 => [0, 0.28 * u - 0.6 * u * u, u];
  for (let i = 0; i < N; i++) {
    const u0 = i / N;
    const a = pt(u0);
    const b = pt((i + 1) / N);
    k.between(G.box, 'f', a, b, 0.035 * (1 - u0 * 0.6));
    const L = 0.3 * (1 - u0 * 0.65);
    for (const s of [-1, 1]) {
      const dir: V3 = [s, -0.3, 0.35];
      const dl = Math.hypot(...dir);
      k.addDir(G.sphere, 'f', [a[0] + (dir[0] / dl) * L * 0.5, a[1] + (dir[1] / dl) * L * 0.5, a[2] + (dir[2] / dl) * L * 0.5], dir, [0.05, L * 0.55, 0.02]);
    }
  }
  return k.build()[0].geo;
});

const TUFT = once(() => {
  const k = new Kit();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * PI * 2 + (i % 2) * 0.3;
    const lean = 0.35 + (i % 3) * 0.15;
    const h = 0.28 + (i % 3) * 0.08;
    k.addDir(G.cone4, 'w', [Math.cos(a) * 0.06, h / 2, Math.sin(a) * 0.06], [Math.cos(a) * lean, 1, Math.sin(a) * lean], [0.035, h, 0.02]);
  }
  return k.build()[0].geo;
});

// ---------------------------------------------------------------- instancing helpers
type PartName = 'trunk' | 'cone' | 'frond' | 'rockA' | 'rockB';
const PARTS: PartName[] = ['trunk', 'cone', 'frond', 'rockA', 'rockB'];
const GEO: Record<PartName, () => THREE.BufferGeometry> = {
  trunk: () => TRUNK,
  cone: () => CONE,
  frond: FROND,
  rockA: () => ROCK_A,
  rockB: () => ROCK_B,
};

const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _out = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _c = new THREE.Color();
const _c2 = new THREE.Color();

type Emit = (part: PartName, p: V3, rot: V3, scale: V3 | number, color: string, colorJitter?: number) => void;

const BARK = ['#6e4a2e', '#8a6a3a', '#7a5a3e'];
const NEEDLES = ['#2f5d3a', '#36663f', '#294f33'];
const CYCAD = ['#4f8f3a', '#5c9a40'];
const FERN = ['#4f8a3a', '#62a046'];
const ROCKS = ['#8d9196', '#7c8186', '#9ea2a6', '#848b7a'];

function layoutTree(v: number, id: number, depleted: boolean, emit: Emit) {
  const h = (k: number) => hash01(id, k);
  if (depleted) {
    const r = v === 1 ? 0.55 : v === 2 ? 0.32 : 0.4;
    emit('trunk', [0, -0.05, 0], [0, 0, 0], [r, 0.6, r], BARK[v], 0.1);
    return;
  }
  if (v === 0) {
    // araucaria / monkey-puzzle: tall trunk, tiers of dark cones
    emit('trunk', [0, 0, 0], [0, 0, 0], [0.35, 5.6, 0.35], BARK[0], 0.1);
    const tiers: [number, number, number][] = [
      [2.1, 1.7, 1.6],
      [2.95, 1.45, 1.5],
      [3.75, 1.15, 1.35],
      [4.55, 0.82, 1.2],
      [5.25, 0.48, 1.05],
    ];
    tiers.forEach(([y, r, hh], i) => emit('cone', [0, y, 0], [(h(i) - 0.5) * 0.08, h(i + 9) * PI, 0], [r, hh, r], NEEDLES[i % 3], 0.08));
  } else if (v === 1) {
    // cycad: thick short scaly trunk, crown of long radiating leaves, central cone
    const th = 2.2;
    emit('trunk', [0, 0, 0], [0, 0, 0], [0.5, th, 0.5], BARK[1], 0.08);
    for (const y of [0.55, 1.2, 1.8]) emit('trunk', [0, y, 0], [0, h(Math.round(y * 10)) * PI, 0], [0.55, 0.22, 0.55], '#6f5430', 0.08);
    for (let i = 0; i < 12; i++) emit('frond', [0, th, 0], [-0.55 + h(i) * 0.2, (i / 12) * PI * 2 + h(20) * 0.5, 0], 2.0 + h(i + 30) * 0.4, CYCAD[i % 2], 0.1);
    for (let i = 0; i < 6; i++) emit('frond', [0, th + 0.05, 0], [-1.0, (i / 6) * PI * 2 + 0.3, 0], 1.4, CYCAD[(i + 1) % 2], 0.1);
    emit('cone', [0, th - 0.1, 0], [0, 0, 0], [0.3, 0.65, 0.3], '#c07a2a', 0.1);
  } else {
    // tree fern: thin fibrous trunk, drooping fronds
    const th = 4.6;
    emit('trunk', [0, 0, 0], [(h(1) - 0.5) * 0.1, 0, (h(2) - 0.5) * 0.1], [0.28, th, 0.28], BARK[2], 0.1);
    emit('trunk', [0, th - 0.3, 0], [0, 0, 0], [0.36, 0.4, 0.36], '#5a4030', 0.05);
    for (let i = 0; i < 10; i++) emit('frond', [0, th, 0], [-0.3 + h(i) * 0.2, (i / 10) * PI * 2 + h(21), 0], 2.4 + h(i + 40) * 0.4, FERN[i % 2], 0.1);
    for (let i = 0; i < 5; i++) emit('frond', [0, th + 0.05, 0], [-0.95, (i / 5) * PI * 2 + 0.6, 0], 1.5, FERN[1], 0.1);
  }
}

function layoutRock(v: number, id: number, emit: Emit) {
  const h = (k: number) => hash01(id, k + 50);
  const col = (k: number) => ROCKS[Math.floor(h(k) * ROCKS.length) % ROCKS.length];
  const r = (k: number): V3 => [h(k) * PI, h(k + 1) * PI, h(k + 2) * PI];
  if (v === 0) {
    emit('rockA', [0, 0.42, 0], r(0), [1.0, 0.75, 0.9], col(1), 0.06);
    emit('rockB', [0.85, 0.18, 0.3], r(3), 0.45, col(4), 0.06);
  } else if (v === 1) {
    emit('rockB', [-0.3, 0.38, 0], r(0), 0.72, col(1), 0.06);
    emit('rockB', [0.5, 0.28, 0.32], r(3), 0.5, col(4), 0.06);
    emit('rockA', [0.1, 0.22, -0.55], r(6), 0.45, col(7), 0.06);
  } else {
    emit('rockA', [0, 0.28, 0], [0, h(0) * PI, 0], [1.3, 0.45, 1.0], col(1), 0.06);
    emit('rockB', [0.9, 0.14, -0.4], r(3), 0.32, col(4), 0.06);
    emit('rockA', [-0.8, 0.17, 0.5], r(6), 0.36, col(7), 0.06);
  }
}

function layoutAll(nodes: NodeView[], heightAt: (x: number, z: number) => number, emitWorld: (part: PartName, m: THREE.Matrix4, c: THREE.Color) => void) {
  for (const n of nodes) {
    const depleted = n.amount <= 0;
    if (n.kind === 'rock' && depleted) continue;
    const yaw = hash01(n.id, 7) * PI * 2;
    const y = heightAt(n.x, n.z);
    _base.compose(_p.set(n.x, y, n.z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), _s.set(n.s, n.s, n.s));
    let k = 0;
    const emit: Emit = (part, p, rot, scale, color, jitter = 0) => {
      _e.set(rot[0], rot[1], rot[2], 'YXZ');
      _q.setFromEuler(_e);
      if (typeof scale === 'number') _s.set(scale, scale, scale);
      else _s.set(scale[0], scale[1], scale[2]);
      _local.compose(_p.set(p[0], p[1], p[2]), _q, _s);
      _out.multiplyMatrices(_base, _local);
      _c.set(color);
      if (jitter) {
        const j = (hash01(n.id, 100 + k++) - 0.5) * 2 * jitter;
        _c.offsetHSL(0, 0, j);
      }
      emitWorld(part, _out, _c);
    };
    if (n.kind === 'tree') layoutTree(((n.v % 3) + 3) % 3, n.id, depleted, emit);
    else layoutRock(((n.v % 3) + 3) % 3, n.id, emit);
  }
}

function makeInstanced(geo: THREE.BufferGeometry, cap: number, receive: boolean): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, WHITE, cap);
  m.castShadow = true;
  m.receiveShadow = receive;
  m.count = 0;
  m.setColorAt(0, _c2.set('#ffffff'));
  return m;
}

const roundCap = (n: number) => Math.max(64, Math.ceil(n / 256) * 256);

// ---------------------------------------------------------------- NatureInstances
export function NatureInstances(props: { nodes: NodeView[]; heightAt: (x: number, z: number) => number }) {
  const { nodes, heightAt } = props;

  // capacity per part (rounded up so small changes don't recreate meshes)
  const capKey = useMemo(() => {
    const counts: Record<PartName, number> = { trunk: 0, cone: 0, frond: 0, rockA: 0, rockB: 0 };
    layoutAll(nodes, () => 0, (part) => counts[part]++);
    return PARTS.map((p) => roundCap(counts[p])).join(',');
  }, [nodes]);

  const meshes = useMemo(() => {
    const caps = capKey.split(',').map(Number);
    const out = {} as Record<PartName, THREE.InstancedMesh>;
    PARTS.forEach((p, i) => (out[p] = makeInstanced(GEO[p](), caps[i], p === 'rockA' || p === 'rockB' || p === 'trunk')));
    return out;
  }, [capKey]);

  useEffect(
    () => () => {
      for (const p of PARTS) meshes[p].dispose();
    },
    [meshes],
  );

  useLayoutEffect(() => {
    const idx: Record<PartName, number> = { trunk: 0, cone: 0, frond: 0, rockA: 0, rockB: 0 };
    layoutAll(nodes, heightAt, (part, m, c) => {
      const mesh = meshes[part];
      const i = idx[part]++;
      if (i >= mesh.instanceMatrix.count) return;
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    });
    for (const p of PARTS) {
      const mesh = meshes[p];
      mesh.count = Math.min(idx[p], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [nodes, heightAt, meshes]);

  return (
    <>
      {PARTS.map((p) => (
        <primitive key={p} object={meshes[p]} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- RoughProps
const ROUGH_CAP = 3000;
const PEBBLES = ['#8f9398', '#7a7f84', '#a3a6a9', '#8a826f'];
const WEEDS = ['#5f8f35', '#6f9c3a', '#7d9a3c', '#557f2f'];

export function RoughProps(props: { tiles: number[]; heightAt: (x: number, z: number) => number }) {
  const { tiles, heightAt } = props;
  const meshes = useMemo(() => {
    const pebA = makeInstanced(ROCK_A, ROUGH_CAP * 2, true);
    const pebB = makeInstanced(ROCK_B, ROUGH_CAP, true);
    const tuft = makeInstanced(TUFT(), ROUGH_CAP, false);
    tuft.castShadow = false;
    for (const m of [pebA, pebB]) m.castShadow = false;
    return { pebA, pebB, tuft };
  }, []);
  useEffect(
    () => () => {
      meshes.pebA.dispose();
      meshes.pebB.dispose();
      meshes.tuft.dispose();
    },
    [meshes],
  );

  useLayoutEffect(() => {
    const { pebA, pebB, tuft } = meshes;
    let na = 0;
    let nb = 0;
    let nt = 0;
    const n = Math.min(tiles.length, ROUGH_CAP);
    for (let t = 0; t < n; t++) {
      const idx = tiles[t];
      const tx = idx % 100;
      const tz = Math.floor(idx / 100);
      const cx = -100 + (tx + 0.5) * 2;
      const cz = -100 + (tz + 0.5) * 2;
      const h = (k: number) => hash01(idx, k);
      const pebbles = 2 + (h(0) > 0.5 ? 1 : 0);
      for (let i = 0; i < pebbles; i++) {
        const x = cx + (h(1 + i * 3) - 0.5) * 1.6;
        const z = cz + (h(2 + i * 3) - 0.5) * 1.6;
        const r = 0.08 + h(3 + i * 3) * 0.12;
        _e.set(h(10 + i) * PI, h(13 + i) * PI, h(16 + i) * PI, 'YXZ');
        _out.compose(_p.set(x, heightAt(x, z) + r * 0.25, z), _q.setFromEuler(_e), _s.set(r, r * (0.6 + h(19 + i) * 0.3), r * (0.8 + h(22 + i) * 0.3)));
        _c.set(PEBBLES[Math.floor(h(25 + i) * PEBBLES.length) % PEBBLES.length]);
        if (i === 2 && nb < pebB.instanceMatrix.count) {
          pebB.setMatrixAt(nb, _out);
          pebB.setColorAt(nb++, _c);
        } else if (na < pebA.instanceMatrix.count) {
          pebA.setMatrixAt(na, _out);
          pebA.setColorAt(na++, _c);
        }
      }
      const x = cx + (h(30) - 0.5) * 1.3;
      const z = cz + (h(31) - 0.5) * 1.3;
      const s = 0.7 + h(32) * 0.6;
      _out.compose(_p.set(x, heightAt(x, z) - 0.02, z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h(33) * PI * 2), _s.set(s, s * (0.8 + h(34) * 0.5), s));
      tuft.setMatrixAt(nt, _out);
      tuft.setColorAt(nt++, _c.set(WEEDS[Math.floor(h(35) * WEEDS.length) % WEEDS.length]));
    }
    for (const [m, c] of [
      [pebA, na],
      [pebB, nb],
      [tuft, nt],
    ] as [THREE.InstancedMesh, number][]) {
      m.count = c;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [tiles, heightAt, meshes]);

  return (
    <>
      <primitive object={meshes.pebA} />
      <primitive object={meshes.pebB} />
      <primitive object={meshes.tuft} />
    </>
  );
}

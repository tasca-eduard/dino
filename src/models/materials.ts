// Shared, module-level geometry / material caches and tiny rig helpers for the procedural
// low-poly models. Everything here is created once and shared by every instance: never
// dispose anything exported from this module.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createElement, Fragment, useEffect, useMemo, type FC, type ReactNode, type Ref } from 'react';

export type V3 = [number, number, number];

// ---------------------------------------------------------------- colours
const WHITE = new THREE.Color(1, 1, 1);
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const shadeCache = new Map<string, string>();

/** Lighten (k > 0, toward white) or darken (k < 0, toward black) a CSS colour. Cached. */
export function shade(color: string, k: number): string {
  const key = `${color}|${k}`;
  let s = shadeCache.get(key);
  if (s === undefined) {
    _c.set(color);
    if (k >= 0) _c.lerp(WHITE, k);
    else _c.multiplyScalar(1 + k);
    s = '#' + _c.getHexString();
    shadeCache.set(key, s);
  }
  return s;
}

/** Linear blend of two CSS colours. Cached. */
export function mix(a: string, b: string, t: number): string {
  const key = `${a}|${b}|${t}`;
  let s = shadeCache.get(key);
  if (s === undefined) {
    _c.set(a);
    _c2.set(b);
    _c.lerp(_c2, t);
    s = '#' + _c.getHexString();
    shadeCache.set(key, s);
  }
  return s;
}

// ---------------------------------------------------------------- materials
export interface MatOpts {
  emissive?: string;
  /** emissive intensity (default 1) */
  ei?: number;
  rough?: number;
  metal?: number;
  opacity?: number;
  side?: THREE.Side;
  /** flat shading (default true) */
  flat?: boolean;
}

const stdCache = new Map<string, THREE.MeshStandardMaterial>();

/** Cached faceted MeshStandardMaterial. Same arguments -> same material instance. */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.emissive ?? ''}|${o.ei ?? 1}|${o.rough ?? 0.8}|${o.metal ?? 0}|${o.opacity ?? 1}|${o.side ?? 0}|${o.flat ?? true}`;
  let m = stdCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.8,
      metalness: o.metal ?? 0,
      flatShading: o.flat ?? true,
      side: o.side ?? THREE.FrontSide,
    });
    if (o.emissive) {
      m.emissive.set(o.emissive);
      m.emissiveIntensity = o.ei ?? 1;
    }
    if (o.opacity !== undefined && o.opacity < 1) {
      m.transparent = true;
      m.opacity = o.opacity;
      m.depthWrite = false;
    }
    stdCache.set(key, m);
  }
  return m;
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>();

/** Cached unlit material (for glows, sparkles, UI-ish markers). */
export function glowMat(color: string, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}|${additive}`;
  let m = basicCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    if (opacity < 1 || additive) {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
    }
    if (additive) m.blending = THREE.AdditiveBlending;
    m.side = THREE.DoubleSide;
    basicCache.set(key, m);
  }
  return m;
}

const ghostCache = new Map<boolean, THREE.MeshStandardMaterial>();

/** The single shared transparent placement-preview material. */
export function ghostMat(valid: boolean): THREE.MeshStandardMaterial {
  let m = ghostCache.get(valid);
  if (!m) {
    const col = valid ? '#4caf50' : '#e53935';
    m = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      flatShading: true,
      roughness: 0.8,
    });
    ghostCache.set(valid, m);
  }
  return m;
}

const darkCache = new Map<THREE.Material, THREE.Material>();

/** A charred/darkened variant of a material (used for damaged buildings). Cached. */
export function damaged(m: THREE.Material): THREE.Material {
  let d = darkCache.get(m);
  if (!d) {
    d = m.clone();
    if (d instanceof THREE.MeshStandardMaterial || d instanceof THREE.MeshBasicMaterial) {
      d.color.multiplyScalar(0.55);
      d.color.lerp(_c.set('#3a2a20'), 0.15);
    }
    darkCache.set(m, d);
  }
  return d;
}

/** Common creature materials shared by every model. */
export const COMMON = {
  eye: mat('#ffffff', { rough: 0.4 }),
  pupil: mat('#141414', { rough: 0.3 }),
  claw: mat('#efe6cf', { rough: 0.6 }),
  tooth: mat('#fbf6e6', { rough: 0.5 }),
  mouth: mat('#8c2a35'),
  tongue: mat('#d0455f'),
} as const;

// ---------------------------------------------------------------- geometries
/** Unit primitives. Spheres are radius 1, boxes/cones/cylinders 1 unit tall, centred. */
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 9, 7),
  ball: new THREE.IcosahedronGeometry(1, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  /** upper hemisphere (y >= 0) */
  hemi: new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  cone: new THREE.ConeGeometry(1, 1, 6),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 7),
  cylTaper: new THREE.CylinderGeometry(0.7, 1, 1, 7),
  /** strongly tapered round frustum (top radius 0.5), for tails / necks */
  frustum: new THREE.CylinderGeometry(0.5, 1, 1, 8),
  /** square-section frustum, top (narrow) at +y */
  taper4: new THREE.CylinderGeometry(0.6, 1, 1, 4).rotateY(Math.PI / 4),
  /** triangular prism along Z, apex up (+1), base at y=-0.5 with half-width 0.866 */
  prism: new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2),
  torus: new THREE.TorusGeometry(1, 0.12, 5, 14),
  /** flat disc facing +Y */
  disc: new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
};

/** Build a two-sided flat polygon mesh from a list of points and triangles. */
export function membrane(points: V3[], tris: [number, number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const [a, b, c] of tris) {
    for (const i of [a, b, c]) pos.push(...points[i]);
    for (const i of [a, c, b]) pos.push(...points[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- Kit: merge static parts per slot
export interface MergedPart {
  slot: string;
  geo: THREE.BufferGeometry;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = a.array as Float32Array;
    for (let t = 0; t < arr.length; t += 9) {
      for (let k = 0; k < 3; k++) {
        const tmp = arr[t + 3 + k];
        arr[t + 3 + k] = arr[t + 6 + k];
        arr[t + 6 + k] = tmp;
      }
    }
  }
}

/**
 * Collects transformed primitives tagged with a material "slot" name and merges them into
 * one geometry per slot. Build once (module level), render with <Parts>, resolving slots
 * to materials per instance (so e.g. the accent colour can differ per player).
 */
export class Kit {
  private bySlot = new Map<string, THREE.BufferGeometry[]>();

  /** add a primitive at position p, scale s, Euler rotation r (XYZ) */
  add(geo: THREE.BufferGeometry, slot: string, p: V3 = [0, 0, 0], s: V3 | number = 1, r: V3 = [0, 0, 0]): this {
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    if (typeof s === 'number') _s.set(s, s, s);
    else _s.set(s[0], s[1], s[2]);
    _m.compose(_p.set(p[0], p[1], p[2]), _q, _s);
    return this.addMatrix(geo, slot, _m);
  }

  /** add a primitive whose local +Y axis points along `dir` (scale applied in local space first) */
  addDir(geo: THREE.BufferGeometry, slot: string, p: V3, dir: V3, s: V3 | number = 1, twist = 0): this {
    _d.set(dir[0], dir[1], dir[2]).normalize();
    _q.setFromUnitVectors(UP, _d);
    if (twist) _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, twist));
    if (typeof s === 'number') _s.set(s, s, s);
    else _s.set(s[0], s[1], s[2]);
    _m.compose(_p.set(p[0], p[1], p[2]), _q, _s);
    return this.addMatrix(geo, slot, _m);
  }

  /** a primitive stretched between two points (cylinders/boxes along their Y axis) */
  between(geo: THREE.BufferGeometry, slot: string, a: V3, b: V3, thick: number | [number, number]): this {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const [tx, tz] = typeof thick === 'number' ? [thick, thick] : thick;
    return this.addDir(geo, slot, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [dx, dy, dz], [tx, len, tz]);
  }

  addMatrix(geo: THREE.BufferGeometry, slot: string, m: THREE.Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.clearGroups();
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    let list = this.bySlot.get(slot);
    if (!list) this.bySlot.set(slot, (list = []));
    list.push(g);
    return this;
  }

  build(): MergedPart[] {
    const out: MergedPart[] = [];
    for (const [slot, list] of this.bySlot) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!geo) throw new Error(`Kit: failed to merge slot ${slot}`);
      geo.computeBoundingSphere();
      out.push({ slot, geo });
      if (list.length > 1) for (const g of list) g.dispose();
    }
    this.bySlot.clear();
    return out;
  }
}

/** lazily evaluated module-level singleton */
export function once<T>(fn: () => T): () => T {
  let v: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      v = fn();
      done = true;
    }
    return v as T;
  };
}

/** Add two eyes (white sphere + black pupil + tiny highlight) mirrored on ±X. */
export function addEyes(
  k: Kit,
  x: number,
  y: number,
  z: number,
  r: number,
  o: { fwd?: number; up?: number; eye?: string; pupil?: string; slit?: boolean } = {},
): Kit {
  const fwd = o.fwd ?? 0.45;
  const up = o.up ?? 0.1;
  for (const s of [-1, 1]) {
    const dl = Math.hypot(1, up, fwd);
    const dx = s / dl;
    const dy = up / dl;
    const dz = fwd / dl;
    k.add(G.sphere, o.eye ?? 'eye', [s * x, y, z], r);
    const px = s * x + dx * r * 0.62;
    const py = y + dy * r * 0.62;
    const pz = z + dz * r * 0.62;
    if (o.slit) k.addDir(G.sphere, o.pupil ?? 'pupil', [px, py, pz], [0, 1, 0], [r * 0.2, r * 0.62, r * 0.45]);
    else k.add(G.sphere, o.pupil ?? 'pupil', [px, py, pz], r * 0.55);
    k.add(G.sphere, 'eye', [px + dx * r * 0.3, py + r * 0.22, pz + dz * r * 0.3], r * 0.14);
  }
  return k;
}

// ---------------------------------------------------------------- render helpers
// R3F intrinsic elements, created through createElement so this module can stay .ts
type AnyProps = Record<string, unknown>;
const MESH = 'mesh' as unknown as FC<AnyProps>;
const GROUP = 'group' as unknown as FC<AnyProps>;

export type SlotMats = Record<string, THREE.Material>;

/** Render merged parts, resolving each slot to a material. */
export function Parts(props: { parts: MergedPart[]; mats: SlotMats; shadow?: boolean; receive?: boolean }) {
  const { parts, mats, shadow = true, receive = false } = props;
  return createElement(
    Fragment,
    null,
    parts.map((p) =>
      createElement(MESH, {
        key: p.slot,
        geometry: p.geo,
        material: mats[p.slot] ?? MISSING,
        castShadow: shadow,
        receiveShadow: receive,
      }),
    ),
  );
}
const MISSING = mat('#ff00ff');

/**
 * A rotation pivot. Children are authored in MODEL space; the pivot rotates them about `at`.
 * Nest Joints freely: inner Joints also take model-space pivots.
 */
export function Joint(props: { at: V3; gref?: Ref<THREE.Group>; children?: ReactNode; visible?: boolean }) {
  const { at, gref, children, visible } = props;
  return createElement(
    GROUP,
    { ref: gref, position: at, visible },
    createElement(GROUP, { position: [-at[0], -at[1], -at[2]] }, children),
  );
}

/** Mirror children across X (left side of a symmetric rig). */
export function Mirror(props: { children?: ReactNode }) {
  return createElement(GROUP, { scale: [-1, 1, 1] }, props.children);
}

/** Per-instance clone of a material (for hurt flashes). Disposed on unmount. */
export function useInstanceMat(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = useMemo(() => base.clone(), [base]);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

// ---------------------------------------------------------------- animation helpers
export const ATTACK_MS = 300;
export const HURT_MS = 150;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** frame-rate independent exponential approach */
export const damp = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));

/** linear 0..1 progress through a window of `ms` after `at`, or -1 outside it */
export function prog(now: number, at: number, ms = ATTACK_MS): number {
  if (!at) return -1;
  const t = (now - at) / ms;
  return t >= 0 && t < 1 ? t : -1;
}

/** smooth bump 0 -> 1 -> 0 over `ms` after `at` (0 outside) */
export function bump(now: number, at: number, ms = ATTACK_MS): number {
  const t = prog(now, at, ms);
  return t < 0 ? 0 : Math.sin(t * Math.PI);
}

/** fast open, snap shut: 0 -> 1 over the first 55%, then quickly back to 0 */
export function snap(now: number, at: number, ms = ATTACK_MS): number {
  const t = prog(now, at, ms);
  if (t < 0) return 0;
  return t < 0.55 ? Math.sin((t / 0.55) * Math.PI * 0.5) : Math.max(0, 1 - (t - 0.55) / 0.2);
}

/**
 * Hurt reaction: squash the root and flash the skin red for HURT_MS.
 * `tint` is the resting emissive colour (e.g. a blue "slowed" tint), default black.
 */
export function applyHurt(
  root: THREE.Object3D | null,
  skin: THREE.MeshStandardMaterial | null,
  now: number,
  hurtAt: number,
  tint?: THREE.Color,
) {
  const t = prog(now, hurtAt, HURT_MS);
  const k = t < 0 ? 0 : 1 - t;
  if (root) root.scale.set(1 + 0.1 * k, 1 - 0.13 * k, 1 + 0.1 * k);
  if (skin) {
    skin.emissiveIntensity = 1;
    if (k > 0) skin.emissive.setRGB(0.95 * k, 0.08 * k, 0.05 * k);
    else if (tint) skin.emissive.copy(tint);
    else skin.emissive.setRGB(0, 0, 0);
  }
}

/** deterministic 0..1 hash of an integer (and optional salt) */
export function hash01(n: number, salt = 0): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

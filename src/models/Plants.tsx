// Crop / wild plant models. Model space: Y up, base at y = 0, fits inside one 2x2 tile.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlantSpecies } from '../../shared/constants';
import {
  COMMON,
  G,
  Joint,
  Kit,
  Parts,
  addEyes,
  damp,
  glowMat,
  lerp,
  mat,
  mix,
  once,
  type MergedPart,
  type SlotMats,
  type V3,
} from './materials';

type Grp = THREE.Group;
const PI = Math.PI;
const STAGE_SCALE = [0.32, 0.55, 0.8, 1];

// ---------------------------------------------------------------- palettes
type Pal = Record<string, string>;
const BASE: Record<PlantSpecies, Pal> = {
  snapjaw: { leaf: '#4f9a3a', leaf2: '#6dbb47', stem: '#3d7a2c', pod: '#d23c3c', podSpot: '#ffd84a', thorn: '#7a2a3a' },
  thornberry: { leaf: '#2f6b35', leaf2: '#3d7d3f', stem: '#5a3d22', thorn: '#d9c9a0', berry: '#27408b', berryHi: '#7f9be0' },
  wanderroot: { root: '#c7793a', rootDark: '#8a4f24', rootLine: '#a8622e', leaf: '#5aa83c', leaf2: '#7ccc4a' },
  glowcap: { stem: '#f2efe4', gill: '#a8ece6', spot: '#ffffff' },
  sunbloom: { stem: '#4d8f32', leaf: '#5aa83c', leaf2: '#3f7a2a', center: '#6b3f1d', seed: '#3b220f', petal: '#ffcc22', petal2: '#ff9a1f', bud: '#6aa53e' },
};
const satCache = new Map<string, string>();
const _h = { h: 0, s: 0, l: 0 };
const _col = new THREE.Color();
function saturate(c: string, k: number): string {
  const key = c + k;
  let r = satCache.get(key);
  if (!r) {
    _col.set(c).getHSL(_h);
    _col.setHSL(_h.h, Math.min(1, _h.s * k), _h.l * 0.95);
    r = '#' + _col.getHexString();
    satCache.set(key, r);
  }
  return r;
}

const CAP = mat('#22c9bb', { emissive: '#14cbbb', ei: 1.1, rough: 0.5 });
const CAP_FERAL = mat('#b23fd0', { emissive: '#a020c0', ei: 1.0, rough: 0.5 });
const NECTAR = mat('#ffd54a', { emissive: '#ffb300', ei: 1.2, rough: 0.3 });

function plantMats(species: PlantSpecies, wild: boolean, feral: boolean): SlotMats {
  const m: SlotMats = { ...COMMON };
  for (const [slot, c0] of Object.entries(BASE[species])) {
    let c = wild ? saturate(c0, 1.3) : c0;
    if (feral) {
      c = mix(c, slot === 'petal' || slot === 'petal2' ? '#7a4a2a' : '#6b2a5a', 0.3);
      m[slot] = mat(c, { emissive: slot === 'pod' ? '#c0102a' : '#7a0a40', ei: slot === 'pod' ? 0.6 : 0.35 });
    } else m[slot] = mat(c);
  }
  m.cap = feral ? CAP_FERAL : CAP;
  m.nectar = NECTAR;
  return m;
}

// ---------------------------------------------------------------- tamed glow
const GLOW_DISC = glowMat('#ffc94a', 0.16, true);
const SPARK = glowMat('#ffe9a0', 0.9, true);

function TameGlow({ r }: { r: number }) {
  const sparks = useRef<Grp>(null!);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    const g = sparks.current;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      const k = (t * 0.35 + i / 3) % 1;
      const a = t * 0.8 + (i * PI * 2) / 3;
      c.position.set(Math.cos(a) * r * 0.75, 0.15 + k * 1.4, Math.sin(a) * r * 0.75);
      c.scale.setScalar(0.06 * Math.sin(k * PI));
      c.rotation.y = t * 3;
    }
  });
  return (
    <group>
      <mesh geometry={G.disc} material={GLOW_DISC} position={[0, 0.03, 0]} scale={r} />
      <group ref={sparks}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} geometry={G.octa} material={SPARK} />
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- geometry
function addFrond(k: Kit, slot: string, angle: number, len: number, lift: number, droop: number, thorns?: Kit) {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  const N = 7;
  const pt = (u: number): V3 => [dx * len * u, len * (lift * u - droop * u * u), dz * len * u];
  for (let i = 0; i < N; i++) {
    const u0 = i / N;
    const u1 = (i + 1) / N;
    const a = pt(u0);
    const b = pt(u1);
    k.between(G.box, slot, a, b, 0.05 * (1 - u0 * 0.6));
    const L = 0.3 * len * (1 - u0 * 0.7);
    for (const s of [-1, 1]) {
      const px = dz * s;
      const pz = -dx * s;
      const dir: V3 = [px + (b[0] - a[0]) * 2, -0.25 + (b[1] - a[1]) * 2, pz + (b[2] - a[2]) * 2];
      const dl = Math.hypot(...dir);
      k.addDir(G.sphere, slot, [a[0] + (dir[0] / dl) * L * 0.5, a[1] + (dir[1] / dl) * L * 0.5, a[2] + (dir[2] / dl) * L * 0.5], dir, [0.06, L * 0.55, 0.03]);
    }
    if (thorns && i % 2 === 1) thorns.add(G.cone, 'thorn', [a[0], a[1] + 0.05, a[2]], [0.025, 0.12, 0.025]);
  }
}

/** n roughly even directions on a sphere (fibonacci), optionally upper part only */
function fib(n: number, minY = -1): V3[] {
  const out: V3[] = [];
  const ga = PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * (1 - minY);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    out.push([Math.cos(i * ga) * r, y, Math.sin(i * ga) * r]);
  }
  return out;
}

const SNAPJAW = once(() => {
  const fronds = new Kit();
  const thorns = new Kit();
  for (let i = 0; i < 6; i++) addFrond(fronds, 'leaf', (i / 6) * PI * 2 + 0.26, 0.95, 2.0, 1.6, thorns);
  for (let i = 0; i < 4; i++) addFrond(fronds, 'leaf2', (i / 4) * PI * 2 + 0.8, 0.65, 2.8, 1.9, thorns);
  const POD: V3 = [0, 0.86, 0.06];
  const pod = new Kit()
    .between(G.cyl, 'stem', [0, 0, 0], [0, 0.72, 0.04], 0.035)
    .add(G.hemi, 'pod', POD, [0.22, 0.17, 0.25], [PI, 0, 0])
    .add(G.disc, 'mouth', [0, POD[1] + 0.005, POD[2]], [0.19, 1, 0.22]);
  for (let i = 0; i < 7; i++) {
    const a = PI * 0.15 + (i / 6) * PI * 0.7;
    pod.add(G.cone, 'tooth', [Math.cos(a) * 0.17, POD[1] + 0.04, POD[2] + Math.sin(a) * 0.2], [0.025, 0.08, 0.025]);
  }
  const top = new Kit().add(G.hemi, 'pod', POD, [0.22, 0.2, 0.25]);
  for (let i = 0; i < 7; i++) {
    const a = PI * 0.2 + (i / 6) * PI * 0.6;
    top.add(G.cone, 'tooth', [Math.cos(a) * 0.17, POD[1] - 0.04, POD[2] + Math.sin(a) * 0.2], [0.025, 0.08, 0.025], [PI, 0, 0]);
  }
  for (const d of fib(7, 0.35)) top.add(G.sphere, 'podSpot', [d[0] * 0.2, POD[1] + d[1] * 0.19, POD[2] + d[2] * 0.23], 0.03);
  return { fronds: fronds.build(), thorns: thorns.build(), pod: pod.build(), top: top.build(), hinge: [0, POD[1], POD[2] - 0.22] as V3 };
});

const THORNBERRY = once(() => {
  const bush = new Kit()
    .between(G.cyl, 'stem', [0, 0, 0], [0, 0.3, 0], 0.07)
    .add(G.ball, 'leaf', [0, 0.52, 0], [0.62, 0.5, 0.62])
    .add(G.ball, 'leaf2', [0.3, 0.44, 0.24], 0.36)
    .add(G.ball, 'leaf2', [-0.3, 0.46, -0.18], 0.38)
    .add(G.ball, 'leaf', [0.05, 0.78, -0.12], 0.32);
  for (const d of fib(34, -0.3)) {
    bush.addDir(G.cone, 'thorn', [d[0] * 0.64, 0.52 + d[1] * 0.52, d[2] * 0.64], d, [0.025, 0.13, 0.025]);
  }
  const feral = new Kit();
  for (const d of fib(30, -0.2)) {
    const r = 0.66;
    feral.addDir(G.cone, 'thorn', [d[0] * r, 0.52 + d[1] * 0.54, d[2] * r], [d[0] + 0.1, d[1], d[2] - 0.1], [0.035, 0.3, 0.035]);
  }
  const berries = new Kit();
  fib(16, -0.1).forEach((d, i) => {
    if (i < 2) return;
    const p: V3 = [d[0] * 0.62, 0.52 + d[1] * 0.5, d[2] * 0.62];
    berries.add(G.ball, 'berry', p, 0.075);
    berries.add(G.sphere, 'berryHi', [p[0] + 0.025, p[1] + 0.04, p[2] + 0.025], 0.02);
  });
  return { bush: bush.build(), feral: feral.build(), berries: berries.build() };
});

const WR_LEGS: V3[] = [
  [0.19, -0.36, 0.16],
  [-0.19, -0.36, 0.16],
  [0.19, -0.36, -0.16],
  [-0.19, -0.36, -0.16],
];
const WANDERROOT = once(() => {
  const bulb = new Kit()
    .add(G.ball, 'root', [0, 0, 0], [0.42, 0.5, 0.42])
    .add(G.torus, 'rootLine', [0, 0.1, 0], [0.405, 0.405, 0.3], [PI / 2, 0, 0])
    .add(G.torus, 'rootLine', [0, -0.22, 0], [0.36, 0.36, 0.3], [PI / 2, 0, 0])
    .add(G.cone, 'rootDark', [0, -0.55, 0], [0.12, 0.25, 0.12], [PI, 0, 0])
    .add(G.cone, 'rootDark', [0.2, -0.38, 0.05], [0.05, 0.22, 0.05], [PI * 0.8, 0, 0.6])
    .add(G.sphere, 'leaf2', [0, 0.52, 0], [0.09, 0.1, 0.09])
    .add(G.box, 'rootDark', [0, 0.05, 0.4], [0.12, 0.025, 0.03]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    const d: V3 = [Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55];
    bulb.addDir(G.sphere, i % 2 ? 'leaf' : 'leaf2', [Math.cos(a) * 0.13, 0.7, Math.sin(a) * 0.13], d, [0.075, 0.27, 0.035]);
  }
  addEyes(bulb, 0.15, 0.17, 0.35, 0.06, { fwd: 1.4, up: 0.2 });
  const legs = WR_LEGS.map(([x, y, z]) =>
    new Kit()
      .between(G.cyl, 'rootDark', [x, y, z], [x * 1.1, y - 0.22, z], 0.06)
      .add(G.sphere, 'root', [x * 1.1, y - 0.25, z + 0.03], [0.08, 0.045, 0.1])
      .build(),
  );
  return { bulb: bulb.build(), legs };
});

const MUSHROOMS: [x: number, z: number, h: number, r: number, tilt: number][] = [
  [0, 0, 0.55, 0.32, 0],
  [0.34, 0.18, 0.36, 0.2, 0.28],
  [-0.3, 0.24, 0.28, 0.16, -0.32],
  [0.12, -0.34, 0.42, 0.22, 0.18],
  [-0.27, -0.22, 0.2, 0.12, -0.22],
];
const GLOWCAP = once(() => {
  const k = new Kit();
  MUSHROOMS.forEach(([x, z, h, r, tilt], i) => {
    const dir: V3 = [Math.sin(tilt) * (x >= 0 ? 1 : -1) * 0.7, 1, Math.sin(tilt) * (z >= 0 ? 1 : -1) * 0.4];
    const dl = Math.hypot(...dir);
    const top: V3 = [x + (dir[0] / dl) * h, (dir[1] / dl) * h, z + (dir[2] / dl) * h];
    k.between(G.cylTaper, 'stem', [x, 0, z], top, r * 0.3);
    k.addDir(G.hemi, 'cap', top, dir, [r, r * 0.62, r]);
    k.addDir(G.cyl, 'gill', top, dir, [r * 0.93, 0.025, r * 0.93]);
    for (let j = 0; j < 3; j++) {
      const a = j * 2.1 + i;
      k.add(G.sphere, 'spot', [top[0] + Math.cos(a) * r * 0.5, top[1] + r * 0.42, top[2] + Math.sin(a) * r * 0.5], r * 0.12);
    }
  });
  return k.build();
});

const SB_HEAD: V3 = [0, 1.75, 0];
const SUNBLOOM = once(() => {
  const stem = new Kit().between(G.cyl, 'stem', [0, 0, 0], SB_HEAD, 0.055);
  for (const [y, a] of [
    [0.45, 0],
    [0.8, PI],
    [1.12, PI / 2],
    [1.38, -PI / 2],
  ]) {
    stem.addDir(G.sphere, 'leaf', [Math.sin(a) * 0.2, y, Math.cos(a) * 0.2], [Math.sin(a), 0.55, Math.cos(a)], [0.08, 0.22, 0.025]);
  }
  const [hx, hy, hz] = SB_HEAD;
  const head = new Kit()
    .addDir(G.cyl, 'leaf2', [hx, hy, hz - 0.05], [0, 0, 1], [0.3, 0.06, 0.3])
    .addDir(G.cyl, 'center', [hx, hy, hz + 0.02], [0, 0, 1], [0.25, 0.08, 0.25])
    .addDir(G.hemi, 'center', [hx, hy, hz + 0.06], [0, 0, 1], [0.22, 0.06, 0.22]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * PI * 2;
    const d: V3 = [Math.cos(a), Math.sin(a), 0.12];
    head.addDir(G.sphere, 'petal', [hx + d[0] * 0.4, hy + d[1] * 0.4, hz + 0.03], d, [0.09, 0.2, 0.025]);
    const b = a + PI / 14;
    const e: V3 = [Math.cos(b), Math.sin(b), 0.05];
    head.addDir(G.sphere, 'petal2', [hx + e[0] * 0.36, hy + e[1] * 0.36, hz - 0.01], e, [0.08, 0.18, 0.02]);
  }
  for (let i = 0; i < 12; i++) {
    const r = Math.sqrt(i / 12) * 0.17;
    const a = i * 2.4;
    head.add(G.sphere, 'seed', [hx + Math.cos(a) * r, hy + Math.sin(a) * r, hz + 0.1], 0.022);
  }
  const nectar = new Kit()
    .add(G.sphere, 'nectar', [hx + 0.06, hy + 0.05, hz + 0.12], 0.04)
    .add(G.sphere, 'nectar', [hx - 0.07, hy - 0.02, hz + 0.12], 0.035)
    .add(G.sphere, 'nectar', [hx + 0.01, hy - 0.09, hz + 0.12], 0.03);
  const bud = new Kit()
    .add(G.ball, 'bud', SB_HEAD, [0.15, 0.2, 0.15])
    .add(G.cone, 'petal', [hx, hy + 0.16, hz], [0.07, 0.16, 0.07]);
  return { stem: stem.build(), head: head.build(), nectar: nectar.build(), bud: bud.build() };
});

// ---------------------------------------------------------------- species components
interface SpProps {
  mats: SlotMats;
  stage: number;
  feral: boolean;
  wild: boolean;
  walking: boolean;
  seed: number;
}

/** shared wind sway / feral shake on a group */
function sway(g: Grp, t: number, seed: number, feral: boolean, amp = 1) {
  g.rotation.z = Math.sin(t * 1.3 + seed) * 0.045 * amp + (feral ? Math.sin(t * 23 + seed) * 0.05 : 0);
  g.rotation.x = Math.sin(t * 1.05 + seed * 1.7) * 0.035 * amp + (feral ? Math.sin(t * 19) * 0.04 : 0);
}

function Snapjaw({ mats, stage, feral, seed }: SpProps) {
  const P = SNAPJAW();
  const g = useRef<Grp>(null!);
  const top = useRef<Grp>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    sway(g.current, t, seed, feral);
    if (top.current) {
      const open = feral ? Math.pow(0.5 + 0.5 * Math.sin(t * 13), 0.6) * 0.85 : (0.5 + 0.5 * Math.sin(t * 1.4)) * 0.3;
      top.current.rotation.x = -open;
    }
  });
  return (
    <group ref={g}>
      <Parts parts={P.fronds} mats={mats} />
      {feral && <Parts parts={P.thorns} mats={mats} />}
      {stage >= 3 && (
        <>
          <Parts parts={P.pod} mats={mats} />
          <Joint at={P.hinge} gref={top}>
            <Parts parts={P.top} mats={mats} />
          </Joint>
        </>
      )}
    </group>
  );
}

function Thornberry({ mats, stage, feral, seed }: SpProps) {
  const P = THORNBERRY();
  const g = useRef<Grp>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    sway(g.current, t, seed, feral, 0.6);
    const pulse = feral ? 1 + Math.sin(t * 9) * 0.04 : 1 + Math.sin(t * 1.6) * 0.012;
    g.current.scale.set(pulse, 2 - pulse, pulse);
  });
  return (
    <group ref={g}>
      <Parts parts={P.bush} mats={mats} />
      {feral && <Parts parts={P.feral} mats={mats} />}
      {stage >= 3 && <Parts parts={P.berries} mats={mats} />}
    </group>
  );
}

function Wanderroot({ mats, feral, wild, walking, seed }: SpProps) {
  const P = WANDERROOT();
  const bulb = useRef<Grp>(null!);
  const legs = useRef<Grp>(null!);
  const legRefs = [useRef<Grp>(null!), useRef<Grp>(null!), useRef<Grp>(null!), useRef<Grp>(null!)];
  const st = useRef({ lift: wild || walking ? 1 : 0, A: 0, ph: 0 });
  const flags = useRef({ wild, walking, feral });
  flags.current = { wild, walking, feral };
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = state.clock.elapsedTime + seed;
    const s = st.current;
    const f = flags.current;
    s.lift = damp(s.lift, f.wild || f.walking ? 1 : 0, 3, dt);
    s.A = damp(s.A, f.walking ? 1 : 0, 6, dt);
    s.ph += dt * 11;
    const L = s.lift;
    const wob = Math.sin(s.ph) * s.A;
    bulb.current.position.y = lerp(0.2, 0.66, L) + Math.abs(Math.cos(s.ph)) * 0.06 * s.A;
    bulb.current.rotation.z = wob * 0.16 + Math.sin(t * 1.2) * 0.04 + (f.feral ? Math.sin(t * 20) * 0.06 : 0);
    bulb.current.rotation.x = Math.sin(t * 0.9 + seed) * 0.03;
    legs.current.scale.setScalar(Math.max(0.001, L));
    for (let i = 0; i < 4; i++) {
      const diag = i === 0 || i === 3 ? 1 : -1;
      legRefs[i].current.rotation.x = Math.sin(s.ph) * 0.7 * s.A * diag;
    }
  });
  return (
    <group ref={bulb}>
      <Parts parts={P.bulb} mats={mats} />
      <group ref={legs}>
        {P.legs.map((parts: MergedPart[], i: number) => (
          <Joint key={i} at={WR_LEGS[i]} gref={legRefs[i]}>
            <Parts parts={parts} mats={mats} />
          </Joint>
        ))}
      </group>
    </group>
  );
}

function Glowcap({ mats, feral, seed }: SpProps) {
  const P = GLOWCAP();
  const g = useRef<Grp>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    sway(g.current, t, seed, feral, 0.4);
    const b = feral ? 1 + Math.sin(t * 7) * 0.06 : 1 + Math.sin(t * 2) * 0.02;
    g.current.scale.set(1, b, 1);
    if (feral) CAP_FERAL.emissiveIntensity = 0.8 + Math.sin(state.clock.elapsedTime * 6) * 0.5;
  });
  return (
    <group ref={g}>
      <Parts parts={P} mats={mats} />
    </group>
  );
}

function Sunbloom({ mats, stage, feral, seed }: SpProps) {
  const P = SUNBLOOM();
  const g = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime + seed;
    sway(g.current, t, seed, false, 0.7);
    if (feral) g.current.rotation.z += 0.22;
    head.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.12 + seed) * 0.7;
    head.current.rotation.x = feral ? 1.0 + Math.sin(t * 2) * 0.05 : -0.22 + Math.sin(t * 0.8) * 0.04;
  });
  const bloom = stage >= 2;
  return (
    <group ref={g}>
      <Parts parts={P.stem} mats={mats} />
      <Joint at={SB_HEAD} gref={head}>
        {bloom ? <Parts parts={P.head} mats={mats} /> : <Parts parts={P.bud} mats={mats} />}
        {bloom && stage >= 3 && !feral && <Parts parts={P.nectar} mats={mats} shadow={false} />}
      </Joint>
    </group>
  );
}

const SPECIES: Record<PlantSpecies, (p: SpProps) => React.JSX.Element> = {
  snapjaw: Snapjaw,
  thornberry: Thornberry,
  wanderroot: Wanderroot,
  glowcap: Glowcap,
  sunbloom: Sunbloom,
};

/** Approximate full-size plant heights. */
export const PLANT_HEIGHT: Record<PlantSpecies, number> = { snapjaw: 1.1, thornberry: 1.2, wanderroot: 1.4, glowcap: 0.8, sunbloom: 2.2 };

export function PlantModel(props: { species: PlantSpecies; stage: number; wild: boolean; feral: boolean; tamed: boolean; walking?: boolean }) {
  const { species, stage, wild, feral, tamed, walking = false } = props;
  const mats = useMemo(() => plantMats(species, wild, feral), [species, wild, feral]);
  const rnd = useMemo(() => ({ seed: Math.random() * 100, rot: Math.random() * PI * 2, tilt: (Math.random() - 0.5) * 0.18, s: 0.9 + Math.random() * 0.25 }), []);
  const st = Math.max(0, Math.min(3, stage | 0));
  const sc = wild ? rnd.s : STAGE_SCALE[st] * (0.95 + (rnd.s - 0.9) * 0.4);
  const Comp = SPECIES[species];
  // wanderroots face where they walk (the caller rotates them), others get a random yaw
  const yaw = species === 'wanderroot' ? 0 : rnd.rot;
  return (
    <group scale={sc}>
      <group rotation={[wild ? rnd.tilt : 0, yaw, wild ? -rnd.tilt : 0]}>
        <Comp mats={mats} stage={wild ? Math.max(st, 2) : st} feral={feral} wild={wild} walking={walking} seed={rnd.seed} />
      </group>
      {tamed && !feral && <TameGlow r={0.7} />}
    </group>
  );
}

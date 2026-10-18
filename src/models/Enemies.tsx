// Raider models. Model space: Y up, facing +Z, feet at y = 0.
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EnemyType } from '../../shared/constants';
import { ANIM } from '../../shared/protocol';
import type { AnimRef } from './types';
import {
  COMMON,
  G,
  Joint,
  Kit,
  Mirror,
  Parts,
  addEyes,
  applyHurt,
  bump,
  clamp,
  damp,
  lerp,
  mat,
  mix,
  once,
  shade,
  snap,
  useInstanceMat,
  type MergedPart,
  type SlotMats,
  type V3,
} from './materials';

type Grp = THREE.Group;
const PI = Math.PI;
const SLOW_TINT = new THREE.Color(0.0, 0.015, 0.05);

const PAL: Record<EnemyType, { skin: string; belly: string; dark: string; band: string; eye: string }> = {
  megalania: { skin: '#4e3946', belly: '#a08a6a', dark: '#2f222b', band: '#7d6450', eye: '#ffd23f' },
  sarcosuchus: { skin: '#5f6e55', belly: '#b5b28e', dark: '#3c4936', band: '#738260', eye: '#e8d84a' },
  titanoboa: { skin: '#6b7a3a', belly: '#cfc78f', dark: '#343d1b', band: '#7f8c48', eye: '#f2d12e' },
};

const VINE = mat('#3f8a2c');
const VINE_LEAF = mat('#6dbb3c');

/** Approximate model heights for placing health bars. */
export const ENEMY_MODEL_HEIGHT: Record<EnemyType, number> = { megalania: 1.3, sarcosuchus: 1.5, titanoboa: 1.5 };

/** tongue flick schedule (shared by the two scaled reptiles) */
function tongueFlick(s: { flickAt: number; nextFlick: number }, t: number, tongue: Grp) {
  if (t > s.nextFlick) {
    s.flickAt = t;
    s.nextFlick = t + 1.6 + Math.random() * 2.6;
  }
  const k = (t - s.flickAt) / 0.5;
  if (k >= 0 && k < 1) {
    tongue.visible = true;
    tongue.scale.set(1, 1, Math.max(0.01, Math.sin(k * PI) * (0.75 + 0.25 * Math.sin(k * 30))));
  } else tongue.visible = false;
}

function addTongue(k: Kit, base: V3, len: number) {
  const [x, y, z] = base;
  k.add(G.box, 'tongue', [x, y, z + len / 2], [0.035, 0.016, len]);
  for (const s of [-1, 1]) k.add(G.box, 'tongue', [x + s * 0.035, y, z + len + 0.05], [0.022, 0.014, 0.13], [0, s * 0.4, 0]);
}

/** a sprawling lizard leg (right side), hip pivot at (x0,y0,z0) */
function sprawlLeg(x0: number, y0: number, z0: number, reach: number, k: number): MergedPart[] {
  const ex = x0 + reach;
  const kit = new Kit()
    .add(G.sphere, 'skin', [x0 + reach * 0.45, y0 - 0.02, z0], [reach * 0.58, 0.11 * k, 0.12 * k])
    .add(G.sphere, 'skin', [ex, y0 - 0.05, z0], 0.1 * k)
    .between(G.cyl, 'skin', [ex, y0 - 0.05, z0], [ex + 0.2, 0.07, z0 + 0.03], 0.08 * k)
    .add(G.sphere, 'skin', [ex + 0.2, 0.07, z0 + 0.03], 0.075 * k)
    .add(G.box, 'dark', [ex + 0.21, 0.03, z0 + 0.1 * k], [0.2 * k, 0.06, 0.25 * k]);
  for (const dx of [-0.07, 0, 0.07]) {
    kit.add(G.cone, 'claw', [ex + 0.21 + dx * k, 0.03, z0 + 0.25 * k], [0.025 * k, 0.08 * k, 0.025 * k], [PI / 2, 0, 0]);
  }
  return kit.build();
}

/** hemisphere band hugging an ellipsoid centred at c with radii r, at depth z */
function band(k: Kit, slot: string, c: V3, r: V3, z: number, thick: number) {
  const u = (z - c[2]) / r[2];
  if (Math.abs(u) >= 1) return;
  const f = Math.sqrt(1 - u * u) * 1.04;
  k.add(G.hemi, slot, [c[0], c[1], z], [r[0] * f, r[1] * f, thick]);
}

function vineRings(rings: { c: V3; r: [number, number]; tilt?: number }[]): MergedPart[] {
  const k = new Kit();
  rings.forEach(({ c, r, tilt = 0 }, i) => {
    k.add(G.torus, 'vine', c, [r[0], r[1], 1.4], [0, 0, tilt]);
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * PI * 2 + i;
      k.add(G.sphere, 'leaf', [c[0] + Math.cos(a) * r[0], c[1] + Math.sin(a) * r[1], c[2] + 0.04], [0.07, 0.035, 0.12], [a, 0.6, 0]);
    }
  });
  return k.build();
}

function useEnemyMats(type: EnemyType) {
  const p = PAL[type];
  const skin = useInstanceMat(mat(p.skin));
  const mats = useMemo<SlotMats>(
    () => ({
      ...COMMON,
      skin,
      belly: mat(p.belly),
      dark: mat(p.dark),
      band: mat(p.band),
      eyeY: mat(p.eye, { emissive: p.eye, ei: 0.35 }),
      vine: VINE,
      leaf: VINE_LEAF,
    }),
    [skin, p],
  );
  return { mats, skin };
}

function useScratch() {
  return useRef({ ph: 0, A: 0, swim: 0, flickAt: -10, nextFlick: 1 + Math.random() * 3, seed: Math.random() * 100 });
}

// ================================================================= MEGALANIA
const MG = {
  body: [0, 0.62, 0] as V3,
  head: [0, 0.76, 1.3] as V3,
  jaw: [0, 0.72, 1.4] as V3,
  tongue: [0, 0.72, 2.0] as V3,
  tail1: [0, 0.64, -0.85] as V3,
  tail2: [0, 0.6, -1.75] as V3,
  legF: [0.4, 0.6, 0.6] as V3,
  legB: [0.4, 0.6, -0.5] as V3,
};

const MEGALANIA = once(() => {
  const TC: V3 = [0, 0.66, 0.05];
  const TR: V3 = [0.55, 0.36, 1.0];
  const torso = new Kit()
    .add(G.sphere, 'skin', TC, TR)
    .add(G.sphere, 'belly', [0, 0.55, 0.05], [0.47, 0.26, 0.92])
    .add(G.sphere, 'skin', [0, 0.72, 1.05], [0.3, 0.26, 0.42]);
  for (const z of [-0.6, -0.25, 0.1, 0.45]) band(torso, 'band', TC, TR, z, 0.09);
  for (let z = -0.8; z <= 0.81; z += 0.27) {
    const y = TC[1] + TR[1] * Math.sqrt(1 - ((z - TC[2]) / TR[2]) ** 2);
    torso.add(G.cone4, 'dark', [0, y + 0.02, z], [0.045, 0.12, 0.07], [-0.3, 0, 0]);
  }
  const head = new Kit()
    .add(G.sphere, 'skin', [0, 0.8, 1.6], [0.26, 0.17, 0.42])
    .add(G.sphere, 'skin', [0, 0.76, 1.92], [0.17, 0.11, 0.24])
    .add(G.sphere, 'band', [0, 0.92, 1.45], [0.16, 0.05, 0.2])
    .add(G.sphere, 'dark', [0.07, 0.82, 2.13], 0.022)
    .add(G.sphere, 'dark', [-0.07, 0.82, 2.13], 0.022);
  for (const s of [-1, 1]) head.add(G.box, 'dark', [s * 0.16, 0.925, 1.64], [0.1, 0.025, 0.18], [0, s * 0.2, s * -0.3]);
  addEyes(head, 0.2, 0.9, 1.66, 0.065, { eye: 'eyeY', slit: true, fwd: 0.3 });
  const jaw = new Kit()
    .add(G.sphere, 'belly', [0, 0.67, 1.75], [0.22, 0.08, 0.4])
    .add(G.sphere, 'mouth', [0, 0.715, 1.72], [0.19, 0.04, 0.34]);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) jaw.add(G.cone, 'tooth', [s * (0.15 - i * 0.02), 0.72, 1.62 + i * 0.1], [0.018, 0.05, 0.018]);
  const tongue = new Kit();
  addTongue(tongue, MG.tongue, 0.38);

  const T1C: V3 = [0, 0.62, -1.3];
  const T1R: V3 = [0.3, 0.24, 0.6];
  const tail1 = new Kit().add(G.sphere, 'skin', T1C, T1R);
  for (const z of [-1.05, -1.4]) band(tail1, 'band', T1C, T1R, z, 0.08);
  const T2C: V3 = [0, 0.56, -2.2];
  const T2R: V3 = [0.16, 0.13, 0.55];
  const tail2 = new Kit().add(G.sphere, 'skin', T2C, T2R).add(G.cone, 'skin', [0, 0.55, -2.8], [0.06, 0.25, 0.06], [-PI / 2, 0, 0]);
  for (const z of [-1.95, -2.3]) band(tail2, 'band', T2C, T2R, z, 0.07);

  return {
    torso: torso.build(),
    head: head.build(),
    jaw: jaw.build(),
    tongue: tongue.build(),
    tail1: tail1.build(),
    tail2: tail2.build(),
    legF: sprawlLeg(MG.legF[0], MG.legF[1], MG.legF[2], 0.42, 1),
    legB: sprawlLeg(MG.legB[0], MG.legB[1], MG.legB[2], 0.44, 1.05),
    vines: vineRings([
      { c: [0, 0.66, 0.35], r: [0.58, 0.4], tilt: 0.2 },
      { c: [0, 0.64, -0.35], r: [0.58, 0.4], tilt: -0.3 },
      { c: [0, 0.6, -1.25], r: [0.33, 0.27] },
    ]),
  };
});

// ================================================================= SARCOSUCHUS
const SC = {
  body: [0, 0.7, 0] as V3,
  head: [0, 0.75, 2.0] as V3,
  jaw: [0, 0.68, 2.15] as V3,
  tail1: [0, 0.72, -1.7] as V3,
  tail2: [0, 0.68, -2.7] as V3,
  tail3: [0, 0.62, -3.6] as V3,
  legF: [0.7, 0.7, 1.1] as V3,
  legB: [0.72, 0.7, -1.1] as V3,
};

const SARCO = once(() => {
  const TC: V3 = [0, 0.72, 0];
  const TR: V3 = [0.95, 0.45, 2.0];
  const torso = new Kit()
    .add(G.sphere, 'skin', TC, TR)
    .add(G.sphere, 'belly', [0, 0.6, 0], [0.85, 0.32, 1.85])
    .add(G.sphere, 'skin', [0, 0.74, 1.75], [0.65, 0.38, 0.6]);
  for (const x of [-0.45, -0.17, 0.17, 0.45]) {
    const inner = Math.abs(x) < 0.3;
    for (let z = -1.6; z <= 1.61; z += 0.4) {
      const q = 1 - (x / TR[0]) ** 2 - (z / TR[2]) ** 2;
      if (q <= 0.05) continue;
      const y = TC[1] + TR[1] * Math.sqrt(q);
      torso.add(G.box, 'dark', [x, y + 0.01, z], inner ? [0.17, 0.12, 0.24] : [0.13, 0.08, 0.2], [0, 0, x * 0.5]);
    }
  }
  const head = new Kit()
    .add(G.sphere, 'skin', [0, 0.82, 2.3], [0.45, 0.24, 0.45])
    .add(G.box, 'dark', [0, 0.99, 2.25], [0.46, 0.05, 0.42])
    .addDir(G.taper4, 'skin', [0, 0.76, 3.15], [0, 0, 1], [0.4, 1.5, 0.22])
    .add(G.sphere, 'dark', [0, 0.85, 3.86], [0.2, 0.13, 0.18])
    .add(G.sphere, 'skin', [0.2, 1.0, 2.25], 0.1)
    .add(G.sphere, 'skin', [-0.2, 1.0, 2.25], 0.1)
    .add(G.sphere, 'pupil', [0.08, 0.92, 3.92], 0.03)
    .add(G.sphere, 'pupil', [-0.08, 0.92, 3.92], 0.03);
  addEyes(head, 0.2, 1.05, 2.28, 0.075, { eye: 'eyeY', slit: true, fwd: 0.4, up: 0.8 });
  for (let i = 0; i < 9; i++) {
    const z = 2.55 + i * 0.16;
    const hw = lerp(0.27, 0.16, (z - 2.4) / 1.5);
    const big = i % 3 === 0 ? 1.4 : 1;
    for (const s of [-1, 1]) head.add(G.cone, 'tooth', [s * hw, 0.66, z], [0.03 * big, 0.12 * big, 0.03 * big], [PI, 0, 0]);
  }
  const jaw = new Kit()
    .add(G.sphere, 'belly', [0, 0.64, 2.35], [0.42, 0.13, 0.4])
    .addDir(G.taper4, 'skin', [0, 0.62, 3.1], [0, 0, 1], [0.36, 1.45, 0.12])
    .add(G.box, 'mouth', [0, 0.675, 2.95], [0.3, 0.02, 1.2]);
  for (let i = 0; i < 8; i++) {
    const z = 2.65 + i * 0.16;
    const hw = lerp(0.24, 0.15, (z - 2.4) / 1.5);
    for (const s of [-1, 1]) jaw.add(G.cone, 'tooth', [s * hw, 0.7, z], [0.028, 0.1, 0.028]);
  }
  const crest = (k: Kit, z0: number, z1: number, y0: number, y1: number, w: number, h: number) => {
    for (let i = 0; i <= 3; i++) {
      const u = i / 3;
      for (const s of [-1, 1]) k.add(G.cone4, 'dark', [s * w, lerp(y0, y1, u), lerp(z0, z1, u)], [0.06, h, 0.1]);
    }
  };
  const tail1 = new Kit().add(G.sphere, 'skin', [0, 0.7, -2.2], [0.6, 0.38, 0.75]);
  crest(tail1, -1.75, -2.75, 1.1, 1.0, 0.16, 0.2);
  const tail2 = new Kit().add(G.sphere, 'skin', [0, 0.64, -3.15], [0.36, 0.27, 0.65]);
  crest(tail2, -2.75, -3.6, 0.92, 0.84, 0.1, 0.17);
  const tail3 = new Kit().add(G.sphere, 'skin', [0, 0.58, -4.0], [0.2, 0.2, 0.6]);
  for (let i = 0; i < 4; i++) tail3.add(G.cone4, 'dark', [0, 0.8 - i * 0.04, -3.65 - i * 0.22], [0.05, 0.16, 0.09]);

  return {
    torso: torso.build(),
    head: head.build(),
    jaw: jaw.build(),
    tail1: tail1.build(),
    tail2: tail2.build(),
    tail3: tail3.build(),
    legF: sprawlLeg(SC.legF[0], SC.legF[1], SC.legF[2], 0.5, 1.35),
    legB: sprawlLeg(SC.legB[0], SC.legB[1], SC.legB[2], 0.55, 1.45),
    vines: vineRings([
      { c: [0, 0.74, 0.9], r: [0.98, 0.5], tilt: 0.15 },
      { c: [0, 0.74, -0.7], r: [0.98, 0.5], tilt: -0.2 },
      { c: [0, 0.73, 3.0], r: [0.3, 0.22] },
    ]),
  };
});

// ================================================================= shared quadruped rig
interface QuadParts {
  torso: MergedPart[];
  head: MergedPart[];
  jaw: MergedPart[];
  tongue?: MergedPart[];
  tail1: MergedPart[];
  tail2: MergedPart[];
  tail3?: MergedPart[];
  legF: MergedPart[];
  legB: MergedPart[];
  vines: MergedPart[];
}
interface QuadPivots {
  body: V3;
  head: V3;
  jaw: V3;
  tongue?: V3;
  tail1: V3;
  tail2: V3;
  tail3?: V3;
  legF: V3;
  legB: V3;
}

function Quadruped(props: {
  P: QuadParts;
  J: QuadPivots;
  mats: SlotMats;
  skin: THREE.MeshStandardMaterial;
  animRef: AnimRef;
  slowed: boolean;
  /** stride frequency per unit speed, body yaw amount, attack window */
  gait: { freq: number; yaw: number; atkMs: number; jawOpen: number };
}) {
  const { P, J, mats, skin, animRef, slowed, gait } = props;
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const jaw = useRef<Grp>(null!);
  const tongue = useRef<Grp>(null!);
  const t1 = useRef<Grp>(null!);
  const t2 = useRef<Grp>(null!);
  const t3 = useRef<Grp>(null!);
  const fr = useRef<Grp>(null!);
  const fl = useRef<Grp>(null!);
  const br = useRef<Grp>(null!);
  const bl = useRef<Grp>(null!);
  const vines = useRef<Grp>(null!);
  const st = useScratch();
  const slowRef = useRef(slowed);
  slowRef.current = slowed;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    const swimming = a.mode === ANIM.SWIM;
    const slowK = slowRef.current ? 0.55 : 1;
    s.swim = damp(s.swim, swimming ? 1 : 0, 4, dt);
    const W = s.swim;
    s.A = damp(s.A, swimming ? 0 : clamp(a.speed / 2.5, 0, 1), 8, dt);
    const A = s.A;
    s.ph += dt * (1.5 + a.speed * gait.freq) * slowK;
    const sw = Math.sin(s.ph);
    const cw = Math.cos(s.ph);

    // sprawling lizard gait: legs swing fore/aft (Y) and lift (Z); diagonal pairs in phase
    const swing = sw * 0.55 * A;
    const liftA = Math.max(0, -cw) * 0.4 * A;
    const liftB = Math.max(0, cw) * 0.4 * A;
    const tuck = W * 1.1;
    fr.current.rotation.set(0, swing + tuck, liftA - W * 0.2);
    bl.current.rotation.set(0, swing + tuck, liftA - W * 0.2);
    fl.current.rotation.set(0, -swing + tuck, liftB - W * 0.2);
    br.current.rotation.set(0, -swing + tuck, liftB - W * 0.2);

    const atk = bump(now, a.attackAt, gait.atkMs);
    const undul = Math.sin(t * 3) * W;
    body.current.rotation.y = sw * gait.yaw * A + undul * 0.06;
    body.current.position.set(0, J.body[1] + Math.abs(sw) * 0.025 * A - W * 0.15, atk * 0.35);
    head.current.rotation.y = -sw * gait.yaw * 0.7 * A + Math.sin(t * 0.6) * 0.15 * (1 - A) - undul * 0.04;
    head.current.rotation.x = -atk * 0.3;
    jaw.current.rotation.x = snap(now, a.attackAt, gait.atkMs) * gait.jawOpen + Math.max(0, Math.sin(t * 0.5) - 0.9) * 1.5;

    const tf = lerp(1.2, 3, W);
    const ta = lerp(0.1, 0.38, W);
    t1.current.rotation.y = -sw * gait.yaw * 1.6 * A + Math.sin(t * tf) * ta * 0.6;
    t2.current.rotation.y = -Math.sin(s.ph - 0.8) * gait.yaw * 2 * A + Math.sin(t * tf - 0.9) * ta;
    if (t3.current) t3.current.rotation.y = -Math.sin(s.ph - 1.6) * gait.yaw * 2.4 * A + Math.sin(t * tf - 1.8) * ta * 1.3;
    if (tongue.current) tongueFlick(s, t, tongue.current);
    if (vines.current) vines.current.rotation.z = Math.sin(t * 2) * 0.03;

    applyHurt(root.current, skin, now, a.hurtAt, slowRef.current ? SLOW_TINT : undefined);
  });

  return (
    <group ref={root}>
      <Joint at={J.body} gref={body}>
        <Parts parts={P.torso} mats={mats} />
        {slowed && (
          <group ref={vines}>
            <Parts parts={P.vines} mats={mats} />
          </group>
        )}
        <Joint at={J.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
          <Joint at={J.jaw} gref={jaw}>
            <Parts parts={P.jaw} mats={mats} />
          </Joint>
          {P.tongue && J.tongue && (
            <Joint at={J.tongue} gref={tongue} visible={false}>
              <Parts parts={P.tongue} mats={mats} shadow={false} />
            </Joint>
          )}
        </Joint>
        <Joint at={J.tail1} gref={t1}>
          <Parts parts={P.tail1} mats={mats} />
          <Joint at={J.tail2} gref={t2}>
            <Parts parts={P.tail2} mats={mats} />
            {P.tail3 && J.tail3 && (
              <Joint at={J.tail3} gref={t3}>
                <Parts parts={P.tail3} mats={mats} />
              </Joint>
            )}
          </Joint>
        </Joint>
        <Joint at={J.legF} gref={fr}>
          <Parts parts={P.legF} mats={mats} />
        </Joint>
        <Joint at={J.legB} gref={br}>
          <Parts parts={P.legB} mats={mats} />
        </Joint>
        <Mirror>
          <Joint at={J.legF} gref={fl}>
            <Parts parts={P.legF} mats={mats} />
          </Joint>
          <Joint at={J.legB} gref={bl}>
            <Parts parts={P.legB} mats={mats} />
          </Joint>
        </Mirror>
      </Joint>
    </group>
  );
}

// ================================================================= TITANOBOA HEAD
const TB = {
  skull: [0, 0.55, -0.1] as V3,
  jaw: [0, 0.5, -0.1] as V3,
  tongue: [0, 0.5, 1.5] as V3,
};
const SK = { c: [0, 0.78, 0.35] as V3, r: [1.0, 0.48, 1.15] as V3 };

/** point + normal on the skull ellipsoid above (x, z) */
function skullSurf(x: number, z: number): { p: V3; n: V3 } {
  const u = x / SK.r[0];
  const w = (z - SK.c[2]) / SK.r[2];
  const v = Math.sqrt(Math.max(0, 1 - u * u - w * w));
  const p: V3 = [x, SK.c[1] + SK.r[1] * v, z];
  const nx = u / SK.r[0];
  const ny = v / SK.r[1];
  const nz = w / SK.r[2];
  const l = Math.hypot(nx, ny, nz) || 1;
  return { p, n: [nx / l, ny / l, nz / l] };
}

const TITANOBOA = once(() => {
  const neck = new Kit()
    .add(G.sphere, 'skin', [0, 0.72, -0.6], [0.95, 0.6, 0.9])
    .add(G.sphere, 'belly', [0, 0.45, -0.45], [0.8, 0.35, 0.8]);
  for (const [x, z, sx, sz] of [
    [0, -0.6, 0.4, 0.35],
    [0.62, -0.5, 0.22, 0.3],
    [-0.62, -0.5, 0.22, 0.3],
  ]) {
    neck.addDir(G.sphere, 'dark', [x, 0.72 + 0.6 * Math.sqrt(Math.max(0, 1 - (x / 0.95) ** 2 - ((z + 0.6) / 0.9) ** 2)) - 0.03, z], [x * 0.6, 1, 0], [sx, 0.06, sz]);
  }

  const skull = new Kit()
    .add(G.sphere, 'skin', SK.c, SK.r)
    .add(G.sphere, 'skin', [0, 0.72, 1.1], [0.72, 0.36, 0.62])
    .add(G.sphere, 'mouth', [0, 0.52, 0.65], [0.82, 0.1, 0.95])
    .add(G.sphere, 'dark', [0.2, 0.9, 1.63], 0.05)
    .add(G.sphere, 'dark', [-0.2, 0.9, 1.63], 0.05);
  for (const [x, z, sx, sz] of [
    [0, 0.05, 0.34, 0.32],
    [0, 0.7, 0.2, 0.18],
    [0.42, -0.2, 0.24, 0.22],
    [-0.42, -0.2, 0.24, 0.22],
    [0.38, 0.45, 0.16, 0.14],
    [-0.38, 0.45, 0.16, 0.14],
  ]) {
    const { p, n } = skullSurf(x, z);
    skull.addDir(G.sphere, 'dark', [p[0], p[1] - 0.025, p[2]], n, [sx, 0.06, sz]);
  }
  for (const s of [-1, 1]) {
    // dark stripe running back from the eye + brow ridge
    skull.add(G.sphere, 'dark', [s * 0.86, 0.92, 0.25], [0.1, 0.08, 0.42], [0, s * 0.25, 0]);
    skull.add(G.box, 'dark', [s * 0.58, 1.14, 0.8], [0.3, 0.07, 0.24], [0, s * 0.35, s * -0.25]);
    skull.add(G.cone, 'tooth', [s * 0.4, 0.42, 1.28], [0.06, 0.34, 0.06], [PI, 0, 0]);
    for (let i = 0; i < 4; i++) skull.add(G.cone, 'tooth', [s * (0.72 - i * 0.07), 0.46, 0.2 + i * 0.25], [0.03, 0.1, 0.03], [PI, 0, 0]);
  }
  addEyes(skull, 0.62, 1.0, 0.8, 0.15, { eye: 'eyeY', slit: true, fwd: 0.6, up: 0.3 });

  const jaw = new Kit()
    .add(G.sphere, 'skin', [0, 0.36, 0.6], [0.85, 0.2, 1.05])
    .add(G.sphere, 'belly', [0, 0.3, 0.62], [0.74, 0.15, 0.95]);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) jaw.add(G.cone, 'tooth', [s * (0.62 - i * 0.08), 0.52, 0.45 + i * 0.28], [0.03, 0.09, 0.03]);
  const tongue = new Kit();
  addTongue(tongue, TB.tongue, 0.6);

  return {
    neck: neck.build(),
    skull: skull.build(),
    jaw: jaw.build(),
    tongue: tongue.build(),
    vines: vineRings([
      { c: [0, 0.72, -0.45], r: [0.98, 0.62] },
      { c: [0, 0.66, 1.15], r: [0.75, 0.42], tilt: 0.1 },
    ]),
  };
});

function TitanoboaHead(props: { mats: SlotMats; skin: THREE.MeshStandardMaterial; animRef: AnimRef; slowed: boolean }) {
  const { mats, skin, animRef, slowed } = props;
  const P = TITANOBOA();
  const root = useRef<Grp>(null!);
  const sway = useRef<Grp>(null!);
  const skull = useRef<Grp>(null!);
  const jaw = useRef<Grp>(null!);
  const tongue = useRef<Grp>(null!);
  const st = useScratch();
  const slowRef = useRef(slowed);
  slowRef.current = slowed;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    s.A = damp(s.A, clamp(a.speed / 3, 0, 1), 5, dt);
    const open = snap(now, a.attackAt, 450);
    const lunge = bump(now, a.attackAt, 450);
    sway.current.rotation.y = Math.sin(t * 2.2) * 0.09 * s.A + Math.sin(t * 0.5) * 0.06;
    sway.current.position.set(0, lunge * 0.45 + Math.sin(t * 1.4) * 0.03, lunge * 0.6);
    skull.current.rotation.x = -open * 0.6;
    jaw.current.rotation.x = open * 0.28;
    tongueFlick(s, t, tongue.current);
    tongue.current.visible = tongue.current.visible && open < 0.1;
    applyHurt(root.current, skin, now, a.hurtAt, slowRef.current ? SLOW_TINT : undefined);
  });

  return (
    <group ref={root}>
      <group ref={sway}>
        <Parts parts={P.neck} mats={mats} />
        {slowed && <Parts parts={P.vines} mats={mats} />}
        <Joint at={TB.skull} gref={skull}>
          <Parts parts={P.skull} mats={mats} />
          <Joint at={TB.tongue} gref={tongue} visible={false}>
            <Parts parts={P.tongue} mats={mats} shadow={false} />
          </Joint>
        </Joint>
        <Joint at={TB.jaw} gref={jaw}>
          <Parts parts={P.jaw} mats={mats} />
        </Joint>
      </group>
    </group>
  );
}

// ================================================================= public
export function EnemyModel(props: { type: EnemyType; animRef: AnimRef; slowed?: boolean }) {
  const { type, animRef, slowed = false } = props;
  const { mats, skin } = useEnemyMats(type);
  switch (type) {
    case 'megalania':
      return (
        <Quadruped P={MEGALANIA()} J={MG} mats={mats} skin={skin} animRef={animRef} slowed={slowed} gait={{ freq: 1.5, yaw: 0.14, atkMs: 300, jawOpen: 0.5 }} />
      );
    case 'sarcosuchus':
      return (
        <Quadruped P={SARCO()} J={SC} mats={mats} skin={skin} animRef={animRef} slowed={slowed} gait={{ freq: 1.6, yaw: 0.07, atkMs: 380, jawOpen: 0.4 }} />
      );
    case 'titanoboa':
      return <TitanoboaHead mats={mats} skin={skin} animRef={animRef} slowed={slowed} />;
  }
}

// ================================================================= TITANOBOA BODY
const SEGMENTS = 22;
const SPACING = 1.1;
const FIRST = 1.35; // distance from the head origin to the first segment
const TRAIL_CAP = 96;
const PUSH_DIST = 0.4;

const _head = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _col = new THREE.Color();

/**
 * The titanoboa's body: ~22 instanced segments following the trail of the head.
 * Render at the SCENE ROOT (not inside the moving head group).
 */
export function TitanoboaBody(props: { headRef: RefObject<THREE.Object3D | null>; color?: string }) {
  const { headRef, color = PAL.titanoboa.skin } = props;

  const { body, saddle } = useMemo(() => {
    const white = mat('#ffffff');
    const b = new THREE.InstancedMesh(G.ball, white, SEGMENTS);
    const s = new THREE.InstancedMesh(G.sphere, white, SEGMENTS);
    for (const m of [b, s]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    const dark = shade(color, -0.5);
    const alt = mix(color, '#8f9a3e', 0.45);
    const band = shade(color, -0.22);
    for (let i = 0; i < SEGMENTS; i++) {
      b.setColorAt(i, _col.set(i % 4 === 3 ? band : i % 2 ? alt : color));
      s.setColorAt(i, _col.set(dark));
    }
    return { body: b, saddle: s };
  }, [color]);
  useEffect(
    () => () => {
      body.dispose();
      saddle.dispose();
    },
    [body, saddle],
  );

  const trail = useMemo(
    () => ({ pts: Array.from({ length: TRAIL_CAP }, () => new THREE.Vector3()), start: 0, n: 0, speed: 0, last: new THREE.Vector3(), init: false }),
    [],
  );

  useFrame((state, delta) => {
    const h = headRef.current;
    if (!h) return;
    const dt = Math.max(1e-3, Math.min(delta, 0.1));
    h.getWorldPosition(_head);
    const tr = trail;
    if (!tr.init) {
      tr.last.copy(_head);
      tr.init = true;
    }
    tr.speed = damp(tr.speed, _head.distanceTo(tr.last) / dt, 4, dt);
    tr.last.copy(_head);
    if (tr.n === 0 || tr.pts[tr.start].distanceTo(_head) > PUSH_DIST) {
      tr.start = (tr.start - 1 + TRAIL_CAP) % TRAIL_CAP;
      tr.pts[tr.start].copy(_head);
      tr.n = Math.min(tr.n + 1, TRAIL_CAP);
    }
    const t = state.clock.elapsedTime;
    const wig = 0.25 + 0.75 * clamp(tr.speed / 3, 0, 1);

    // walk along: head -> newest trail point -> ... -> oldest
    let j = -1; // -1 = the live head position
    let acc = 0; // arc length at the start of the current polyline piece
    _a.copy(_head);
    let pieceLen = 0;
    const nextPoint = () => {
      j++;
      if (j >= tr.n) return false;
      _b.copy(tr.pts[(tr.start + j) % TRAIL_CAP]);
      pieceLen = _a.distanceTo(_b);
      return true;
    };
    let more = nextPoint();
    let prevX = _head.x;
    let prevZ = _head.z;
    let prevY = _head.y + 0.9;
    for (let i = 0; i < SEGMENTS; i++) {
      const d = FIRST + i * SPACING;
      while (more && acc + pieceLen < d) {
        acc += pieceLen;
        _a.copy(_b);
        more = nextPoint();
      }
      let x: number;
      let y: number;
      let z: number;
      let dirX: number;
      let dirZ: number;
      if (more && pieceLen > 1e-5) {
        const u = (d - acc) / pieceLen;
        x = lerp(_a.x, _b.x, u);
        y = lerp(_a.y, _b.y, u);
        z = lerp(_a.z, _b.z, u);
        dirX = (_a.x - _b.x) / pieceLen;
        dirZ = (_a.z - _b.z) / pieceLen;
      } else {
        // trail too short: stack the rest on the last point
        x = _a.x;
        y = _a.y;
        z = _a.z;
        dirX = 0;
        dirZ = 1;
      }
      const r = lerp(1.1, 0.3, i / (SEGMENTS - 1));
      const amp = 0.42 * wig * Math.min(1, (i + 1) / 4);
      const off = Math.sin(d * 0.55 - t * 3.2) * amp;
      x += -dirZ * off;
      z += dirX * off;
      const yy = y + r * 0.8;
      _dummy.position.set(x, yy, z);
      // face toward the previous segment (toward the head)
      if (Math.abs(prevX - x) + Math.abs(prevZ - z) > 1e-3) _dummy.lookAt(prevX, prevY, prevZ);
      else _dummy.rotation.set(0, Math.atan2(dirX, dirZ), 0);
      _dummy.scale.set(r, r * 0.82, r * 0.9 + 0.45);
      _dummy.updateMatrix();
      body.setMatrixAt(i, _dummy.matrix);
      // dark saddle patch on top of each segment
      _dummy.position.y = yy + r * 0.62;
      _dummy.scale.set(r * 0.62, r * 0.28, r * 0.5 + 0.2);
      _dummy.updateMatrix();
      saddle.setMatrixAt(i, _dummy.matrix);
      prevX = x;
      prevY = yy;
      prevZ = z;
    }
    body.instanceMatrix.needsUpdate = true;
    saddle.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={body} />
      <primitive object={saddle} />
    </>
  );
}

// Player dinosaur models. Model space: Y up, facing +Z, feet at y = 0.
import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DINOS, type DinoType } from '../../shared/constants';
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
  membrane,
  once,
  shade,
  snap,
  useInstanceMat,
  type SlotMats,
  type V3,
} from './materials';

type Grp = THREE.Group;
const PI = Math.PI;

// ---------------------------------------------------------------- palettes / materials
const PAL: Record<DinoType, { belly: string; dark: string; extra: string }> = {
  raptor: { belly: '#e3dca4', dark: shade(DINOS.raptor.color, -0.4), extra: '#c9b48a' },
  ankylo: { belly: '#dcc89c', dark: '#6b5232', extra: '#c9b48a' },
  ptero: { belly: '#f2dcb8', dark: shade(DINOS.ptero.color, -0.4), extra: '#efc760' },
  spino: { belly: '#d8dec2', dark: shade(DINOS.spino.color, -0.4), extra: '#c9b48a' },
};

function useDinoMats(type: DinoType, accent: string) {
  const skin = useInstanceMat(mat(DINOS[type].color));
  const mats = useMemo<SlotMats>(() => {
    const p = PAL[type];
    return {
      ...COMMON,
      skin,
      belly: mat(p.belly),
      dark: mat(p.dark),
      beak: mat(p.extra),
      membrane: mat(shade(DINOS[type].color, 0.22)),
      accent: mat(accent),
      accentDark: mat(shade(accent, -0.3)),
    };
  }, [type, accent, skin]);
  return { mats, skin };
}

/** shared per-instance animation scratch */
function useScratch() {
  return useRef({ ph: 0, A: 0, lean: 0, fold: 1, glide: 0, fp: 0, swim: 0, seed: Math.random() * 100 });
}

// ================================================================= RAPTOR
const R = {
  body: [0, 1.0, 0] as V3,
  head: [0, 1.6, 0.95] as V3,
  jaw: [0, 1.58, 1.0] as V3,
  tail1: [0, 1.18, -0.5] as V3,
  tail2: [0, 1.22, -1.12] as V3,
  hip: [0.2, 1.0, -0.02] as V3,
  knee: [0.21, 0.58, 0.12] as V3,
};

const RAPTOR = once(() => {
  const torso = new Kit()
    .add(G.sphere, 'skin', [0, 1.12, 0.1], [0.34, 0.36, 0.72])
    .add(G.sphere, 'belly', [0, 1.02, 0.18], [0.29, 0.27, 0.6])
    .add(G.sphere, 'skin', [0, 1.36, 0.74], [0.17, 0.3, 0.19], [0.55, 0, 0])
    .add(G.sphere, 'skin', [0, 1.5, 0.87], [0.12, 0.17, 0.12], [0.5, 0, 0]);
  // accent stripes: thin upper-hemisphere bands hugging the body
  for (const z of [-0.42, -0.17, 0.08, 0.33]) {
    const f = Math.sqrt(1 - ((z - 0.1) / 0.72) ** 2) * 1.04;
    torso.add(G.hemi, 'accent', [0, 1.12, z], [0.34 * f, 0.36 * f, 0.065]);
  }
  // feather mane down the neck and back
  for (const [y, z, h] of [
    [1.68, 0.86, 0.22],
    [1.6, 0.72, 0.22],
    [1.51, 0.56, 0.2],
    [1.47, 0.4, 0.17],
  ]) {
    torso.add(G.cone4, 'accent', [0, y, z], [0.035, h, 0.08], [-0.95, 0, 0]);
  }
  for (const s of [-1, 1]) {
    torso
      .add(G.sphere, 'skin', [s * 0.24, 1.08, 0.6], [0.05, 0.05, 0.14], [0.6, 0, 0])
      .add(G.box, 'accent', [s * 0.27, 0.97, 0.7], [0.025, 0.17, 0.2], [0.5, 0, 0])
      .add(G.cone, 'claw', [s * 0.27, 0.87, 0.8], [0.02, 0.08, 0.02], [2.2, 0, 0]);
  }

  const head = new Kit()
    .add(G.sphere, 'skin', [0, 1.64, 1.04], [0.16, 0.15, 0.22])
    .add(G.sphere, 'skin', [0, 1.61, 1.27], [0.115, 0.095, 0.22])
    .add(G.box, 'accent', [0, 1.7, 1.18], [0.05, 0.03, 0.26]);
  for (const [y, z] of [
    [1.8, 0.98],
    [1.78, 0.88],
    [1.73, 0.8],
  ]) {
    head.add(G.cone4, 'accent', [0, y, z], [0.03, 0.24, 0.07], [-1.1, 0, 0]);
  }
  addEyes(head, 0.12, 1.69, 1.1, 0.05, { fwd: 0.5 });
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) head.add(G.cone, 'tooth', [s * 0.075, 1.555, 1.12 + i * 0.075], [0.018, 0.05, 0.018], [PI, 0, 0]);
  }

  const jaw = new Kit().add(G.sphere, 'belly', [0, 1.535, 1.2], [0.1, 0.045, 0.24]);
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) jaw.add(G.cone, 'tooth', [s * 0.06, 1.575, 1.15 + i * 0.07], [0.015, 0.04, 0.015]);
  }

  const tail1 = new Kit().add(G.sphere, 'skin', [0, 1.2, -0.85], [0.2, 0.2, 0.42]);
  for (const z of [-0.7, -1.0]) {
    const f = Math.sqrt(1 - ((z + 0.85) / 0.42) ** 2) * 1.05;
    tail1.add(G.hemi, 'accent', [0, 1.2, z], [0.2 * f, 0.2 * f, 0.05]);
  }
  const tail2 = new Kit()
    .add(G.sphere, 'skin', [0, 1.24, -1.42], [0.1, 0.1, 0.34])
    .add(G.hemi, 'accent', [0, 1.24, -1.42], [0.105, 0.105, 0.045])
    .add(G.cone4, 'accent', [0, 1.25, -1.88], [0.1, 0.32, 0.025], [-PI / 2, 0, 0]);

  const leg = new Kit().add(G.sphere, 'skin', [0.21, 0.82, 0.04], [0.12, 0.3, 0.2], [0.25, 0, 0]);
  const knee = new Kit()
    .between(G.cyl, 'skin', [0.21, 0.58, 0.12], [0.21, 0.2, -0.06], 0.065)
    .between(G.cyl, 'skin', [0.21, 0.22, -0.06], [0.21, 0.04, 0.0], 0.05)
    .add(G.box, 'dark', [0.21, 0.03, 0.1], [0.12, 0.06, 0.24])
    .add(G.cone, 'claw', [0.18, 0.03, 0.25], [0.02, 0.07, 0.02], [PI / 2, 0, 0])
    .add(G.cone, 'claw', [0.24, 0.03, 0.25], [0.02, 0.07, 0.02], [PI / 2, 0, 0])
    .add(G.cone, 'claw', [0.165, 0.13, 0.09], [0.03, 0.16, 0.03], [0.7, 0, 0]);

  return { torso: torso.build(), head: head.build(), jaw: jaw.build(), tail1: tail1.build(), tail2: tail2.build(), leg: leg.build(), knee: knee.build() };
});

function Raptor({ mats, skin, animRef }: { mats: SlotMats; skin: THREE.MeshStandardMaterial; animRef: AnimRef }) {
  const P = RAPTOR();
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const jaw = useRef<Grp>(null!);
  const t1 = useRef<Grp>(null!);
  const t2 = useRef<Grp>(null!);
  const hipR = useRef<Grp>(null!);
  const hipL = useRef<Grp>(null!);
  const kneeR = useRef<Grp>(null!);
  const kneeL = useRef<Grp>(null!);
  const st = useScratch();

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    const run = a.mode === ANIM.RUN;
    const swim = a.mode === ANIM.SWIM;
    const targetA = swim ? 0.7 : clamp(a.speed / 5, 0, 1) * (run ? 1 : 0.72);
    s.A = damp(s.A, targetA, 10, dt);
    s.ph += dt * (swim ? 5 : 2 + a.speed * 0.95);
    const A = s.A;
    const sw = Math.sin(s.ph);
    const cw = Math.cos(s.ph);

    hipR.current.rotation.x = sw * 0.75 * A;
    hipL.current.rotation.x = -sw * 0.75 * A;
    kneeR.current.rotation.x = Math.max(0, -cw) * 1.1 * A;
    kneeL.current.rotation.x = Math.max(0, cw) * 1.1 * A;

    const atk = bump(now, a.attackAt);
    s.lean = damp(s.lean, run ? 0.22 : a.speed * 0.015, 6, dt);
    const breathe = Math.sin(t * 2.2) * 0.012;
    body.current.position.set(0, R.body[1] - Math.abs(cw) * 0.07 * A + breathe, atk * 0.4);
    body.current.rotation.x = s.lean + atk * 0.22;

    head.current.rotation.x = -s.lean * 0.8 + Math.sin(s.ph * 2) * 0.04 * A + atk * 0.2;
    head.current.rotation.y = Math.sin(t * 0.6) * 0.35 * (1 - A);
    jaw.current.rotation.x = snap(now, a.attackAt) * 0.75 + Math.max(0, Math.sin(t * 0.9) - 0.96) * 4;

    const tailSway = Math.sin(t * 1.7) * 0.12 * (1 - A) + sw * 0.1 * A;
    t1.current.rotation.y = tailSway;
    t1.current.rotation.x = -s.lean * 0.6 - atk * 0.15;
    t2.current.rotation.y = Math.sin(t * 1.7 - 0.7) * 0.16 * (1 - A) + Math.sin(s.ph - 0.6) * 0.12 * A;

    applyHurt(root.current, skin, now, a.hurtAt);
  });

  const leg = (hip: RefObject<Grp>, knee: RefObject<Grp>) => (
    <Joint at={R.hip} gref={hip}>
      <Parts parts={P.leg} mats={mats} />
      <Joint at={R.knee} gref={knee}>
        <Parts parts={P.knee} mats={mats} />
      </Joint>
    </Joint>
  );

  return (
    <group ref={root}>
      <Joint at={R.body} gref={body}>
        <Parts parts={P.torso} mats={mats} />
        <Joint at={R.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
          <Joint at={R.jaw} gref={jaw}>
            <Parts parts={P.jaw} mats={mats} />
          </Joint>
        </Joint>
        <Joint at={R.tail1} gref={t1}>
          <Parts parts={P.tail1} mats={mats} />
          <Joint at={R.tail2} gref={t2}>
            <Parts parts={P.tail2} mats={mats} />
          </Joint>
        </Joint>
      </Joint>
      {leg(hipR, kneeR)}
      <Mirror>{leg(hipL, kneeL)}</Mirror>
    </group>
  );
}

// ================================================================= ANKYLOSAURUS
const AK = {
  body: [0, 0.62, 0] as V3,
  head: [0, 0.58, 1.2] as V3,
  tail1: [0, 0.62, -1.2] as V3,
  tail2: [0, 0.6, -1.95] as V3,
  legF: [0.5, 0.66, 0.75] as V3,
  legB: [0.52, 0.66, -0.7] as V3,
};
const SH = { y: 0.6, rx: 0.86, ry: 0.72, rz: 1.35 };

function shellPoint(alpha: number, beta: number): { p: V3; n: V3 } {
  const dx = Math.sin(alpha) * Math.cos(beta);
  const dy = Math.cos(alpha) * Math.cos(beta);
  const dz = Math.sin(beta);
  const nx = dx / SH.rx;
  const ny = dy / SH.ry;
  const nz = dz / SH.rz;
  const l = Math.hypot(nx, ny, nz);
  return { p: [SH.rx * dx, SH.y + SH.ry * dy, SH.rz * dz], n: [nx / l, ny / l, nz / l] };
}

const ANKYLO = once(() => {
  const body = new Kit()
    .add(G.sphere, 'belly', [0, 0.62, 0], [0.72, 0.36, 1.2])
    .add(G.hemi, 'skin', [0, SH.y, 0], [SH.rx, SH.ry, SH.rz])
    .add(G.torus, 'dark', [0, SH.y, 0], [SH.rx + 0.01, SH.rz + 0.01, 1], [PI / 2, 0, 0]);
  const spike = (alpha: number, beta: number, s: V3, off: number) => {
    const { p, n } = shellPoint(alpha, beta);
    body.add(G.ico, 'dark', p, s[0] * 1.25);
    body.addDir(G.cone, 'accent', [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n, s);
  };
  for (const beta of [-0.95, -0.5, -0.05, 0.4, 0.85]) spike(0, beta, [0.1, 0.26, 0.1], 0.09);
  for (const side of [-1, 1]) {
    for (const beta of [-0.8, -0.38, 0.05, 0.48, 0.88]) spike(side * 0.62, beta, [0.085, 0.2, 0.085], 0.07);
    for (const beta of [-0.6, -0.15, 0.3, 0.75]) spike(side * 1.12, beta, [0.08, 0.18, 0.08], 0.06);
    for (const beta of [-0.75, -0.3, 0.15, 0.6]) spike(side * 1.5, beta, [0.1, 0.34, 0.1], 0.14);
    spike(side * 1.3, 0.98, [0.11, 0.4, 0.11], 0.16);
  }

  const head = new Kit()
    .add(G.sphere, 'skin', [0, 0.6, 1.25], [0.32, 0.26, 0.3])
    .add(G.ball, 'skin', [0, 0.58, 1.58], [0.34, 0.24, 0.32])
    .add(G.hemi, 'dark', [0, 0.65, 1.56], [0.335, 0.15, 0.315])
    .add(G.box, 'belly', [0, 0.5, 1.86], [0.3, 0.16, 0.16])
    .add(G.box, 'dark', [0, 0.47, 1.94], [0.26, 0.06, 0.04]);
  for (const s of [-1, 1]) {
    head.addDir(G.cone, 'accent', [s * 0.33, 0.73, 1.38], [s * 0.8, 0.35, -0.5], [0.06, 0.26, 0.06]);
    head.addDir(G.cone, 'accent', [s * 0.36, 0.5, 1.5], [s, -0.3, 0], [0.05, 0.16, 0.05]);
  }
  addEyes(head, 0.27, 0.66, 1.68, 0.055, { fwd: 0.7, up: 0.15 });

  const tail1 = new Kit().add(G.sphere, 'skin', [0, 0.62, -1.55], [0.26, 0.2, 0.5]);
  for (const s of [-1, 1]) {
    tail1.addDir(G.cone, 'accent', [s * 0.27, 0.62, -1.45], [s, 0.2, -0.3], [0.05, 0.17, 0.05]);
    tail1.addDir(G.cone, 'accent', [s * 0.22, 0.62, -1.75], [s, 0.2, -0.3], [0.045, 0.15, 0.045]);
  }
  const tail2 = new Kit()
    .add(G.sphere, 'skin', [0, 0.58, -2.3], [0.14, 0.12, 0.45])
    .add(G.dodeca, 'dark', [0.15, 0.56, -2.75], [0.22, 0.17, 0.25])
    .add(G.dodeca, 'dark', [-0.15, 0.56, -2.75], [0.22, 0.17, 0.25])
    .add(G.dodeca, 'skin', [0, 0.6, -2.82], [0.18, 0.18, 0.24])
    .add(G.ico, 'accent', [0.32, 0.56, -2.75], 0.08)
    .add(G.ico, 'accent', [-0.32, 0.56, -2.75], 0.08)
    .add(G.ico, 'accent', [0, 0.76, -2.8], 0.08);

  const mkLeg = (x: number, z: number, r: number) =>
    new Kit()
      .add(G.cyl, 'skin', [x, 0.38, z], [r, 0.6, r])
      .add(G.cyl, 'dark', [x, 0.06, z + 0.03], [r * 1.2, 0.12, r * 1.3])
      .add(G.cone, 'claw', [x - r * 0.6, 0.05, z + r * 1.35], [0.035, 0.09, 0.035], [PI / 2, 0, 0])
      .add(G.cone, 'claw', [x, 0.05, z + r * 1.45], [0.035, 0.09, 0.035], [PI / 2, 0, 0])
      .add(G.cone, 'claw', [x + r * 0.6, 0.05, z + r * 1.35], [0.035, 0.09, 0.035], [PI / 2, 0, 0])
      .build();

  return {
    body: body.build(),
    head: head.build(),
    tail1: tail1.build(),
    tail2: tail2.build(),
    legF: mkLeg(AK.legF[0], AK.legF[2], 0.15),
    legB: mkLeg(AK.legB[0], AK.legB[2], 0.17),
  };
});

function Ankylo({ mats, skin, animRef }: { mats: SlotMats; skin: THREE.MeshStandardMaterial; animRef: AnimRef }) {
  const P = ANKYLO();
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const t1 = useRef<Grp>(null!);
  const t2 = useRef<Grp>(null!);
  const fr = useRef<Grp>(null!);
  const fl = useRef<Grp>(null!);
  const br = useRef<Grp>(null!);
  const bl = useRef<Grp>(null!);
  const st = useScratch();

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    const swim = a.mode === ANIM.SWIM;
    s.A = damp(s.A, swim ? 0.8 : clamp(a.speed / 3, 0, 1), 8, dt);
    s.ph += dt * (swim ? 4 : 2.5 + a.speed * 1.1);
    const A = s.A;
    const sw = Math.sin(s.ph) * 0.45 * A;
    fr.current.rotation.x = sw;
    bl.current.rotation.x = sw;
    fl.current.rotation.x = -sw;
    br.current.rotation.x = -sw;

    // tail quake: big side swing + slam
    const tq = bump(now, a.attackAt, 450);
    const tp = Math.max(0, (now - a.attackAt) / 450);
    const swing = tp < 1 ? Math.sin(tp * PI * 2) : 0;
    body.current.position.y = AK.body[1] + Math.abs(Math.cos(s.ph)) * 0.04 * A + Math.sin(t * 1.8) * 0.01 - tq * 0.06;
    body.current.rotation.z = Math.sin(s.ph) * 0.04 * A;
    body.current.rotation.x = -tq * 0.12;
    head.current.rotation.x = Math.sin(s.ph * 2) * 0.05 * A + tq * 0.2;
    head.current.rotation.y = Math.sin(t * 0.5) * 0.3 * (1 - A);

    t1.current.rotation.y = Math.sin(t * 1.3) * 0.1 + Math.sin(s.ph) * 0.12 * A + swing * 0.75;
    t1.current.rotation.x = -tq * 0.35;
    t2.current.rotation.y = Math.sin(t * 1.3 - 0.8) * 0.14 + swing * 0.9;
    t2.current.rotation.x = tq * 0.25;

    applyHurt(root.current, skin, now, a.hurtAt);
  });

  return (
    <group ref={root}>
      <Joint at={AK.body} gref={body}>
        <Parts parts={P.body} mats={mats} />
        <Joint at={AK.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
        </Joint>
        <Joint at={AK.tail1} gref={t1}>
          <Parts parts={P.tail1} mats={mats} />
          <Joint at={AK.tail2} gref={t2}>
            <Parts parts={P.tail2} mats={mats} />
          </Joint>
        </Joint>
      </Joint>
      <Joint at={AK.legF} gref={fr}>
        <Parts parts={P.legF} mats={mats} />
      </Joint>
      <Joint at={AK.legB} gref={br}>
        <Parts parts={P.legB} mats={mats} />
      </Joint>
      <Mirror>
        <Joint at={AK.legF} gref={fl}>
          <Parts parts={P.legF} mats={mats} />
        </Joint>
        <Joint at={AK.legB} gref={bl}>
          <Parts parts={P.legB} mats={mats} />
        </Joint>
      </Mirror>
    </group>
  );
}

// ================================================================= PTERANODON
const PT = {
  body: [0, 0.62, 0] as V3,
  head: [0, 0.88, 0.8] as V3,
  jaw: [0, 0.87, 0.92] as V3,
  shoulder: [0.16, 0.74, 0.38] as V3,
  wrist: [0.16 + 0.95, 0.76, 0.42] as V3,
  hip: [0.12, 0.55, -0.15] as V3,
};
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const PTERO = once(() => {
  const body = new Kit()
    .add(G.sphere, 'skin', [0, 0.66, 0.12], [0.22, 0.22, 0.48])
    .add(G.sphere, 'belly', [0, 0.6, 0.15], [0.19, 0.18, 0.4])
    .add(G.sphere, 'skin', [0, 0.8, 0.6], [0.09, 0.09, 0.24], [-0.45, 0, 0])
    .add(G.box, 'accent', [0, 0.865, 0.12], [0.08, 0.04, 0.55])
    .add(G.cone, 'skin', [0, 0.66, -0.42], [0.05, 0.22, 0.05], [-PI / 2, 0, 0]);

  const head = new Kit()
    .add(G.sphere, 'skin', [0, 0.93, 0.86], [0.11, 0.12, 0.16])
    .addDir(G.cone4, 'beak', [0, 0.9, 1.3], [0, 0, 1], [0.07, 0.76, 0.06])
    .addDir(G.cone4, 'accent', [0, 1.15, 0.5], [0, 0.42, -0.9], [0.03, 0.72, 0.13])
    .addDir(G.cone4, 'accentDark', [0, 1.0, 0.72], [0, 0.6, -0.8], [0.04, 0.22, 0.08]);
  addEyes(head, 0.09, 0.97, 0.92, 0.042, { fwd: 0.3, up: 0.15 });
  const jaw = new Kit().addDir(G.cone4, 'beak', [0, 0.85, 1.24], [0, 0, 1], [0.055, 0.62, 0.04]);

  // wings (right side; the left one is mirrored)
  const S = PT.shoulder;
  const W = PT.wrist;
  const inner = new Kit()
    .add(membrane([add3(S, [0, 0, 0.06]), W, add3(S, [0.95, 0, -0.28]), add3(S, [0, -0.02, -0.62])], [
      [0, 1, 2],
      [0, 2, 3],
    ]), 'membrane')
    .between(G.cyl, 'skin', S, W, 0.045)
    .add(G.sphere, 'skin', W, 0.06);
  const T = add3(W, [1.1, 0, -0.44]);
  const Rr = add3(W, [0, -0.01, -0.32]);
  const P1 = lerp3(W, T, 0.62);
  const P2 = lerp3(Rr, T, 0.62);
  const outer = new Kit()
    .add(membrane([W, P1, P2, Rr], [
      [0, 1, 2],
      [0, 2, 3],
    ]), 'membrane')
    .add(membrane([P1, T, P2], [[0, 1, 2]]), 'accent')
    .between(G.cyl, 'skin', W, T, 0.03)
    .add(G.cone, 'claw', add3(W, [0.02, 0.0, 0.08]), [0.02, 0.08, 0.02], [PI / 2, 0, 0]);

  const H = PT.hip;
  const leg = new Kit()
    .add(G.sphere, 'skin', [H[0], 0.45, -0.12], [0.06, 0.14, 0.08])
    .between(G.cyl, 'skin', [H[0], 0.36, -0.1], [H[0], 0.05, -0.12], 0.03)
    .add(G.box, 'dark', [H[0], 0.02, -0.05], [0.09, 0.04, 0.16]);

  return { body: body.build(), head: head.build(), jaw: jaw.build(), inner: inner.build(), outer: outer.build(), leg: leg.build() };
});

function Ptero({ mats, skin, animRef }: { mats: SlotMats; skin: THREE.MeshStandardMaterial; animRef: AnimRef }) {
  const P = PTERO();
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const jaw = useRef<Grp>(null!);
  const inR = useRef<Grp>(null!);
  const inL = useRef<Grp>(null!);
  const outR = useRef<Grp>(null!);
  const outL = useRef<Grp>(null!);
  const hipR = useRef<Grp>(null!);
  const hipL = useRef<Grp>(null!);
  const st = useScratch();

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    const fly = a.mode === ANIM.FLY;
    s.fold = damp(s.fold, fly ? 0 : 1, 6, dt);
    s.glide = damp(s.glide, fly && a.speed > 6.5 ? 1 : 0, 2, dt);
    const f = s.fold;
    const g = s.glide;
    const atk = bump(now, a.attackAt, 400);
    const famp = lerp(0.72, 0.2, g) * (1 + atk * 0.7);
    s.fp += dt * lerp(10, 4.5, g) * (1 + atk * 0.5);
    const flap = Math.sin(s.fp) * famp + 0.08;
    const flap2 = Math.sin(s.fp - 0.8) * famp * 0.55;

    const Aw = clamp(a.speed / 3, 0, 1) * f;
    s.A = damp(s.A, Aw, 8, dt);
    s.ph += dt * (3 + a.speed * 1.6);
    const wad = Math.sin(s.ph);

    const wings: [THREE.Group, THREE.Group, number][] = [
      [inR.current, outR.current, 0],
      [inL.current, outL.current, PI],
    ];
    for (const [inn, out, off] of wings) {
      inn.rotation.set(Math.sin(s.ph + off) * 0.35 * s.A * f, 0.35 * f, lerp(flap, -1.25, f));
      out.rotation.set(0, 2.75 * f, lerp(flap2, 0.15, f));
    }
    hipR.current.rotation.x = lerp(1.35, Math.sin(s.ph + PI / 2) * 0.5 * s.A, f);
    hipL.current.rotation.x = lerp(1.35, Math.sin(s.ph + PI * 1.5) * 0.5 * s.A, f);

    body.current.rotation.x = lerp(0.04 + atk * 0.25, -0.35, f);
    body.current.position.y = PT.body[1] + (1 - f) * -Math.sin(s.fp) * 0.07 * famp + f * Math.abs(wad) * 0.03 * s.A;
    root.current.rotation.z = wad * 0.07 * s.A + (1 - f) * Math.sin(t * 0.7) * 0.05;
    head.current.rotation.x = f * 0.32 + atk * 0.35 + Math.sin(s.ph * 2) * 0.05 * s.A;
    head.current.rotation.y = Math.sin(t * 0.55) * 0.4 * (1 - s.A) * f;
    jaw.current.rotation.x = snap(now, a.attackAt) * 0.5 + Math.max(0, Math.sin(t * 0.6) - 0.97) * 10;

    applyHurt(root.current, skin, now, a.hurtAt);
  });

  const wing = (inn: RefObject<Grp>, out: RefObject<Grp>) => (
    <Joint at={PT.shoulder} gref={inn}>
      <Parts parts={P.inner} mats={mats} />
      <Joint at={PT.wrist} gref={out}>
        <Parts parts={P.outer} mats={mats} />
      </Joint>
    </Joint>
  );

  return (
    <group ref={root}>
      <Joint at={PT.body} gref={body}>
        <Parts parts={P.body} mats={mats} />
        <Joint at={PT.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
          <Joint at={PT.jaw} gref={jaw}>
            <Parts parts={P.jaw} mats={mats} />
          </Joint>
        </Joint>
        {wing(inR, outR)}
        <Mirror>{wing(inL, outL)}</Mirror>
      </Joint>
      <Joint at={PT.hip} gref={hipR}>
        <Parts parts={P.leg} mats={mats} />
      </Joint>
      <Mirror>
        <Joint at={PT.hip} gref={hipL}>
          <Parts parts={P.leg} mats={mats} />
        </Joint>
      </Mirror>
    </group>
  );
}

// ================================================================= SPINOSAURUS
const SP = {
  body: [0, 1.15, 0] as V3,
  head: [0, 1.82, 1.85] as V3,
  jaw: [0, 1.76, 1.9] as V3,
  tail1: [0, 1.32, -0.75] as V3,
  tail2: [0, 1.28, -1.85] as V3,
  tail3: [0, 1.2, -2.95] as V3,
  hip: [0.33, 1.15, -0.1] as V3,
  knee: [0.35, 0.62, 0.12] as V3,
};

function sailGeometry(z0: number, z1: number, height: number, depth: number, spikes: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(z0, -0.15);
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let h = height * Math.pow(Math.sin(PI * clamp(u * 0.94 + 0.03, 0, 1)), 0.75);
    if (spikes) h += i % 2 === 0 ? 0.07 : -0.03;
    shape.lineTo(lerp(z0, z1, u), Math.max(0, h));
  }
  shape.lineTo(z1, -0.15);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-PI / 2);
  return g;
}

const SPINO = once(() => {
  const torso = new Kit()
    .add(G.sphere, 'skin', [0, 1.3, 0.3], [0.5, 0.55, 1.15])
    .add(G.sphere, 'belly', [0, 1.17, 0.4], [0.42, 0.42, 0.95])
    .add(G.sphere, 'skin', [0, 1.5, 1.25], [0.32, 0.4, 0.42], [0.5, 0, 0])
    .add(G.sphere, 'skin', [0, 1.72, 1.62], [0.22, 0.26, 0.3], [0.9, 0, 0])
    .add(sailGeometry(-0.75, 1.1, 0.95, 0.06, true), 'accent', [0, 1.5, 0])
    .add(sailGeometry(-0.6, 0.95, 0.32, 0.1, false), 'accentDark', [0, 1.5, 0]);
  for (const s of [-1, 1]) {
    for (const [y, z] of [
      [1.38, 0.1],
      [1.48, -0.3],
      [1.22, 0.55],
      [1.5, 0.6],
    ]) {
      torso.add(G.sphere, 'dark', [s * (0.5 * Math.sqrt(Math.max(0, 1 - ((y - 1.3) / 0.55) ** 2 - ((z - 0.3) / 1.15) ** 2)) - 0.01), y, z], [0.04, 0.08, 0.11]);
    }
    torso
      .add(G.sphere, 'skin', [s * 0.36, 1.25, 1.35], [0.07, 0.17, 0.08], [0.6, 0, 0])
      .add(G.sphere, 'skin', [s * 0.36, 1.08, 1.5], [0.05, 0.13, 0.06], [-0.4, 0, 0])
      .add(G.cone, 'claw', [s * 0.36, 0.98, 1.6], [0.025, 0.09, 0.025], [2.4, 0, 0]);
  }

  const head = new Kit()
    .add(G.sphere, 'skin', [0, 1.87, 1.98], [0.22, 0.2, 0.3])
    .addDir(G.taper4, 'skin', [0, 1.83, 2.5], [0, 0, 1], [0.2, 0.85, 0.13])
    .add(G.sphere, 'skin', [0, 1.84, 2.93], [0.11, 0.09, 0.1])
    .add(G.cone4, 'accent', [0, 2.07, 1.95], [0.05, 0.18, 0.12], [-0.4, 0, 0])
    .add(G.box, 'accent', [0, 1.92, 2.4], [0.04, 0.03, 0.5]);
  addEyes(head, 0.15, 1.97, 2.05, 0.055, { fwd: 0.4, up: 0.3 });
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) head.add(G.cone, 'tooth', [s * 0.09, 1.765, 2.25 + i * 0.12], [0.02, 0.07, 0.02], [PI, 0, 0]);
  }
  const jaw = new Kit()
    .addDir(G.taper4, 'belly', [0, 1.72, 2.45], [0, 0, 1], [0.17, 0.95, 0.08])
    .add(G.sphere, 'skin', [0, 1.74, 2.0], [0.18, 0.1, 0.25]);
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) jaw.add(G.cone, 'tooth', [s * 0.075, 1.78, 2.3 + i * 0.12], [0.018, 0.06, 0.018]);
  }

  const tail1 = new Kit().add(G.sphere, 'skin', [0, 1.3, -1.25], [0.38, 0.4, 0.75]);
  const tail2 = new Kit()
    .add(G.sphere, 'skin', [0, 1.24, -2.35], [0.22, 0.26, 0.7])
    .add(G.sphere, 'accent', [0, 1.5, -2.4], [0.035, 0.18, 0.55]);
  const tail3 = new Kit()
    .add(G.sphere, 'skin', [0, 1.16, -3.4], [0.12, 0.16, 0.55])
    .add(G.sphere, 'accent', [0, 1.38, -3.4], [0.03, 0.22, 0.5])
    .add(G.sphere, 'accent', [0, 0.98, -3.45], [0.03, 0.13, 0.4]);

  const x = SP.knee[0];
  const leg = new Kit().add(G.sphere, 'skin', [x, 0.92, -0.02], [0.2, 0.4, 0.3], [0.2, 0, 0]);
  const knee = new Kit()
    .between(G.cyl, 'skin', SP.knee, [x, 0.17, -0.1], 0.1)
    .between(G.cyl, 'skin', [x, 0.2, -0.1], [x, 0.05, 0.0], 0.08)
    .add(G.box, 'dark', [x, 0.035, 0.12], [0.24, 0.07, 0.34]);
  for (const dx of [-0.08, 0, 0.08]) knee.add(G.cone, 'claw', [x + dx, 0.04, 0.31], [0.035, 0.09, 0.035], [PI / 2, 0, 0]);

  return {
    torso: torso.build(),
    head: head.build(),
    jaw: jaw.build(),
    tail1: tail1.build(),
    tail2: tail2.build(),
    tail3: tail3.build(),
    leg: leg.build(),
    knee: knee.build(),
  };
});

function Spino({ mats, skin, animRef }: { mats: SlotMats; skin: THREE.MeshStandardMaterial; animRef: AnimRef }) {
  const P = SPINO();
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const jaw = useRef<Grp>(null!);
  const t1 = useRef<Grp>(null!);
  const t2 = useRef<Grp>(null!);
  const t3 = useRef<Grp>(null!);
  const hipR = useRef<Grp>(null!);
  const hipL = useRef<Grp>(null!);
  const kneeR = useRef<Grp>(null!);
  const kneeL = useRef<Grp>(null!);
  const st = useScratch();

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    const swimming = a.mode === ANIM.SWIM;
    s.swim = damp(s.swim, swimming ? 1 : 0, 4, dt);
    const W = s.swim;
    s.A = damp(s.A, swimming ? 0 : clamp(a.speed / 4, 0, 1) * (a.mode === ANIM.RUN ? 1 : 0.75), 8, dt);
    const A = s.A;
    s.ph += dt * (2 + a.speed * 0.8);
    const sw = Math.sin(s.ph);
    const cw = Math.cos(s.ph);

    const paddle = Math.sin(t * 4) * 0.35 * W;
    hipR.current.rotation.x = sw * 0.6 * A + W * 0.7 + paddle;
    hipL.current.rotation.x = -sw * 0.6 * A + W * 0.7 - paddle;
    kneeR.current.rotation.x = Math.max(0, -cw) * 0.9 * A + W * 0.5;
    kneeL.current.rotation.x = Math.max(0, cw) * 0.9 * A + W * 0.5;

    const atk = bump(now, a.attackAt);
    s.lean = damp(s.lean, a.mode === ANIM.RUN ? 0.12 : a.speed * 0.01, 5, dt);
    root.current.position.y = -0.62 * W;
    body.current.position.set(0, SP.body[1] - Math.abs(cw) * 0.06 * A + Math.sin(t * 1.9) * 0.015, atk * 0.35);
    body.current.rotation.set(s.lean + atk * 0.15 + W * 0.05, Math.sin(t * 2.2) * 0.09 * W, Math.sin(t * 2) * 0.06 * W + sw * 0.03 * A);

    head.current.rotation.x = -s.lean * 0.7 + atk * 0.25 - W * 0.08;
    head.current.rotation.y = Math.sin(t * 0.5) * 0.3 * (1 - A) * (1 - W) - Math.sin(t * 2.2) * 0.08 * W;
    jaw.current.rotation.x = snap(now, a.attackAt) * 0.6 + Math.max(0, Math.sin(t * 0.7) - 0.95) * 5;

    const tf = lerp(1.4, 3.2, W);
    const ta = lerp(0.1, 0.42, W);
    t1.current.rotation.y = Math.sin(t * tf) * ta * 0.6 + sw * 0.07 * A;
    t2.current.rotation.y = Math.sin(t * tf - 0.8) * ta;
    t3.current.rotation.y = Math.sin(t * tf - 1.6) * ta * 1.3;
    t1.current.rotation.x = -s.lean * 0.5;

    applyHurt(root.current, skin, now, a.hurtAt);
  });

  const leg = (hip: RefObject<Grp>, knee: RefObject<Grp>) => (
    <Joint at={SP.hip} gref={hip}>
      <Parts parts={P.leg} mats={mats} />
      <Joint at={SP.knee} gref={knee}>
        <Parts parts={P.knee} mats={mats} />
      </Joint>
    </Joint>
  );

  return (
    <group ref={root}>
      <Joint at={SP.body} gref={body}>
        <Parts parts={P.torso} mats={mats} />
        <Joint at={SP.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
          <Joint at={SP.jaw} gref={jaw}>
            <Parts parts={P.jaw} mats={mats} />
          </Joint>
        </Joint>
        <Joint at={SP.tail1} gref={t1}>
          <Parts parts={P.tail1} mats={mats} />
          <Joint at={SP.tail2} gref={t2}>
            <Parts parts={P.tail2} mats={mats} />
            <Joint at={SP.tail3} gref={t3}>
              <Parts parts={P.tail3} mats={mats} />
            </Joint>
          </Joint>
        </Joint>
      </Joint>
      {leg(hipR, kneeR)}
      <Mirror>{leg(hipL, kneeL)}</Mirror>
    </group>
  );
}

// ================================================================= public
/** Approximate model heights (top of head/sail) for placing name tags / health bars. */
export const DINO_HEIGHT: Record<DinoType, number> = { raptor: 1.9, ankylo: 1.6, ptero: 1.5, spino: 2.6 };

export function DinoModel(props: { type: DinoType; accent: string; animRef: AnimRef }) {
  const { type, accent, animRef } = props;
  const { mats, skin } = useDinoMats(type, accent);
  switch (type) {
    case 'raptor':
      return <Raptor mats={mats} skin={skin} animRef={animRef} />;
    case 'ankylo':
      return <Ankylo mats={mats} skin={skin} animRef={animRef} />;
    case 'ptero':
      return <Ptero mats={mats} skin={skin} animRef={animRef} />;
    case 'spino':
      return <Spino mats={mats} skin={skin} animRef={animRef} />;
  }
}

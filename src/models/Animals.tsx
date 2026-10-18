// Farm animal models. Model space: Y up, facing +Z, feet at y = 0.
import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AnimalType } from '../../shared/constants';
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
  clamp,
  damp,
  glowMat,
  mat,
  once,
  useInstanceMat,
  type SlotMats,
  type V3,
} from './materials';

type Grp = THREE.Group;
const PI = Math.PI;

/** Approximate model heights (top of head) for placing markers / bars. */
export const ANIMAL_MODEL_HEIGHT: Record<AnimalType, number> = { dodo: 0.95, mammoth: 1.95 };

// ---------------------------------------------------------------- hungry "!" marker
const BANG = once(() =>
  new Kit()
    .add(G.box, 'bang', [0, 0.2, 0], [0.11, 0.34, 0.11])
    .add(G.box, 'bang', [0, -0.07, 0], [0.11, 0.11, 0.11])
    .add(G.box, 'bangEdge', [0, 0.2, 0], [0.15, 0.38, 0.07])
    .add(G.box, 'bangEdge', [0, -0.07, 0], [0.15, 0.15, 0.07])
    .build(),
);
const BANG_MATS: SlotMats = { bang: glowMat('#ffcf3a'), bangEdge: glowMat('#d8371f') };

function HungryMark({ y }: { y: number }) {
  const g = useRef<Grp>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.position.y = y + Math.sin(t * 3) * 0.08;
    g.current.rotation.y = t * 1.6;
  });
  return (
    <group ref={g} position={[0, y, 0]}>
      <Parts parts={BANG()} mats={BANG_MATS} shadow={false} />
    </group>
  );
}

function useScratch() {
  return useRef({ ph: 0, A: 0, droop: 0, peckAt: -10, nextPeck: 2 + Math.random() * 4, seed: Math.random() * 100 });
}

// ================================================================= DODO
const DD = {
  body: [0, 0.4, 0] as V3,
  head: [0, 0.62, 0.2] as V3,
  hip: [0.13, 0.26, 0] as V3,
};

const DODO = once(() => {
  const body = new Kit()
    .add(G.ball, 'skin', [0, 0.45, -0.02], [0.33, 0.32, 0.38])
    .add(G.sphere, 'belly', [0, 0.38, 0.07], [0.27, 0.24, 0.3])
    .add(G.sphere, 'tail', [0, 0.6, -0.38], 0.1)
    .add(G.sphere, 'tail', [0.06, 0.69, -0.42], 0.075)
    .add(G.sphere, 'tail', [-0.055, 0.71, -0.36], 0.065)
    .add(G.sphere, 'tail', [0, 0.79, -0.31], 0.05)
    .add(G.sphere, 'tail', [0, 0.82, -0.25], 0.035);
  for (const s of [-1, 1]) {
    body.add(G.sphere, 'dark', [s * 0.3, 0.48, -0.04], [0.06, 0.15, 0.22], [0.3, 0, s * 0.25]);
    body.add(G.sphere, 'tail', [s * 0.31, 0.4, -0.18], [0.04, 0.06, 0.08], [0.3, 0, s * 0.25]);
  }
  const head = new Kit()
    .add(G.sphere, 'skin', [0, 0.66, 0.22], [0.13, 0.17, 0.13])
    .add(G.ball, 'skin', [0, 0.8, 0.27], 0.17)
    .add(G.sphere, 'face', [0, 0.8, 0.35], [0.14, 0.12, 0.1])
    .add(G.sphere, 'beak', [0, 0.78, 0.5], [0.08, 0.075, 0.17])
    .add(G.sphere, 'beak', [0, 0.73, 0.47], [0.065, 0.04, 0.13])
    .add(G.cone, 'beakTip', [0, 0.73, 0.65], [0.05, 0.11, 0.05], [PI * 0.72, 0, 0])
    .add(G.sphere, 'dark', [0, 0.95, 0.22], [0.06, 0.04, 0.08]);
  addEyes(head, 0.12, 0.84, 0.34, 0.04, { fwd: 0.4 });
  const H = DD.hip;
  const leg = new Kit().between(G.cyl, 'leg', H, [H[0], 0.03, 0.02], 0.03);
  for (const a of [-0.45, 0, 0.45]) leg.add(G.box, 'leg', [H[0] + Math.sin(a) * 0.06, 0.015, 0.02 + Math.cos(a) * 0.06], [0.03, 0.03, 0.13], [0, a, 0]);
  return { body: body.build(), head: head.build(), leg: leg.build() };
});

function Dodo({ animRef, hungry, mats, skin }: { animRef: AnimRef; hungry: boolean; mats: SlotMats; skin: THREE.MeshStandardMaterial }) {
  const P = DODO();
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const hipR = useRef<Grp>(null!);
  const hipL = useRef<Grp>(null!);
  const st = useScratch();
  const hungryRef = useRef(hungry);
  hungryRef.current = hungry;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    s.A = damp(s.A, clamp(a.speed / 1.2, 0, 1), 8, dt);
    s.droop = damp(s.droop, hungryRef.current ? 1 : 0, 3, dt);
    const A = s.A;
    s.ph += dt * (5 + a.speed * 5);
    const sw = Math.sin(s.ph);
    hipR.current.rotation.x = sw * 0.6 * A;
    hipL.current.rotation.x = -sw * 0.6 * A;
    body.current.rotation.z = sw * 0.12 * A;
    body.current.position.y = DD.body[1] + Math.abs(Math.cos(s.ph)) * 0.04 * A;

    // idle pecking at the ground
    if (t > s.nextPeck) {
      s.peckAt = t;
      s.nextPeck = t + 2.5 + Math.random() * 5;
    }
    const pk = (t - s.peckAt) / 0.5;
    const peck = A < 0.2 && pk >= 0 && pk < 1 ? Math.sin(pk * PI) : 0;
    head.current.position.z = DD.head[2] + Math.sin(s.ph * 2) * 0.05 * A;
    head.current.rotation.x = peck * 0.9 + s.droop * 0.4 + Math.sin(s.ph * 2) * 0.08 * A;
    head.current.rotation.y = Math.sin(t * 0.9) * 0.4 * (1 - A) * (1 - s.droop);
    applyHurt(root.current, skin, now, a.hurtAt);
  });

  return (
    <group ref={root}>
      <Joint at={DD.body} gref={body}>
        <Parts parts={P.body} mats={mats} />
        <Joint at={DD.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
        </Joint>
      </Joint>
      <Joint at={DD.hip} gref={hipR}>
        <Parts parts={P.leg} mats={mats} />
      </Joint>
      <Mirror>
        <Joint at={DD.hip} gref={hipL}>
          <Parts parts={P.leg} mats={mats} />
        </Joint>
      </Mirror>
      {hungry && <HungryMark y={1.25} />}
    </group>
  );
}

// ================================================================= MAMMOTH CALF
const MM = {
  body: [0, 1.0, 0] as V3,
  head: [0, 1.35, 0.7] as V3,
  ear: [0.36, 1.52, 0.76] as V3,
  trunk: [
    [0, 1.3, 1.15],
    [0, 1.05, 1.25],
    [0, 0.82, 1.28],
    [0, 0.62, 1.26],
  ] as V3[],
  legF: [0.38, 0.72, 0.45] as V3,
  legB: [0.38, 0.72, -0.45] as V3,
};

const MAMMOTH = once(() => {
  const body = new Kit()
    .add(G.ball, 'skin', [0, 1.05, -0.05], [0.7, 0.62, 0.85])
    .add(G.ball, 'furDark', [0, 1.48, 0.15], [0.5, 0.3, 0.55])
    .add(G.ball, 'furDark', [0, 0.78, 0], [0.55, 0.35, 0.72])
    .add(G.ico, 'furLight', [0, 1.42, -0.35], [0.45, 0.3, 0.45])
    .between(G.cyl, 'skin', [0, 1.1, -0.85], [0, 0.85, -0.98], 0.05)
    .add(G.ico, 'furDark', [0, 0.82, -1.0], 0.08);
  for (const s of [-1, 1]) {
    body.add(G.ico, 'furLight', [s * 0.42, 0.98, 0.28], 0.42).add(G.ico, 'fur2', [s * 0.4, 0.93, -0.38], 0.43);
    // shaggy skirt of fur
    for (let i = 0; i < 4; i++) {
      const z = -0.55 + i * 0.36;
      body.add(G.cone, 'furDark', [s * 0.58, 0.6, z], [0.13, 0.32, 0.13], [PI, 0, s * -0.25]);
    }
  }
  const head = new Kit()
    .add(G.ball, 'skin', [0, 1.42, 0.85], [0.4, 0.42, 0.38])
    .add(G.ball, 'furDark', [0, 1.74, 0.78], [0.28, 0.2, 0.26])
    .add(G.ball, 'furLight', [0, 1.48, 0.62], [0.42, 0.36, 0.3])
    .add(G.cone, 'furDark', [0.06, 1.95, 0.8], [0.06, 0.14, 0.06], [-0.3, 0, -0.3])
    .add(G.cone, 'furDark', [-0.05, 1.94, 0.76], [0.05, 0.12, 0.05], [-0.4, 0, 0.3]);
  addEyes(head, 0.25, 1.5, 1.1, 0.055, { fwd: 0.7 });
  for (const s of [-1, 1]) {
    head.addDir(G.cone, 'tusk', [s * 0.19, 1.16, 1.15], [s * 0.3, -0.5, 1], [0.05, 0.25, 0.05]);
    head.addDir(G.cone, 'tusk', [s * 0.26, 1.13, 1.3], [s * 0.3, 0.7, 0.8], [0.035, 0.15, 0.035]);
  }
  const ear = new Kit().add(G.sphere, 'ear', [0.45, 1.42, 0.72], [0.06, 0.22, 0.18], [0, 0, 0.2]);
  const T = MM.trunk;
  const ends: V3[] = [T[1], T[2], T[3], [0, 0.47, 1.3]];
  const radii = [0.13, 0.11, 0.09, 0.07];
  const trunk = T.map((p, i) => {
    const k = new Kit().between(G.cyl, 'trunk', p, ends[i], radii[i]).add(G.sphere, 'trunk', ends[i], radii[i] * 0.95);
    if (i === 3) k.add(G.sphere, 'furDark', [0, 0.46, 1.32], [0.06, 0.03, 0.04]);
    return k.build();
  });
  const mkLeg = (x: number, z: number) =>
    new Kit()
      .add(G.cyl, 'skin', [x, 0.4, z], [0.17, 0.72, 0.17])
      .add(G.ico, 'furDark', [x, 0.5, z], [0.22, 0.2, 0.22])
      .add(G.cyl, 'foot', [x, 0.06, z], [0.18, 0.12, 0.18])
      .add(G.sphere, 'tusk', [x - 0.08, 0.06, z + 0.16], 0.04)
      .add(G.sphere, 'tusk', [x + 0.08, 0.06, z + 0.16], 0.04)
      .build();
  return { body: body.build(), head: head.build(), ear: ear.build(), trunk, legF: mkLeg(MM.legF[0], MM.legF[2]), legB: mkLeg(MM.legB[0], MM.legB[2]) };
});

function Mammoth({ animRef, hungry, mats, skin }: { animRef: AnimRef; hungry: boolean; mats: SlotMats; skin: THREE.MeshStandardMaterial }) {
  const P = MAMMOTH();
  const root = useRef<Grp>(null!);
  const body = useRef<Grp>(null!);
  const head = useRef<Grp>(null!);
  const earR = useRef<Grp>(null!);
  const earL = useRef<Grp>(null!);
  const tr0 = useRef<Grp>(null!);
  const tr1 = useRef<Grp>(null!);
  const tr2 = useRef<Grp>(null!);
  const tr3 = useRef<Grp>(null!);
  const fr = useRef<Grp>(null!);
  const fl = useRef<Grp>(null!);
  const br = useRef<Grp>(null!);
  const bl = useRef<Grp>(null!);
  const st = useScratch();
  const hungryRef = useRef(hungry);
  hungryRef.current = hungry;
  const trunkRefs = [tr0, tr1, tr2, tr3];

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const a = animRef.current;
    const s = st.current;
    const now = performance.now();
    const t = state.clock.elapsedTime + s.seed;
    s.A = damp(s.A, clamp(a.speed / 1.2, 0, 1), 6, dt);
    s.droop = damp(s.droop, hungryRef.current ? 1 : 0, 3, dt);
    const A = s.A;
    const D = s.droop;
    s.ph += dt * (2.5 + a.speed * 2.6);
    const sw = Math.sin(s.ph) * 0.38 * A;
    const sw2 = Math.sin(s.ph + PI / 2) * 0.38 * A;
    fr.current.rotation.x = sw;
    bl.current.rotation.x = -sw;
    fl.current.rotation.x = sw2;
    br.current.rotation.x = -sw2;
    body.current.position.y = MM.body[1] + Math.abs(Math.cos(s.ph)) * 0.04 * A + Math.sin(t * 1.5) * 0.012;
    body.current.rotation.z = Math.sin(s.ph) * 0.03 * A;
    head.current.rotation.x = Math.sin(s.ph * 2) * 0.04 * A + D * 0.32 + Math.sin(t * 0.8) * 0.03;
    head.current.rotation.y = Math.sin(t * 0.45) * 0.25 * (1 - A) * (1 - D);
    const flap = Math.sin(t * 2.2) * 0.25 * (1 - D) + D * 0.5;
    earR.current.rotation.y = flap;
    earL.current.rotation.y = flap;
    earR.current.rotation.z = -D * 0.4;
    earL.current.rotation.z = -D * 0.4;
    for (let i = 0; i < 4; i++) {
      const g = trunkRefs[i].current;
      const curl = (1 - D) * (-0.22 - Math.sin(t * 1.1 + i * 0.6) * 0.18) + D * 0.12;
      g.rotation.x = curl * (i === 0 ? 0.6 : 1);
      g.rotation.z = Math.sin(t * 1.3 - i * 0.5) * 0.12 + Math.sin(s.ph) * 0.06 * A;
    }
    applyHurt(root.current, skin, now, a.hurtAt);
  });

  const trunkChain = (i: number): ReactNode =>
    i >= 4 ? null : (
      <Joint at={MM.trunk[i]} gref={trunkRefs[i]}>
        <Parts parts={P.trunk[i]} mats={mats} />
        {trunkChain(i + 1)}
      </Joint>
    );

  return (
    <group ref={root}>
      <Joint at={MM.body} gref={body}>
        <Parts parts={P.body} mats={mats} />
        <Joint at={MM.head} gref={head}>
          <Parts parts={P.head} mats={mats} />
          <Joint at={MM.ear} gref={earR}>
            <Parts parts={P.ear} mats={mats} />
          </Joint>
          <Mirror>
            <Joint at={MM.ear} gref={earL}>
              <Parts parts={P.ear} mats={mats} />
            </Joint>
          </Mirror>
          {trunkChain(0)}
        </Joint>
      </Joint>
      <Joint at={MM.legF} gref={fr}>
        <Parts parts={P.legF} mats={mats} />
      </Joint>
      <Joint at={MM.legB} gref={br}>
        <Parts parts={P.legB} mats={mats} />
      </Joint>
      <Mirror>
        <Joint at={MM.legF} gref={fl}>
          <Parts parts={P.legF} mats={mats} />
        </Joint>
        <Joint at={MM.legB} gref={bl}>
          <Parts parts={P.legB} mats={mats} />
        </Joint>
      </Mirror>
      {hungry && <HungryMark y={2.4} />}
    </group>
  );
}

// ================================================================= public
const PAL = {
  dodo: { skin: '#7d8fa6', belly: '#aebbc9', dark: '#56657a', face: '#c9cfd6', beak: '#c9cf5a', beakTip: '#8a9a3a', leg: '#f08a2c', tail: '#f6f2ea' },
  mammoth: { skin: '#7a4f2e', furDark: '#5a381f', furLight: '#93613a', fur2: '#84552f', ear: '#634027', trunk: '#6e4a33', tusk: '#f1e6c8', foot: '#3e2a1c' },
};

export function AnimalModel(props: { type: AnimalType; animRef: AnimRef; hungry?: boolean }) {
  const { type, animRef, hungry = false } = props;
  const skin = useInstanceMat(mat(PAL[type].skin));
  const mats = useMemo<SlotMats>(() => {
    const m: SlotMats = { ...COMMON, skin };
    for (const [k, v] of Object.entries(PAL[type])) if (k !== 'skin') m[k] = mat(v);
    return m;
  }, [type, skin]);
  return type === 'dodo' ? (
    <Dodo animRef={animRef} hungry={hungry} mats={mats} skin={skin} />
  ) : (
    <Mammoth animRef={animRef} hungry={hungry} mats={mats} skin={skin} />
  );
}

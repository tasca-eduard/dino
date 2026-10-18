// Projectile models. Centred on the origin; the bolt points along +Z (caller orients it).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { G, Kit, Parts, mat, once, type MergedPart, type SlotMats } from './materials';

const PI = Math.PI;
const MATS: SlotMats = {
  stone: mat('#8d9196'),
  stoneDark: mat('#6c7075'),
  ball: mat('#7a5a3a'),
  vine: mat('#4f8f2f'),
  wood: mat('#a8743f'),
  metal: mat('#5b5f63', { metal: 0.3, rough: 0.5 }),
  red: mat('#d9483b'),
  white: mat('#f2ece0'),
};

const KITS: (() => MergedPart[])[] = [
  // 0 stone
  once(() => new Kit().add(G.ico, 'stone', [0, 0, 0], 0.15).build()),
  // 1 bola
  once(() =>
    new Kit()
      .add(G.ball, 'ball', [0.26, 0, 0], 0.09)
      .add(G.ball, 'ball', [-0.26, 0, 0], 0.09)
      .add(G.cyl, 'vine', [0, 0, 0], [0.016, 0.52, 0.016], [0, 0, PI / 2])
      .add(G.torus, 'vine', [0, 0, 0], [0.05, 0.05, 0.5], [PI / 2, 0, 0])
      .build(),
  ),
  // 2 boulder
  once(() =>
    new Kit()
      .add(G.dodeca, 'stone', [0, 0, 0], [0.9, 0.82, 0.86])
      .add(G.ico, 'stoneDark', [0.45, 0.35, 0.2], 0.42)
      .add(G.ico, 'stoneDark', [-0.35, -0.3, 0.4], 0.38)
      .build(),
  ),
  // 3 ballista bolt
  once(() => {
    const k = new Kit()
      .add(G.cyl, 'wood', [0, 0, 0], [0.035, 1.2, 0.035], [PI / 2, 0, 0])
      .add(G.cone4, 'metal', [0, 0, 0.68], [0.06, 0.18, 0.06], [PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      k.add(G.box, i === 0 ? 'white' : 'red', [Math.cos(a) * 0.07, Math.sin(a) * 0.07, -0.48], [0.012, 0.12, 0.24], [0, 0, a - PI / 2]);
    }
    return k.build();
  }),
];

export function ProjectileModel(props: { kind: number }) {
  const kind = Math.max(0, Math.min(KITS.length - 1, props.kind | 0));
  const g = useRef<THREE.Group>(null!);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const r = g.current.rotation;
    if (kind === 0) {
      r.x += dt * 9;
      r.z += dt * 6;
    } else if (kind === 1) r.y += dt * 18;
    else if (kind === 2) {
      r.x += dt * 2.6;
      r.z += dt * 1.7;
    } else r.z += dt * 4;
  });
  return (
    <group ref={g} rotation={kind === 3 ? [0, 0, seed] : [seed, seed * 2, 0]}>
      <Parts parts={KITS[kind]()} mats={MATS} />
    </group>
  );
}

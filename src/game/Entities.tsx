import { Billboard, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useReducer, useRef } from 'react';
import * as THREE from 'three';
import { BUILDINGS, DINOS, type EnemyType } from '../../shared/constants';
import { ANIM, ANIMAL_KINDS, ENEMY_KINDS, type BuildingView, type PlantView, type PlayerInfo } from '../../shared/protocol';
import { heightAt } from '../../shared/terrain';
import { AnimalModel } from '../models/Animals';
import { BuildingModel } from '../models/Buildings';
import { DinoModel } from '../models/Dinos';
import { EnemyModel, TitanoboaBody } from '../models/Enemies';
import { NatureInstances } from '../models/Nature';
import { PlantModel } from '../models/Plants';
import { ProjectileModel } from '../models/Projectiles';
import { newAnim } from '../models/types';
import { useGame } from '../store';
import { interpolate, world, type Ent } from '../world';
import { DINO_HEIGHT } from './LocalPlayer';
import { terrainHeight } from './Terrain';

const ENEMY_HEIGHT: Record<EnemyType, number> = { megalania: 2.2, sarcosuchus: 2.4, titanoboa: 3.4 };

// ---------------------------------------------------------------- health bar
const barGeo = new THREE.PlaneGeometry(1, 1);
const barBg = new THREE.MeshBasicMaterial({ color: '#1b1b1b', transparent: true, opacity: 0.7, depthWrite: false });
const barFg = new THREE.MeshBasicMaterial({ color: '#e53935', depthWrite: false });
const barFgGood = new THREE.MeshBasicMaterial({ color: '#7cd85b', depthWrite: false });

function HpBar({ y, width, barRef, good }: { y: number; width: number; barRef: React.RefObject<THREE.Group | null>; good?: boolean }) {
  return (
    <Billboard position={[0, y, 0]}>
      <group ref={barRef}>
        <mesh geometry={barGeo} material={barBg} scale={[width + 0.08, 0.2, 1]} renderOrder={10} />
        <group position={[-width / 2, 0, 0.01]}>
          <mesh name="fill" geometry={barGeo} material={good ? barFgGood : barFg} scale={[width, 0.13, 1]} position={[width / 2, 0, 0]} renderOrder={11} />
        </group>
      </group>
    </Billboard>
  );
}

function setBar(bar: THREE.Group | null, frac: number, width: number, showFull = false) {
  if (!bar) return;
  bar.visible = showFull || frac < 0.999;
  const fill = bar.getObjectByName('fill');
  if (fill) {
    const f = Math.max(0, Math.min(1, frac));
    fill.scale.x = width * f;
    fill.position.x = (width * f) / 2;
  }
}

/** Drive a model's anim state from how far the entity moved this frame. */
function trackMotion(e: Ent, last: { x: number; z: number; hp: number }, anim: ReturnType<typeof newAnim>, dt: number) {
  const sp = Math.hypot(e.x - last.x, e.z - last.z) / Math.max(dt, 1e-3);
  anim.speed += (sp - anim.speed) * Math.min(1, dt * 10);
  if (e.hp < last.hp) anim.hurtAt = performance.now();
  last.x = e.x;
  last.z = e.z;
  last.hp = e.hp;
}

// ---------------------------------------------------------------- players
export function RemotePlayers() {
  const players = useGame((s) => s.players);
  const myId = useGame((s) => s.myId);
  return (
    <>
      {Object.values(players)
        .filter((p) => p.id !== myId)
        .map((p) => (
          <RemotePlayer key={p.id} info={p} />
        ))}
    </>
  );
}

const RemotePlayer = memo(function RemotePlayer({ info }: { info: PlayerInfo }) {
  const ref = useRef<THREE.Group>(null);
  const anim = useRef(newAnim());
  const last = useRef({ x: 0, z: 0, hp: 0 });
  useFrame((_, dt) => {
    const e = world.players.get(info.id);
    const g = ref.current;
    if (!g) return;
    if (!e) {
      g.visible = false;
      return;
    }
    interpolate(e, dt, 14);
    trackMotion(e, last.current, anim.current, dt);
    anim.current.mode = e.anim;
    g.visible = !e.dead;
    g.position.set(e.x, e.y, e.z);
    g.rotation.y = e.ry;
  });
  return (
    <group ref={ref}>
      <DinoModel type={info.dino} accent={info.color} animRef={anim} />
      <Html position={[0, DINO_HEIGHT[info.dino] + 0.9, 0]} center distanceFactor={14} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="nametag" style={{ borderColor: info.color }}>
          <span style={{ color: info.color }}>●</span> {info.name}
          <small>{DINOS[info.dino].name}</small>
        </div>
      </Html>
    </group>
  );
});

// ---------------------------------------------------------------- enemies
export function Enemies() {
  const ids = useGame((s) => s.enemyIds);
  return (
    <>
      {ids.map((id) => (
        <Enemy key={id} id={id} />
      ))}
    </>
  );
}

const Enemy = memo(function Enemy({ id }: { id: number }) {
  const e0 = world.enemies.get(id);
  const type: EnemyType = ENEMY_KINDS[e0?.type ?? 0];
  const ref = useRef<THREE.Group>(null);
  const bar = useRef<THREE.Group>(null);
  const anim = useRef(newAnim());
  const last = useRef({ x: 0, z: 0, hp: e0?.hp ?? 0 });
  const slowed = usePolledFlag(() => world.enemies.get(id)?.slowed ?? false);
  const width = type === 'titanoboa' ? 3.5 : type === 'sarcosuchus' ? 2.4 : 1.6;
  useFrame((_, dt) => {
    const e = world.enemies.get(id);
    const g = ref.current;
    if (!e || !g) return;
    interpolate(e, dt, 10);
    trackMotion(e, last.current, anim.current, dt);
    anim.current.mode = heightAt(world.heights, e.x, e.z) < -0.4 ? ANIM.SWIM : anim.current.speed > 0.3 ? ANIM.WALK : ANIM.IDLE;
    g.position.set(e.x, e.y, e.z);
    g.rotation.y = e.ry;
    setBar(bar.current, e.hp / Math.max(1, e.maxHp), width, true);
  });
  return (
    <>
      <group ref={ref}>
        <EnemyModel type={type} animRef={anim} slowed={slowed} />
        <HpBar y={ENEMY_HEIGHT[type]} width={width} barRef={bar} />
      </group>
      {type === 'titanoboa' && <TitanoboaBody headRef={ref} />}
    </>
  );
});

// ---------------------------------------------------------------- animals
export function Animals() {
  const ids = useGame((s) => s.animalIds);
  return (
    <>
      {ids.map((id) => (
        <Animal key={id} id={id} />
      ))}
    </>
  );
}

const Animal = memo(function Animal({ id }: { id: number }) {
  const e0 = world.animals.get(id);
  const type = ANIMAL_KINDS[e0?.type ?? 0];
  const ref = useRef<THREE.Group>(null);
  const anim = useRef(newAnim());
  const last = useRef({ x: 0, z: 0, hp: 0 });
  const hungry = usePolledFlag(() => world.animals.get(id)?.hungry ?? false);
  useFrame((_, dt) => {
    const e = world.animals.get(id);
    const g = ref.current;
    if (!e || !g) return;
    interpolate(e, dt, 10);
    trackMotion(e, last.current, anim.current, dt);
    anim.current.mode = anim.current.speed > 0.2 ? ANIM.WALK : ANIM.IDLE;
    g.position.set(e.x, e.y, e.z);
    g.rotation.y = e.ry;
  });
  return (
    <group ref={ref}>
      <AnimalModel type={type} animRef={anim} hungry={hungry} />
    </group>
  );
});

/** Re-render only when a boolean read from the mutable world flips (polled 4x a second). */
function usePolledFlag(read: () => boolean) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const state = useRef(false);
  const timer = useRef(0);
  useFrame((_, dt) => {
    timer.current += dt;
    if (timer.current < 0.25) return;
    timer.current = 0;
    const v = read();
    if (v !== state.current) {
      state.current = v;
      force();
    }
  });
  return state.current;
}

// ---------------------------------------------------------------- projectiles
export function Projectiles() {
  const ids = useGame((s) => s.projectileIds);
  return (
    <>
      {ids.map((id) => (
        <Projectile key={id} id={id} />
      ))}
    </>
  );
}

const Projectile = memo(function Projectile({ id }: { id: number }) {
  const kind = world.projectiles.get(id)?.type ?? 0;
  const ref = useRef<THREE.Group>(null);
  const prev = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const e = world.projectiles.get(id);
    const g = ref.current;
    if (!e || !g) return;
    prev.set(e.x, e.y, e.z);
    interpolate(e, dt, 20);
    g.position.set(e.x, e.y, e.z);
    // bolts point along their flight direction
    if (kind === 3 && prev.distanceToSquared(g.position) > 1e-6) g.lookAt(ahead.copy(g.position).sub(prev).add(g.position));
  });
  return (
    <group ref={ref}>
      <ProjectileModel kind={kind} />
    </group>
  );
});

// ---------------------------------------------------------------- plants
export function Plants() {
  const plants = useGame((s) => s.plants);
  return (
    <>
      {Object.values(plants).map((p) => (
        <Plant key={p.id} p={p} />
      ))}
    </>
  );
}

const Plant = memo(function Plant({ p }: { p: PlantView }) {
  const ref = useRef<THREE.Group>(null);
  const walking = p.wild && p.sp === 'wanderroot';
  const y0 = useMemo(() => terrainHeight(p.x, p.z), [p.x, p.z]);
  const last = useRef({ x: p.x, z: p.z });
  useFrame(() => {
    const g = ref.current;
    if (!g || !walking) return;
    const w = world.walkers.get(p.id);
    if (!w) return;
    const k = 0.15;
    const nx = g.position.x + (w.x - g.position.x) * k;
    const nz = g.position.z + (w.z - g.position.z) * k;
    const dx = nx - last.current.x;
    const dz = nz - last.current.z;
    if (dx * dx + dz * dz > 1e-6) g.rotation.y = Math.atan2(dx, dz);
    last.current = { x: nx, z: nz };
    g.position.set(nx, terrainHeight(nx, nz), nz);
  });
  return (
    <group ref={ref} position={[p.x, y0, p.z]}>
      <PlantModel species={p.sp} stage={p.stage} wild={p.wild} feral={p.feral} tamed={p.tame >= 100} walking={walking} />
    </group>
  );
});

// ---------------------------------------------------------------- buildings
export function Buildings() {
  const buildings = useGame((s) => s.buildings);
  return (
    <>
      {Object.values(buildings).map((b) => (
        <Building key={b.id} b={b} />
      ))}
    </>
  );
}

const Building = memo(function Building({ b }: { b: BuildingView }) {
  const def = BUILDINGS[b.type];
  const bar = useRef<THREE.Group>(null);
  const y = useMemo(() => {
    // sit on the lowest corner of the footprint so nothing floats
    const r = def.radius * 0.7;
    return Math.min(...[[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]].map(([dx, dz]) => terrainHeight(b.x + dx, b.z + dz)));
  }, [b.x, b.z, def.radius]);
  const frac = b.hp / def.hp;
  useFrame(() => setBar(bar.current, frac, 2));
  return (
    <group position={[b.x, y, b.z]}>
      <group rotation-y={(b.rot * Math.PI) / 2}>
        <BuildingModel type={b.type} hpFrac={frac} />
      </group>
      <HpBar y={def.height + 0.6} width={2} barRef={bar} good />
    </group>
  );
});

// ---------------------------------------------------------------- trees & rocks
export function Nature() {
  const nodes = useGame((s) => s.nodes);
  const list = useMemo(() => Object.values(nodes), [nodes]);
  return <NatureInstances nodes={list} heightAt={terrainHeight} />;
}

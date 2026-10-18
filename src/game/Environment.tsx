import { Stars } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGame } from '../store';
import { world } from '../world';

export const WATER_Y = -0.12;

const SKY = {
  night: new THREE.Color('#0b1430'),
  dawn: new THREE.Color('#f7a072'),
  day: new THREE.Color('#8fd0ff'),
  rain: new THREE.Color('#7b8a99'),
};
const SUN = {
  night: new THREE.Color('#7f95d6'),
  low: new THREE.Color('#ffb27a'),
  day: new THREE.Color('#fff4dc'),
};

/** 0 at night, 1 at full day, smooth around sunrise/sunset. */
export function daylight(day: number) {
  const elev = Math.sin((day - 0.25) * Math.PI * 2);
  return THREE.MathUtils.smoothstep(elev, -0.15, 0.25);
}

export function Environment() {
  const scene = useThree((s) => s.scene);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const stars = useRef<THREE.Group>(null);
  const smoothDay = useRef(useGame.getState().day);
  const rainMix = useRef(0);
  const sky = useMemo(() => new THREE.Color(), []);
  const fog = useMemo(() => new THREE.Fog('#8fd0ff', 60, 230), []);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, dt) => {
    const s = useGame.getState();
    // ease toward the server's day value (it arrives at 2 Hz); handle midnight wrap
    let d = s.day - smoothDay.current;
    if (d < -0.5) d += 1;
    if (d > 0.5) d -= 1;
    smoothDay.current = (smoothDay.current + d * Math.min(1, dt * 2) + 1) % 1;
    const day = smoothDay.current;
    rainMix.current += ((s.rain ? 1 : 0) - rainMix.current) * Math.min(1, dt * 0.5);

    const light = daylight(day);
    const elev = Math.sin((day - 0.25) * Math.PI * 2);
    const dawnness = Math.max(0, 1 - Math.abs(elev) * 3.5);
    sky.copy(SKY.night).lerp(SKY.day, light).lerp(SKY.dawn, dawnness * 0.55).lerp(SKY.rain, rainMix.current * 0.6 * light);
    scene.background = sky;
    scene.fog = fog;
    fog.color.copy(sky);
    fog.far = 230 - rainMix.current * 110;

    const az = (day - 0.25) * Math.PI * 2;
    const me = world.me;
    if (sun.current) {
      // the moon takes over at night, from the opposite side
      const sx = Math.cos(az);
      const sy = Math.max(0.25, Math.abs(Math.sin(az)));
      sun.current.position.set(me.x + sx * 60, me.y + sy * 80, me.z + 30);
      target.position.set(me.x, me.y, me.z);
      sun.current.target = target;
      sun.current.intensity = (0.25 + light * 2.4) * (1 - rainMix.current * 0.45);
      sun.current.color.copy(SUN.night).lerp(SUN.day, light).lerp(SUN.low, dawnness * 0.7);
    }
    if (hemi.current) hemi.current.intensity = 0.35 + light * 0.9;
    if (stars.current) stars.current.visible = light < 0.5 && rainMix.current < 0.5;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#cfe8ff', '#5a4a2a', 1]} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      <primitive object={target} />
      <group ref={stars}>
        <Stars radius={260} depth={60} count={2500} factor={6} fade speed={0.5} />
      </group>
      <Water />
      <Rain />
    </>
  );
}

function Water() {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(420, 420, 84, 84);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pos = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      pos[i + 1] = Math.sin(x * 0.35 + t * 1.3) * 0.06 + Math.cos(z * 0.3 + t * 1.1) * 0.06;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return (
    <mesh ref={ref} geometry={geo} position={[0, WATER_Y, 0]} receiveShadow>
      <meshStandardMaterial color="#3a8fd4" transparent opacity={0.78} roughness={0.12} metalness={0.15} flatShading />
    </mesh>
  );
}

const RAIN_COUNT = 4000;
function Rain() {
  const ref = useRef<THREE.LineSegments>(null);
  const camera = useThree((s) => s.camera);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(RAIN_COUNT * 6);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const x = (Math.random() - 0.5) * 80;
      const y = Math.random() * 40;
      const z = (Math.random() - 0.5) * 80;
      p.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    const rain = useGame.getState().rain;
    if (!ref.current) return;
    ref.current.visible = rain;
    if (!rain) return;
    ref.current.position.set(camera.position.x, camera.position.y - 20, camera.position.z);
    const p = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < RAIN_COUNT; i++) {
      const o = i * 6;
      let y = p[o + 1] - dt * 32;
      if (y < 0) y += 40;
      p[o + 1] = y;
      p[o + 4] = y - 0.7;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return (
    <lineSegments ref={ref} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#a8c8e8" transparent opacity={0.55} />
    </lineSegments>
  );
}

// Lightweight pooled particle / shockwave effects driven by the `onFx` bus.
// No allocations per frame and no React state per particle: everything lives in typed arrays.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { onFx, type FxEvent } from '../world';
import { G, Kit, mat } from '../models/materials';

const PI = Math.PI;
const ALIVE = 1;
const STRETCH = 2; // orient along velocity, elongated
const PUFF = 4; // grow then fade (smoke / dust)
const WOBBLE = 8; // drifting sideways (spores)
const UPRIGHT = 16; // spin only around Y (heal pluses)

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- particle pool
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly delay: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly flags: Uint8Array;
  private cursor = 0;
  private alive = 0;
  private colorsDirty = false;

  constructor(geo: THREE.BufferGeometry, material: THREE.Material, cap: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    (this.mesh.instanceMatrix.array as Float32Array).fill(0);
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    const f = () => new Float32Array(cap);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.delay = f();
    this.size = f();
    this.grav = f();
    this.drag = f();
    this.rot = f();
    this.spin = f();
    this.flags = new Uint8Array(cap);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, grav = 0, drag = 0, flags = 0, delay = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    if (!(this.flags[i] & ALIVE)) this.alive++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.delay[i] = delay;
    this.size[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.rot[i] = Math.random() * PI * 2;
    this.spin[i] = rand(-8, 8);
    this.flags[i] = flags | ALIVE;
    this.mesh.setColorAt(i, color);
    this.colorsDirty = true;
  }

  update(dt: number, t: number) {
    if (this.alive === 0) return;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      const fl = this.flags[i];
      if (!(fl & ALIVE)) continue;
      this.age[i] += dt;
      const a = this.age[i] - this.delay[i];
      if (a < 0) continue; // waiting (matrix stays zero)
      const k = a / this.life[i];
      if (k >= 1) {
        this.flags[i] = 0;
        this.alive--;
        arr.fill(0, i * 16, i * 16 + 16);
        continue;
      }
      // integrate
      this.vy[i] -= this.grav[i] * dt;
      if (this.drag[i] > 0) {
        const d = Math.exp(-this.drag[i] * dt);
        this.vx[i] *= d;
        this.vy[i] *= d;
        this.vz[i] *= d;
      }
      if (fl & WOBBLE) {
        this.vx[i] += Math.sin(t * 3 + i) * dt * 1.2;
        this.vz[i] += Math.cos(t * 2.6 + i * 1.7) * dt * 1.2;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;

      const sz = this.size[i];
      let sc: number;
      if (fl & PUFF) sc = sz * (0.4 + 1.2 * k) * (1 - k * k);
      else sc = sz * Math.pow(1 - k, 0.7);
      _p.set(this.px[i], this.py[i], this.pz[i]);
      if (fl & STRETCH) {
        _v.set(this.vx[i], this.vy[i], this.vz[i]);
        const sp = _v.length();
        if (sp > 1e-4) _q.setFromUnitVectors(Z, _v.multiplyScalar(1 / sp));
        else _q.identity();
        const el = Math.min(4, 1 + sp * 0.25);
        _s.set(sc * 0.6, sc * 0.6, sc * el);
      } else if (fl & UPRIGHT) {
        _q.setFromAxisAngle(Y, this.rot[i] * 0.4);
        _s.set(sc, sc, sc);
      } else {
        _e.set(this.rot[i], this.rot[i] * 0.7, 0);
        _q.setFromEuler(_e);
        _s.set(sc, sc, sc);
      }
      _m.compose(_p, _q, _s);
      _m.toArray(arr, i * 16);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorsDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorsDirty = false;
    }
  }

  dispose() {
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------- shockwave rings / swing arcs
class Rings {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly st: { on: boolean; age: number; life: number; r0: number; r1: number; op: number; sweep: number; yaw: number }[] = [];
  private cursor = 0;

  constructor(geo: THREE.BufferGeometry, count: number, additive: boolean) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.mats.push(m);
      this.st.push({ on: false, age: 0, life: 1, r0: 0, r1: 1, op: 1, sweep: 0, yaw: 0 });
    }
  }

  spawn(x: number, y: number, z: number, r0: number, r1: number, life: number, color: THREE.Color | string, opacity = 0.8, yaw = 0, sweep = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.meshes.length;
    const s = this.st[i];
    s.on = true;
    s.age = 0;
    s.life = life;
    s.r0 = r0;
    s.r1 = r1;
    s.op = opacity;
    s.yaw = yaw;
    s.sweep = sweep;
    const mesh = this.meshes[i];
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, yaw, 0);
    mesh.scale.setScalar(r0);
    mesh.visible = true;
    this.mats[i].color.set(color);
    this.mats[i].opacity = opacity;
  }

  update(dt: number) {
    for (let i = 0; i < this.meshes.length; i++) {
      const s = this.st[i];
      if (!s.on) continue;
      s.age += dt;
      const k = s.age / s.life;
      const mesh = this.meshes[i];
      if (k >= 1) {
        s.on = false;
        mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k) * (1 - k); // ease-out cubic
      mesh.scale.setScalar(s.r0 + (s.r1 - s.r0) * e);
      if (s.sweep) mesh.rotation.y = s.yaw + (k - 0.5) * s.sweep;
      this.mats[i].opacity = s.op * (1 - k);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
  }
}

// ---------------------------------------------------------------- geometry
const RING_GEO = new THREE.RingGeometry(0.86, 1, 40).rotateX(-PI / 2);
const ARC_GEO = new THREE.RingGeometry(0.72, 1, 20, 1, -PI / 2 - 1.0, 2.0).rotateX(-PI / 2);
const PLUS_GEO = new Kit().add(G.box, 'p', [0, 0, 0], [1, 0.34, 0.2]).add(G.box, 'p', [0, 0, 0], [0.34, 1, 0.2]).build()[0].geo;

// ---------------------------------------------------------------- colours
const col = (hex: string) => new THREE.Color(hex);
const C = {
  dustA: col('#9c7b55'),
  dustB: col('#c9ab84'),
  waterA: col('#3fa7e6'),
  waterB: col('#c4ecff'),
  sparkA: col('#ffffff'),
  sparkB: col('#ffe066'),
  rockA: col('#7c8186'),
  rockB: col('#a3a7ab'),
  greenA: col('#5dff5a'),
  greenB: col('#d6ff9a'),
  redA: col('#ff2a2a'),
  redB: col('#ff9a8a'),
  blood: col('#8c1a1a'),
  healA: col('#5dff7a'),
  healB: col('#ff7ab8'),
  woodA: col('#8b5a2b'),
  woodB: col('#c9955a'),
  fireA: col('#ff7a1a'),
  fireB: col('#ffe04a'),
  smokeA: col('#555555'),
  smokeB: col('#a0a0a0'),
  sporeA: col('#3ff2e0'),
  sporeB: col('#c0fff6'),
  goldA: col('#ffc53a'),
  goldB: col('#fff3b0'),
};
const mixc = (a: THREE.Color, b: THREE.Color) => _c.copy(a).lerp(b, Math.random());

// ---------------------------------------------------------------- the system
class FxSystem {
  readonly root = new THREE.Group();
  private readonly lit: Pool;
  private readonly glow: Pool;
  private readonly plus: Pool;
  private readonly rings: Rings;
  private readonly arcs: Rings;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly plusMat: THREE.MeshBasicMaterial;
  private t = 0;

  constructor() {
    // unlit, untonemapped: vivid at night and readable over bright ground (additive washes to white)
    this.glowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.plusMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.lit = new Pool(G.ico, mat('#ffffff'), 900);
    this.glow = new Pool(G.octa, this.glowMat, 500);
    this.plus = new Pool(PLUS_GEO, this.plusMat, 100);
    this.rings = new Rings(RING_GEO, 14, false);
    this.arcs = new Rings(ARC_GEO, 6, true);
    this.glow.mesh.renderOrder = 3;
    this.root.add(this.lit.mesh, this.glow.mesh, this.plus.mesh, this.rings.group, this.arcs.group);
  }

  update(dt: number) {
    this.t += dt;
    this.lit.update(dt, this.t);
    this.glow.update(dt, this.t);
    this.plus.update(dt, this.t);
    this.rings.update(dt);
    this.arcs.update(dt);
  }

  dispose() {
    this.lit.dispose();
    this.glow.dispose();
    this.plus.dispose();
    this.rings.dispose();
    this.arcs.dispose();
    this.glowMat.dispose();
    this.plusMat.dispose();
  }

  private dust(x: number, y: number, z: number, n: number, spread: number, size = 0.32) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * PI * 2;
      const r = Math.random() * spread;
      this.lit.spawn(x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r, Math.cos(a) * rand(0.4, 1.4), rand(0.5, 1.5), Math.sin(a) * rand(0.4, 1.4), rand(0.6, 1.0), size * rand(0.7, 1.3), mixc(C.dustA, C.dustB), -0.6, 2.5, PUFF);
    }
  }

  private burst(pool: Pool, x: number, y: number, z: number, n: number, s0: number, s1: number, life0: number, life1: number, size0: number, size1: number, a: THREE.Color, b: THREE.Color, grav: number, drag: number, flags: number, up = 0) {
    for (let i = 0; i < n; i++) {
      // random direction on a sphere, biased upward by `up`
      const u = Math.random() * 2 - 1;
      const th = Math.random() * PI * 2;
      const rr = Math.sqrt(1 - u * u);
      const sp = rand(s0, s1);
      pool.spawn(x, y, z, Math.cos(th) * rr * sp, (u + up) * sp, Math.sin(th) * rr * sp, rand(life0, life1), rand(size0, size1), mixc(a, b), grav, drag, flags);
    }
  }

  spawn(fx: FxEvent) {
    const { x, y, z } = fx;
    let dx = fx.dx ?? 0;
    let dz = fx.dz ?? 0;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-5) {
      dx /= dl;
      dz /= dl;
    } else {
      dx = 0;
      dz = 1;
    }
    const yaw = Math.atan2(dx, dz);
    switch (fx.k) {
      case 'dust':
        this.dust(x, y, z, 10, 0.4);
        break;
      case 'splash':
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * PI * 2;
          const sp = rand(1.5, 3);
          this.lit.spawn(x, y + 0.1, z, Math.cos(a) * sp, rand(4, 7), Math.sin(a) * sp, rand(0.6, 0.9), rand(0.08, 0.15), mixc(C.waterA, C.waterB), 14, 0, STRETCH);
        }
        this.rings.spawn(x, y + 0.05, z, 0.3, 1.6, 0.5, C.waterB, 0.7);
        break;
      case 'hit':
        this.burst(this.glow, x, y, z, 12, 4, 8, 0.25, 0.45, 0.08, 0.14, C.sparkA, C.sparkB, 8, 1, STRETCH, 0.3);
        this.glow.spawn(x, y, z, 0, 0, 0, 0.12, 0.5, C.sparkA);
        break;
      case 'quake': {
        const r = fx.r ?? 6;
        this.rings.spawn(x, y + 0.12, z, 0.5, r, 0.7, C.dustA, 0.85);
        this.rings.spawn(x, y + 0.1, z, 0.3, r * 0.6, 0.5, C.dustB, 0.6);
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * PI * 2;
          const rr = Math.sqrt(Math.random()) * r * 0.85;
          this.lit.spawn(x + Math.cos(a) * rr, y + 0.15, z + Math.sin(a) * rr, Math.cos(a) * 1.2, rand(1, 2.5), Math.sin(a) * 1.2, rand(0.7, 1.1), rand(0.3, 0.6), mixc(C.dustA, C.dustB), -0.4, 2, PUFF, (rr / r) * 0.35);
        }
        this.burst(this.lit, x, y + 0.2, z, 12, 3, 6, 0.6, 0.9, 0.1, 0.18, C.rockA, C.rockB, 14, 0, 0, 1);
        break;
      }
      case 'spout':
        for (let i = 0; i < 70; i++) {
          const sp = rand(15, 19);
          const lat = rand(-1.5, 1.5);
          this.lit.spawn(x, y, z, dx * sp - dz * lat, rand(1.5, 3), dz * sp + dx * lat, rand(0.55, 0.7), rand(0.1, 0.2), mixc(C.waterA, C.waterB), 7, 0.3, STRETCH, (i / 70) * 0.35);
        }
        for (let i = 0; i < 16; i++) {
          const sp = rand(8, 14);
          this.glow.spawn(x, y, z, dx * sp + rand(-1, 1), rand(1, 2.5), dz * sp + rand(-1, 1), rand(0.4, 0.6), rand(0.08, 0.14), C.waterB, 5, 0.5, STRETCH, (i / 16) * 0.3);
        }
        break;
      case 'pounce':
        for (let i = 0; i < 30; i++) {
          const u = i / 29;
          const L = u * 7;
          this.glow.spawn(x + dx * L + rand(-0.25, 0.25), y + rand(0.5, 1.2), z + dz * L + rand(-0.25, 0.25), dx * 2.5, rand(-0.2, 0.4), dz * 2.5, rand(0.35, 0.5), rand(0.14, 0.24), mixc(C.greenA, C.greenB), 0, 1, STRETCH, u * 0.22);
        }
        this.dust(x, y, z, 6, 0.3);
        break;
      case 'bite':
        for (let i = 0; i < 14; i++) {
          const a = yaw + rand(-1.2, 1.2);
          const sp = rand(5, 9);
          this.glow.spawn(x, y, z, Math.sin(a) * sp, rand(-2, 3), Math.cos(a) * sp, rand(0.2, 0.35), rand(0.1, 0.18), mixc(C.redA, C.redB), 0, 3, STRETCH);
        }
        this.burst(this.lit, x, y, z, 6, 1.5, 3, 0.4, 0.6, 0.05, 0.09, C.blood, C.redA, 12, 0, 0, 0.6);
        break;
      case 'heal':
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * PI * 2;
          const r = Math.random() * 0.8;
          this.plus.spawn(x + Math.cos(a) * r, y + rand(0.3, 1.2), z + Math.sin(a) * r, 0, rand(1.2, 2), 0, rand(1, 1.3), rand(0.3, 0.42), i % 2 ? C.healA : C.healB, -0.3, 0.5, UPRIGHT, i * 0.05);
        }
        break;
      case 'build': {
        const r = fx.r ?? 1.6;
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * PI * 2;
          const sp = rand(1.5, 3);
          this.lit.spawn(x, y + 0.3, z, Math.cos(a) * sp, rand(3, 5), Math.sin(a) * sp, rand(0.6, 0.9), rand(0.08, 0.16), mixc(C.woodA, C.woodB), 12, 0, 0);
        }
        this.rings.spawn(x, y + 0.06, z, 0.3, r, 0.45, '#d9b77a', 0.75);
        this.dust(x, y, z, 6, r * 0.6);
        break;
      }
      case 'boom': {
        const r = fx.r ?? 4;
        this.burst(this.glow, x, y + 0.3, z, 30, 5, 11, 0.35, 0.7, 0.15, 0.32, C.fireA, C.fireB, 3, 2, STRETCH, 0.4);
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * PI * 2;
          const sp = rand(1, 2.5);
          this.lit.spawn(x, y + 0.4, z, Math.cos(a) * sp, rand(1, 2.5), Math.sin(a) * sp, rand(0.8, 1.2), rand(0.4, 0.7), mixc(C.smokeA, C.smokeB), -0.5, 1.2, PUFF, rand(0, 0.12));
        }
        this.rings.spawn(x, y + 0.12, z, 0.5, r, 0.5, C.fireA, 0.85);
        this.glow.spawn(x, y + 0.5, z, 0, 0, 0, 0.16, 1.3, C.fireB);
        this.burst(this.lit, x, y + 0.2, z, 8, 3, 6, 0.6, 0.9, 0.1, 0.2, C.rockA, C.rockB, 14, 0, 0, 1);
        break;
      }
      case 'spores': {
        const r = fx.r ?? 3;
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * PI * 2;
          const rr = Math.sqrt(Math.random()) * r;
          this.glow.spawn(x + Math.cos(a) * rr, y + rand(0.2, 1.2), z + Math.sin(a) * rr, rand(-0.3, 0.3), rand(0.3, 0.7), rand(-0.3, 0.3), rand(1, 1.4), rand(0.07, 0.13), mixc(C.sporeA, C.sporeB), -0.2, 0.5, WOBBLE, rand(0, 0.25));
        }
        break;
      }
      case 'swing':
        this.arcs.spawn(x, y + 1.0, z, 1.6, 2.4, 0.22, '#ffffff', 0.85, yaw, 1.2);
        for (let i = 0; i < 6; i++) {
          const a = yaw + rand(-0.9, 0.9);
          const r = rand(1.6, 2.3);
          this.glow.spawn(x + Math.sin(a) * r, y + 1.0, z + Math.cos(a) * r, Math.cos(a) * 3, 0.5, -Math.sin(a) * 3, rand(0.2, 0.3), rand(0.07, 0.12), C.sparkA, 0, 2, STRETCH);
        }
        break;
      case 'harvest':
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * PI * 2;
          const r = Math.random() * 0.6;
          this.glow.spawn(x + Math.cos(a) * r, y + rand(0.2, 0.8), z + Math.sin(a) * r, Math.cos(a) * 0.5, rand(1.5, 3), Math.sin(a) * 0.5, rand(0.8, 1.2), rand(0.08, 0.15), mixc(C.goldA, C.goldB), 1.5, 1, 0, i * 0.02);
        }
        break;
    }
  }
}

export function Effects() {
  const sys = useMemo(() => new FxSystem(), []);
  useEffect(() => {
    const off = onFx((fx) => sys.spawn(fx));
    return () => {
      off();
    };
  }, [sys]);
  useEffect(() => () => sys.dispose(), [sys]);
  useFrame((_, delta) => sys.update(Math.min(delta, 0.1)));
  return <primitive object={sys.root} />;
}

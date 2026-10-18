import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import {
  ANIMALS,
  BUILDINGS,
  BUILD_ORDER,
  DINOS,
  PLANTS,
  PLANT_ORDER,
  TOOLS,
  TILE_T,
  WEAPONS,
  WORLD,
  type DinoType,
} from '../../shared/constants';
import { ANIM, ANIMAL_KINDS, type Action } from '../../shared/protocol';
import { heightAt, inBounds, tileAt, tileIndex } from '../../shared/terrain';
import { clearPresses, consumeMouse, consumePress, keys, mouse } from '../input';
import { DinoModel } from '../models/Dinos';
import { newAnim } from '../models/types';
import { send, sendAction } from '../net';
import { game, useGame } from '../store';
import { world } from '../world';
import { WATER_Y } from './Environment';
import { aim, lookup } from './lookup';
import { tileWet } from './Terrain';

/** Height the body floats at while swimming. */
export const SWIM_Y = -0.75;
export const DINO_HEIGHT: Record<DinoType, number> = { raptor: 1.8, ankylo: 1.6, ptero: 1.5, spino: 2.5 };
const DINO_RADIUS: Record<DinoType, number> = { raptor: 0.6, ankylo: 1.0, ptero: 0.6, spino: 0.85 };
const STAGES = ['Sprout', 'Young', 'Mature', 'Ripe'];

/** Third-person camera orbit state (yaw 0 looks toward +Z). */
export const cam = { yaw: 0, pitch: 0.42, dist: 9 };

interface Candidate {
  kind: Extract<Action, { a: 'interact' }>['kind'];
  id: number;
  prompt: string;
  info: string | null;
}

const tgt = new THREE.Vector3();
const camPos = new THREE.Vector3();
const dir = new THREE.Vector3();

export function LocalPlayer() {
  const myDino = useGame((s) => s.myDino);
  const color = useGame((s) => s.players[s.myId]?.color ?? '#ffd54f');
  const group = useRef<THREE.Group>(null);
  const anim = useRef(newAnim());
  const camera = useThree((s) => s.camera);
  const st = useRef({
    grounded: true, jumps: 0, vx: 0, vz: 0,
    dashUntil: 0, dashX: 0, dashZ: 0,
    sendAt: 0, actAt: 0, interactAt: 0, faceUntil: 0,
  });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = game();
    const me = world.me;
    const p = st.current;
    const def = DINOS[s.myDino];
    const t = performance.now();
    const m = consumeMouse();
    const busy = s.dead || s.chatOpen;

    // ------------------------------------------------------------ camera orbit input
    if (s.pointerLocked) {
      cam.yaw -= m.dx * 0.0025;
      cam.pitch = THREE.MathUtils.clamp(cam.pitch + m.dy * 0.0022, -0.55, 1.3);
    }
    cam.dist = THREE.MathUtils.clamp(cam.dist + m.wheel * 1.2, 4, 24);
    const fx = Math.sin(cam.yaw);
    const fz = Math.cos(cam.yaw);

    // ------------------------------------------------------------ movement
    let ix = 0;
    let iz = 0;
    if (!busy) {
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      ix = fx * fwd - fz * str;
      iz = fz * fwd + fx * str;
      const l = Math.hypot(ix, iz);
      if (l > 0) {
        ix /= l;
        iz /= l;
      }
    }
    const ground0 = heightAt(world.heights, me.x, me.z);
    const inWater = ground0 < SWIM_Y + 0.05 && me.y <= SWIM_Y + 0.3;
    const sprint = !busy && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    const flying = def.fly && !p.grounded && !inWater;
    let speed = def.speed;
    if (sprint && !flying) speed *= s.myDino === 'raptor' ? 1.5 : 1.3;
    if (inWater && !flying) speed *= def.swim;
    if (flying) speed *= 1.35;
    let tvx = ix * speed;
    let tvz = iz * speed;
    if (p.dashUntil > t) {
      tvx = p.dashX * 28;
      tvz = p.dashZ * 28;
    }
    const acc = 1 - Math.exp(-dt * (p.grounded || inWater || p.dashUntil > t ? 12 : 4));
    p.vx += (tvx - p.vx) * acc;
    p.vz += (tvz - p.vz) * acc;

    const space = !busy && keys.has('Space');
    const jump = consumePress('Space') && !busy;
    if (def.fly) {
      if (space) me.vy = Math.min(me.vy + 38 * dt, 8);
      else me.vy -= 22 * dt;
      // gliding: falls slowly unless diving with Shift
      if (!p.grounded && !space) me.vy = Math.max(me.vy, sprint ? -18 : -3.2);
    } else {
      me.vy -= 28 * dt;
      if (jump) {
        if (p.grounded || inWater) {
          me.vy = 10;
          p.jumps = 1;
        } else if (s.myDino === 'raptor' && p.jumps < 2) {
          me.vy = 9;
          p.jumps = 2;
        }
      }
    }

    let nx = me.x + p.vx * dt;
    let nz = me.z + p.vz * dt;
    let ny = me.y + me.vy * dt;
    const R = DINO_RADIUS[s.myDino];
    for (const o of lookup.obstacles) {
      const min = o.r + R;
      let dx = nx - o.x;
      let dz = nz - o.z;
      if (Math.abs(dx) > min || Math.abs(dz) > min || ny > o.top) continue;
      let d = Math.hypot(dx, dz);
      if (d >= min) continue;
      if (d < 1e-4) {
        dx = 1;
        d = 1;
      }
      nx = o.x + (dx / d) * min;
      nz = o.z + (dz / d) * min;
    }
    const lim = WORLD.HALF - 3;
    nx = THREE.MathUtils.clamp(nx, -lim, lim);
    nz = THREE.MathUtils.clamp(nz, -lim, lim);
    const g = heightAt(world.heights, nx, nz);
    const floor = g < SWIM_Y ? SWIM_Y : g;
    if (ny <= floor) {
      ny = floor;
      if (me.vy < 0) me.vy = 0;
      p.grounded = true;
      p.jumps = 0;
    } else p.grounded = ny - floor < 0.06;
    if (def.fly) ny = Math.min(ny, 45);
    if (!s.dead) {
      me.x = nx;
      me.y = ny;
      me.z = nz;
    }

    // ------------------------------------------------------------ facing & animation
    const hs = Math.hypot(p.vx, p.vz);
    let face = me.ry;
    if (t < p.faceUntil) face = cam.yaw;
    else if (hs > 0.6) face = Math.atan2(p.vx, p.vz);
    let dr = face - me.ry;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    me.ry += dr * Math.min(1, dt * 12);
    me.flying = def.fly && !p.grounded && !inWater;
    me.swimming = inWater && !me.flying;
    me.speed = hs;
    me.anim = me.flying ? ANIM.FLY : me.swimming ? ANIM.SWIM : hs > def.speed * 1.15 ? ANIM.RUN : hs > 0.4 ? ANIM.WALK : ANIM.IDLE;
    anim.current.speed = hs;
    anim.current.mode = me.anim;
    if (group.current) {
      group.current.position.set(me.x, me.y, me.z);
      group.current.rotation.y = me.ry;
      group.current.visible = !s.dead;
    }

    // ------------------------------------------------------------ camera
    tgt.set(me.x, me.y + DINO_HEIGHT[s.myDino] + 0.6, me.z);
    const cp = Math.cos(cam.pitch);
    dir.set(fx * cp, -Math.sin(cam.pitch), fz * cp);
    camPos.copy(tgt).addScaledVector(dir, -cam.dist);
    const minY = Math.max(heightAt(world.heights, camPos.x, camPos.z), WATER_Y) + 0.5;
    if (camPos.y < minY) camPos.y = minY;
    camera.position.copy(camPos);
    camera.lookAt(tgt);

    // ------------------------------------------------------------ aiming (crosshair ray vs heightfield)
    dir.copy(tgt).sub(camPos).normalize();
    aim.dir = [dir.x, dir.y, dir.z];
    aim.fx = fx;
    aim.fz = fz;
    aim.hit = false;
    for (let d = 0.5; d < 40; d += 0.2) {
      const x = tgt.x + dir.x * d;
      const y = tgt.y + dir.y * d;
      const z = tgt.z + dir.z * d;
      if (y <= Math.max(heightAt(world.heights, x, z), WATER_Y)) {
        aim.hit = true;
        aim.x = x;
        aim.y = y;
        aim.z = z;
        break;
      }
    }
    let tile: [number, number] | null = null;
    if (aim.hit && Math.hypot(aim.x - me.x, aim.z - me.z) <= WORLD.REACH) tile = tileAt(aim.x, aim.z);
    else if (!aim.hit || Math.hypot(aim.x - me.x, aim.z - me.z) > WORLD.REACH) tile = tileAt(me.x + fx * 2.6, me.z + fz * 2.6);
    aim.tile = tile && inBounds(tile[0], tile[1]) ? tile : null;

    // ------------------------------------------------------------ interaction target & prompts
    const cand = findCandidate(me.x, me.z);
    const toolId = TOOLS[s.tool].id;
    let prompt = cand?.prompt ?? null;
    let info = cand?.info ?? null;
    if (!cand && aim.tile && ['hoe', 'shovel', 'can', 'seeds'].includes(toolId)) info = describeTile(aim.tile[0], aim.tile[1]);
    if (s.dead) prompt = info = null;
    if (prompt !== s.prompt || info !== s.targetInfo) s.set({ prompt, targetInfo: info });

    // ------------------------------------------------------------ actions
    if (!busy && s.pointerLocked) {
      if (cand && keys.has('KeyE') && t >= p.interactAt) {
        p.interactAt = t + 450;
        anim.current.attackAt = t;
        sendAction({ a: 'interact', kind: cand.kind, id: cand.id });
      }
      if (mouse.left && t >= p.actAt) applyTool(toolId, s.seedIdx, s.buildIdx, s.buildRot, m.leftPressed, t);
      if (mouse.right && t >= p.actAt && toolId === 'shovel' && aim.tile) {
        p.actAt = t + 280;
        anim.current.attackAt = t;
        sendAction({ a: 'dig', tx: aim.tile[0], tz: aim.tile[1], up: sprint });
      }
      if (consumePress('KeyQ') && t >= s.abilityReadyAt) {
        s.set({ abilityReadyAt: t + def.ability.cd * 1000 });
        anim.current.attackAt = t;
        p.faceUntil = t + 500;
        me.ry = cam.yaw;
        if (s.myDino === 'raptor') {
          p.dashUntil = t + 360;
          p.dashX = fx;
          p.dashZ = fz;
          me.vy = 4;
        }
        sendAction({ a: 'ability', dir: [fx, 0, fz] });
      }
      if (consumePress('KeyX') && toolId === 'hammer') {
        const b = nearestBuilding(aim.hit ? aim.x : me.x + fx * 3, aim.hit ? aim.z : me.z + fz * 3);
        if (b) sendAction({ a: 'demolish', id: b });
      }
    }
    clearPresses();

    // ------------------------------------------------------------ network
    if (t >= p.sendAt && !s.dead) {
      p.sendAt = t + 66;
      send({ t: 'state', x: round(me.x), y: round(me.y), z: round(me.z), ry: round(me.ry), anim: me.anim });
    }

    function applyTool(id: string, seedIdx: number, buildIdx: number, rot: number, pressed: boolean, now: number) {
      if (id === 'club' || id === 'sling' || id === 'bola') {
        p.actAt = now + WEAPONS[id].cd * 1000;
        p.faceUntil = now + 600;
        anim.current.attackAt = now;
        const d = aim.dir;
        sendAction({ a: 'attack', tool: id, dir: id === 'club' ? [fx, 0, fz] : [d[0], d[1] + 0.05, d[2]] });
        return;
      }
      if (!aim.tile) return;
      const [tx, tz] = aim.tile;
      if (id === 'hammer') {
        if (!pressed) return;
        p.actAt = now + 250;
        sendAction({ a: 'build', tx, tz, type: BUILD_ORDER[buildIdx], rot });
        return;
      }
      p.actAt = now + 230;
      anim.current.attackAt = now;
      if (id === 'hoe') sendAction({ a: 'till', tx, tz });
      else if (id === 'shovel') sendAction({ a: 'clear', tx, tz });
      else if (id === 'can') sendAction({ a: 'water', tx, tz });
      else if (id === 'seeds') sendAction({ a: 'plant', tx, tz, sp: PLANT_ORDER[seedIdx] });
    }
  });

  return (
    <group ref={group}>
      <DinoModel type={myDino} accent={color} animRef={anim} />
    </group>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

function findCandidate(px: number, pz: number): Candidate | null {
  const s = game();
  let best: Candidate | null = null;
  let bestScore = Infinity;
  const consider = (x: number, z: number, r: number, make: () => Candidate | null) => {
    const d = Math.hypot(x - px, z - pz) - r;
    if (d > WORLD.INTERACT_RANGE) return;
    const da = aim.hit ? Math.hypot(x - aim.x, z - aim.z) : 4;
    const score = Math.max(0, d) + da * 0.7;
    if (score >= bestScore) return;
    const c = make();
    if (c) {
      best = c;
      bestScore = score;
    }
  };
  for (const n of Object.values(s.nodes)) {
    if (n.amount <= 0) continue;
    consider(n.x, n.z, n.kind === 'tree' ? 0.5 * n.s : 0.9 * n.s, () =>
      n.kind === 'tree'
        ? { kind: 'node', id: n.id, prompt: 'E · Chop tree', info: `${n.amount} wood left` }
        : { kind: 'node', id: n.id, prompt: 'E · Mine rock', info: `${n.amount} stone left` },
    );
  }
  for (const pl of Object.values(s.plants)) {
    const w = world.walkers.get(pl.id);
    const x = w ? w.x : pl.x;
    const z = w ? w.z : pl.z;
    consider(x, z, 0.3, () => {
      const def = PLANTS[pl.sp];
      if (pl.wild) {
        const danger = pl.sp === 'snapjaw' ? ' — careful, it bites!' : pl.sp === 'thornberry' ? ' — thorny!' : pl.sp === 'wanderroot' ? ' — catch it!' : '';
        return { kind: 'plant', id: pl.id, prompt: `E · Collect wild ${def.name} seeds`, info: `Wild plant${danger}` };
      }
      const wet = tileWet(tileIndex(pl.tx, pl.tz));
      const status = `${STAGES[pl.stage]} ${Math.round(pl.growth * 100)}% · tame ${pl.tame}% · ${wet ? '💧 watered' : '🏜️ dry — water it!'}`;
      if (pl.feral) return { kind: 'plant', id: pl.id, prompt: `E · Calm the FERAL ${def.name}`, info: `${def.feral} · tame ${pl.tame}% (60% calms it)` };
      if (pl.stage === 3 && pl.tame >= 100) return { kind: 'plant', id: pl.id, prompt: `E · Harvest ${def.name}`, info: status };
      if (pl.tame >= 100) return { kind: 'plant', id: pl.id, prompt: `${def.name} (tamed)`, info: `${status} · ${def.tamed}` };
      return { kind: 'plant', id: pl.id, prompt: `E · Tend ${def.name}`, info: status };
    });
  }
  for (const a of world.animals.values()) {
    const type = ANIMAL_KINDS[a.type];
    consider(a.x, a.z, ANIMALS[type].radius, () => ({
      kind: 'animal', id: a.id, prompt: `E · Feed ${ANIMALS[type].name} (1 🍖)`,
      info: a.hungry ? 'Hungry! It stopped producing.' : `Produces ${ANIMALS[type].produce} when fed`,
    }));
  }
  for (const b of Object.values(s.buildings)) {
    const def = BUILDINGS[b.type];
    consider(b.x, b.z, def.radius, () => {
      if (b.hp < def.hp) return { kind: 'building', id: b.id, prompt: `E · Repair ${def.name}`, info: `${b.hp}/${def.hp} hp` };
      if (b.type === 'house') return { kind: 'building', id: b.id, prompt: 'E · Trade at the Hut', info: 'Trades all eggs, wool & spores' };
      return null;
    });
  }
  return best;
}

function nearestBuilding(x: number, z: number): number | null {
  let best: number | null = null;
  let bd = 3;
  for (const b of Object.values(game().buildings)) {
    const d = Math.hypot(b.x - x, b.z - z) - BUILDINGS[b.type].radius;
    if (d < bd) {
      bd = d;
      best = b.id;
    }
  }
  return best;
}

function describeTile(tx: number, tz: number): string {
  const i = tileIndex(tx, tz);
  const h = (world.heights[tz * (WORLD.N + 1) + tx] + world.heights[tz * (WORLD.N + 1) + tx + 1]) / 2;
  if (h < 0) return 'Water · refill your can here';
  switch (world.tiles[i]) {
    case TILE_T.ROUGH:
      return 'Rough ground · clear it with the Shovel';
    case TILE_T.SAND:
      return 'Sand · too loose to farm';
    case TILE_T.SOIL:
      return lookup.plantByTile.has(i) ? 'Planted soil' : `Tilled soil · ${tileWet(i) ? '💧 watered' : 'dry'} · ready for seeds`;
    default:
      return 'Grass · till it with the Hoe';
  }
}

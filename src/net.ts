import { DINOS, WORLD, type DinoType } from '../shared/constants';
import type { Action, ClientMsg, ServerMsg } from '../shared/protocol';
import { game, useGame } from './store';
import { emitFx, makeEnt, world, type Ent } from './world';

let ws: WebSocket | null = null;
let lastDayUi = 0;

export function send(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export const sendAction = (act: Action) => send({ t: 'act', act });
export const sendChat = (text: string) => send({ t: 'chat', text });

/**
 * The game server URL. Same origin by default (local dev proxy, or the Node server hosting the build).
 * Static hosts like Vercel can't run the WebSocket server, so point VITE_SERVER_URL at it at build time,
 * e.g. VITE_SERVER_URL=https://dino-farm.onrender.com
 */
function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL?.trim().replace(/\/+$/, '');
  if (configured) return `${configured.replace(/^http/, 'ws')}/ws`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect(name: string, dino: DinoType) {
  const { set } = game();
  set({ phase: 'connecting', error: null, myName: name, myDino: dino, hp: DINOS[dino].hp, maxHp: DINOS[dino].hp });
  const socket = new WebSocket(serverUrl());
  ws = socket;
  let opened = false;
  socket.onopen = () => {
    opened = true;
    send({ t: 'join', name, dino });
  };
  socket.onmessage = (ev) => handle(JSON.parse(ev.data) as ServerMsg);
  socket.onclose = (ev) => {
    if (ws !== socket) return;
    ws = null;
    const error = opened
      ? `Lost connection to the farm server${ev.code === 1006 ? ' (it may have restarted)' : ''}. Join again to continue.`
      : import.meta.env.VITE_SERVER_URL
        ? 'Could not reach the game server. If it is on a free host it may be waking up — try again in ~30 seconds.'
        : 'Could not reach the game server. Locally, start it with "npm run dev". On a static host (e.g. Vercel), set VITE_SERVER_URL to your game server.';
    set({ phase: 'menu', error });
  };
}

/** Sync a Map<number, Ent> with a list of snapshot tuples; returns true when membership changed. */
function syncEnts<T extends number[]>(map: Map<number, Ent>, list: T[], apply: (e: Ent, t: T) => void): boolean {
  let changed = list.length !== map.size;
  const seen = new Set<number>();
  for (const t of list) {
    const id = t[0];
    seen.add(id);
    let e = map.get(id);
    if (!e) {
      e = makeEnt(id);
      map.set(id, e);
      changed = true;
    }
    apply(e, t);
  }
  for (const id of map.keys())
    if (!seen.has(id)) {
      map.delete(id);
      changed = true;
    }
  return changed;
}

function handle(m: ServerMsg) {
  const s = game();
  switch (m.t) {
    case 'welcome': {
      world.heights.set(m.heights);
      world.tiles.set(m.tiles);
      world.wetUntil.fill(0);
      for (const [i, u] of m.wet) world.wetUntil[i] = u;
      world.irr.fill(0);
      for (const i of m.irr) world.irr[i] = 1;
      world.heightsVersion++;
      for (let i = 0; i < WORLD.N * WORLD.N; i++) world.dirtyTiles.add(i);
      world.serverTime = m.now;
      world.serverTimeAt = performance.now();
      world.players.clear();
      world.enemies.clear();
      world.animals.clear();
      world.projectiles.clear();
      world.walkers.clear();
      [world.me.x, world.me.y, world.me.z] = m.spawn;
      world.me.vy = 0;
      s.set({
        phase: 'playing',
        myId: m.id,
        players: Object.fromEntries(m.players.map((p) => [p.id, p])),
        plants: Object.fromEntries(m.plants.map((p) => [p.id, p])),
        buildings: Object.fromEntries(m.buildings.map((b) => [b.id, b])),
        nodes: Object.fromEntries(m.nodes.map((n) => [n.id, n])),
        res: m.res,
        seeds: m.seeds,
        rain: m.rain,
        water: m.water,
        raid: { ...m.raid, status: m.raid.active ? 'active' : 'calm' },
        dead: false,
      });
      return;
    }
    case 's': {
      world.serverTime = m.now;
      world.serverTimeAt = performance.now();
      const hpChanges: Record<number, number> = {};
      let hpChanged = false;
      syncEnts(world.players, m.p, (e, [id, x, y, z, ry, anim, hp, dead]) => {
        e.tx = x;
        e.ty = y;
        e.tz = z;
        e.try = ry;
        e.anim = anim;
        e.dead = dead === 1;
        if (e.hp !== hp) {
          e.hp = hp;
          hpChanges[id] = hp;
          hpChanged = true;
        }
      });
      const enemiesChanged = syncEnts(world.enemies, m.e, (e, [, type, x, y, z, ry, hp, maxHp, slowed]) => {
        e.type = type;
        e.tx = x;
        e.ty = y;
        e.tz = z;
        e.try = ry;
        e.hp = hp;
        e.maxHp = maxHp;
        e.slowed = slowed === 1;
      });
      const animalsChanged = syncEnts(world.animals, m.a, (e, [, type, x, y, z, ry, hungry]) => {
        e.type = type;
        e.tx = x;
        e.ty = y;
        e.tz = z;
        e.try = ry;
        e.hungry = hungry === 1;
      });
      const projChanged = syncEnts(world.projectiles, m.j, (e, [, kind, x, y, z]) => {
        e.type = kind;
        e.tx = x;
        e.ty = y;
        e.tz = z;
      });
      for (const [id, x, z] of m.w) world.walkers.set(id, { x, z });

      const patch: Partial<typeof s> = {};
      if (enemiesChanged) patch.enemyIds = [...world.enemies.keys()];
      if (animalsChanged) patch.animalIds = [...world.animals.keys()];
      if (projChanged) patch.projectileIds = [...world.projectiles.keys()];
      if (hpChanged) patch.playerHp = { ...s.playerHp, ...hpChanges };
      const t = performance.now();
      if (t - lastDayUi > 500) {
        lastDayUi = t;
        patch.day = m.day;
        patch.dayCount = Math.floor((m.now + WORLD.DAY_LENGTH * 0.3) / WORLD.DAY_LENGTH) + 1;
      }
      if (Object.keys(patch).length) s.set(patch);
      return;
    }
    case 'join':
      s.set({ players: { ...s.players, [m.info.id]: m.info } });
      return;
    case 'leave': {
      const players = { ...s.players };
      delete players[m.id];
      world.players.delete(m.id);
      s.set({ players });
      return;
    }
    case 'tiles':
      for (const [i, type, wet] of m.list) {
        world.tiles[i] = type;
        world.wetUntil[i] = wet;
        world.dirtyTiles.add(i);
      }
      return;
    case 'heights': {
      const V = WORLD.N + 1;
      for (const [vi, h] of m.list) {
        world.heights[vi] = h;
        const vx = vi % V;
        const vz = Math.floor(vi / V);
        for (let dz = -1; dz <= 0; dz++)
          for (let dx = -1; dx <= 0; dx++) {
            const tx = vx + dx;
            const tz = vz + dz;
            if (tx >= 0 && tz >= 0 && tx < WORLD.N && tz < WORLD.N) world.dirtyTiles.add(tz * WORLD.N + tx);
          }
      }
      world.heightsVersion++;
      return;
    }
    case 'irr': {
      const next = new Uint8Array(WORLD.N * WORLD.N);
      for (const i of m.list) next[i] = 1;
      for (let i = 0; i < next.length; i++) if (next[i] !== world.irr[i]) world.dirtyTiles.add(i);
      world.irr.set(next);
      return;
    }
    case 'plant':
      if (!m.p.wild) world.walkers.delete(m.p.id);
      s.set({ plants: { ...s.plants, [m.p.id]: m.p } });
      return;
    case 'plantGone': {
      const plants = { ...s.plants };
      delete plants[m.id];
      world.walkers.delete(m.id);
      s.set({ plants });
      return;
    }
    case 'building':
      s.set({ buildings: { ...s.buildings, [m.b.id]: m.b } });
      return;
    case 'buildingGone': {
      const buildings = { ...s.buildings };
      delete buildings[m.id];
      s.set({ buildings });
      return;
    }
    case 'node': {
      const n = s.nodes[m.id];
      if (n) s.set({ nodes: { ...s.nodes, [m.id]: { ...n, amount: m.amount } } });
      return;
    }
    case 'res':
      s.set({ res: m.res });
      return;
    case 'seeds':
      s.set({ seeds: m.seeds });
      return;
    case 'can':
      s.set({ water: m.water });
      return;
    case 'hurt':
      s.set({ hp: m.hp });
      if (m.dmg > 0) emitFx({ k: 'hit', x: world.me.x, y: world.me.y + 1.2, z: world.me.z });
      return;
    case 'died':
      s.set({ dead: true, deathBy: m.by, hp: 0 });
      return;
    case 'respawn':
      [world.me.x, world.me.y, world.me.z] = m.pos;
      world.me.vy = 0;
      s.set({ dead: false, hp: s.maxHp });
      return;
    case 'fx':
      emitFx(m);
      return;
    case 'msg':
      s.toast(m.text, m.kind);
      return;
    case 'chat':
      s.addChat({ from: m.from, color: m.color, text: m.text });
      return;
    case 'raid':
      s.set({
        raid: {
          wave: m.wave,
          next: m.next,
          active: m.state === 'start',
          status: m.state === 'warn' ? 'warn' : m.state === 'start' ? 'active' : 'calm',
        },
      });
      if (m.state === 'warn') s.toast(`⚠️ Raid ${m.wave} incoming in 20 seconds! Defend the farm!`, 'warn');
      if (m.state === 'start') s.toast(`🦎 Raid ${m.wave} has begun!`, 'warn');
      return;
    case 'weather':
      s.set({ rain: m.rain });
      return;
  }
}

export function isConnected() {
  return useGame.getState().phase === 'playing';
}

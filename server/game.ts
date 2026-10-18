import type { WebSocket } from 'ws';
import {
  ANIMALS,
  BUILDINGS,
  CAN_CAPACITY,
  DINOS,
  ENEMIES,
  HUNGER_DECAY,
  PLANTS,
  PLANT_ORDER,
  PLAYER_COLORS,
  RAID,
  TAME,
  TILE_T,
  TRADE,
  WEAPONS,
  WORLD,
  canAfford,
  type AnimalType,
  type BuildingType,
  type Cost,
  type DinoType,
  type EnemyType,
  type PlantSpecies,
  type ResourceKey,
  type Resources,
  type SeedStock,
} from '../shared/constants';
import {
  LAKES,
  generateWorld,
  heightAt,
  inBounds,
  isWaterTile,
  mulberry32,
  surfaceAt,
  tileAt,
  tileCenter,
  tileCorners,
  tileIndex,
} from '../shared/terrain';
import {
  ANIMAL_KINDS,
  ENEMY_KINDS,
  type Action,
  type BuildingView,
  type ClientMsg,
  type FxKind,
  type NodeView,
  type PlantView,
  type PlayerInfo,
  type ServerMsg,
} from '../shared/protocol';

const { N, HALF } = WORLD;
const DT = 1 / WORLD.TICK_RATE;
const r2 = (v: number) => Math.round(v * 100) / 100;
const hyp = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

interface Player extends PlayerInfo {
  ws: WebSocket;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  respawnAt: number;
  lastHurt: number;
  cds: Record<string, number>;
  water: number;
}

interface Plant extends PlantView {
  ripeAt: number;
  nextAct: number;
  lastTend: number;
  tb: number;
  walkTo: [number, number] | null;
  walkPause: number;
  wiltAt: number;
}

interface Building extends BuildingView {
  nextAct: number;
}

interface Animal {
  id: number;
  type: AnimalType;
  x: number;
  y: number;
  z: number;
  ry: number;
  hp: number;
  hunger: number;
  home: number | null;
  hx: number;
  hz: number;
  goal: [number, number];
  wanderAt: number;
  nextProduce: number;
}

type TargetKind = 'player' | 'animal' | 'plant' | 'building';
interface Target {
  kind: TargetKind;
  id: number;
}

interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  z: number;
  ry: number;
  hp: number;
  maxHp: number;
  dmg: number;
  slowUntil: number;
  nextAttack: number;
  retarget: number;
  target: Target | null;
}

interface Projectile {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  life: number;
  dmg: number;
  slow: number;
}

interface ResNode extends NodeView {
  max: number;
  respawnAt: number;
}

// indices into PROJECTILE_KINDS
const PK = { stone: 0, bola: 1, boulder: 2, bolt: 3 } as const;

export class Game {
  private nextId = 1;
  private now = 0;
  private rng: () => number;
  private heights: Float32Array;
  private tiles: Uint8Array;
  private wet = new Float32Array(N * N);
  private irr = new Uint8Array(N * N);
  private irrDirty = true;
  private tilePlant = new Int32Array(N * N);

  private players = new Map<number, Player>();
  private plants = new Map<number, Plant>();
  private buildings = new Map<number, Building>();
  private animals = new Map<number, Animal>();
  private enemies = new Map<number, Enemy>();
  private projectiles = new Map<number, Projectile>();
  private nodes = new Map<number, ResNode>();

  private res: Resources = { wood: 40, stone: 20, food: 12, eggs: 0, wool: 0, nectar: 1, spores: 2 };
  private seeds: Record<PlantSpecies, SeedStock> = {
    snapjaw: { wild: 3, heirloom: 0 },
    thornberry: { wild: 2, heirloom: 0 },
    wanderroot: { wild: 1, heirloom: 0 },
    glowcap: { wild: 1, heirloom: 0 },
    sunbloom: { wild: 0, heirloom: 0 },
  };
  private resDirty = false;
  private rain = false;
  private weatherNext = 200;
  private raid = { wave: 0, active: false, next: RAID.FIRST, warned: false };
  private slowTick = 0;

  constructor(seed: number, opts: { raidFirst?: number } = {}) {
    if (opts.raidFirst) this.raid.next = opts.raidFirst;
    this.rng = mulberry32(seed ^ 0x5eed);
    const w = generateWorld(seed);
    this.heights = w.heights;
    this.tiles = w.tiles;
    this.setupStartingFarm();
    this.spawnNodes();
    for (let i = 0; i < 45; i++) this.spawnWildPlant();
    this.computeIrrigation();
  }

  start() {
    setInterval(() => this.tick(), 1000 / WORLD.TICK_RATE);
  }

  // ================================================================ setup
  private uid() {
    return this.nextId++;
  }

  private setupStartingFarm() {
    this.placeBuilding('house', ...tileAt(0, -9), 0);
    this.placeBuilding('coop', ...tileAt(10, -8), 0);
    for (let tz = 0; tz < 2; tz++)
      for (let tx = 0; tx < 4; tx++) {
        const [x, z] = tileAt(-8 + tx * 2, 4 + tz * 2);
        this.tiles[tileIndex(x, z)] = TILE_T.SOIL;
      }
  }

  private spawnNodes() {
    const free = (x: number, z: number, d: number) => [...this.nodes.values()].every((n) => hyp(n.x, n.z, x, z) > d);
    for (let tries = 0, made = 0; tries < 2500 && made < 190; tries++) {
      const x = (this.rng() * 2 - 1) * (HALF - 8);
      const z = (this.rng() * 2 - 1) * (HALF - 8);
      const h = heightAt(this.heights, x, z);
      if (h < 0.7 || h > 11 || Math.hypot(x, z) < 15 || !free(x, z, 3.2)) continue;
      const s = 0.8 + this.rng() * 0.6;
      this.nodes.set(this.nextId, { id: this.uid(), kind: 'tree', x: r2(x), z: r2(z), s: r2(s), v: Math.floor(this.rng() * 3), amount: 6, max: 6, respawnAt: 0 });
      made++;
    }
    for (let tries = 0, made = 0; tries < 2000 && made < 70; tries++) {
      const x = (this.rng() * 2 - 1) * (HALF - 6);
      const z = (this.rng() * 2 - 1) * (HALF - 6);
      const h = heightAt(this.heights, x, z);
      if (h < 0.3 || Math.hypot(x, z) < 12 || !free(x, z, 3)) continue;
      const s = 0.7 + this.rng() * 0.8;
      this.nodes.set(this.nextId, { id: this.uid(), kind: 'rock', x: r2(x), z: r2(z), s: r2(s), v: Math.floor(this.rng() * 3), amount: 5, max: 5, respawnAt: 0 });
      made++;
    }
  }

  private spawnWildPlant(species?: PlantSpecies, at?: [number, number]) {
    let x = 0;
    let z = 0;
    if (at) [x, z] = at;
    else {
      let ok = false;
      for (let t = 0; t < 40 && !ok; t++) {
        x = (this.rng() * 2 - 1) * (HALF - 14);
        z = (this.rng() * 2 - 1) * (HALF - 14);
        const h = heightAt(this.heights, x, z);
        ok = h > 0.5 && h < 8 && Math.hypot(x, z) > 24 && !this.buildingAt(x, z, 1);
      }
      if (!ok) return;
    }
    if (!species) {
      const total = PLANT_ORDER.reduce((s, k) => s + PLANTS[k].wildWeight, 0);
      let roll = this.rng() * total;
      species = PLANT_ORDER.find((k) => (roll -= PLANTS[k].wildWeight) < 0) ?? 'snapjaw';
    }
    const p = this.newPlant(species, x, z, -1, -1, true, 0);
    p.stage = 3;
    p.growth = 1;
    this.plants.set(p.id, p);
    return p;
  }

  private newPlant(sp: PlantSpecies, x: number, z: number, tx: number, tz: number, wild: boolean, tame: number): Plant {
    return {
      id: this.uid(), sp, x: r2(x), z: r2(z), tx, tz, wild, stage: 0, growth: 0, tame, feral: false,
      ripeAt: 0, nextAct: 0, lastTend: -10, tb: Math.floor(tame / 5), walkTo: null, walkPause: 0, wiltAt: 0,
    };
  }

  // ================================================================ messaging
  private send(p: Player, msg: ServerMsg) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }

  private toast(p: Player | null, text: string, kind: 'info' | 'warn' | 'good' = 'warn') {
    if (p) this.send(p, { t: 'msg', text, kind });
    else this.broadcast({ t: 'msg', text, kind });
  }

  private fx(k: FxKind, x: number, y: number, z: number, extra: { dx?: number; dz?: number; r?: number } = {}) {
    this.broadcast({ t: 'fx', k, x: r2(x), y: r2(y), z: r2(z), ...extra });
  }

  private sendTiles(idxs: number[]) {
    this.broadcast({ t: 'tiles', list: idxs.map((i) => [i, this.tiles[i], r2(this.wet[i])]) });
  }

  private sendHeights(vis: number[]) {
    this.broadcast({ t: 'heights', list: vis.map((v) => [v, r2(this.heights[v])]) });
    this.irrDirty = true;
  }

  private plantView(p: Plant): PlantView {
    return { id: p.id, sp: p.sp, x: r2(p.x), z: r2(p.z), tx: p.tx, tz: p.tz, wild: p.wild, stage: p.stage, growth: r2(p.growth), tame: Math.round(p.tame), feral: p.feral };
  }

  private buildingView(b: Building): BuildingView {
    return { id: b.id, type: b.type, x: b.x, z: b.z, rot: b.rot, hp: Math.round(b.hp) };
  }

  private nodeView(n: ResNode): NodeView {
    return { id: n.id, kind: n.kind, x: n.x, z: n.z, s: n.s, v: n.v, amount: n.amount };
  }

  private gain(cost: Cost, mult = 1) {
    for (const k of Object.keys(cost) as ResourceKey[]) this.res[k] += (cost[k] ?? 0) * mult;
    this.resDirty = true;
  }

  // ================================================================ players
  addPlayer(ws: WebSocket, rawName: string, rawDino: DinoType): number {
    const dino: DinoType = rawDino in DINOS ? rawDino : 'raptor';
    const name = String(rawName || 'Dino').replace(/[<>]/g, '').slice(0, 16) || 'Dino';
    const id = this.uid();
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[id % PLAYER_COLORS.length];
    const [x, y, z] = this.spawnPoint();
    const def = DINOS[dino];
    const p: Player = {
      id, ws, name, dino, color, x, y, z, ry: 0, anim: 0, hp: def.hp, maxHp: def.hp,
      dead: false, respawnAt: 0, lastHurt: -99, cds: {}, water: CAN_CAPACITY,
    };
    this.players.set(id, p);
    const wet: [number, number][] = [];
    this.wet.forEach((u, i) => u > this.now && wet.push([i, r2(u)]));
    const irr: number[] = [];
    this.irr.forEach((v, i) => v && irr.push(i));
    this.send(p, {
      t: 'welcome', id, now: r2(this.now),
      heights: Array.from(this.heights, r2), tiles: Array.from(this.tiles), wet, irr,
      plants: [...this.plants.values()].map((pl) => this.plantView(pl)),
      buildings: [...this.buildings.values()].map((b) => this.buildingView(b)),
      nodes: [...this.nodes.values()].map((n) => this.nodeView(n)),
      res: this.res, seeds: this.seeds,
      players: [...this.players.values()].map(({ id, name, dino, color }) => ({ id, name, dino, color })),
      rain: this.rain, raid: { wave: this.raid.wave, active: this.raid.active, next: this.raid.next },
      spawn: [x, y, z], water: p.water,
    });
    this.broadcast({ t: 'join', info: { id, name, dino, color } });
    this.toast(null, `${name} the ${def.name} joined the farm!`, 'info');
    return id;
  }

  removePlayer(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.broadcast({ t: 'leave', id });
    this.toast(null, `${p.name} left the farm.`, 'info');
  }

  private spawnPoint(): [number, number, number] {
    const huts = [...this.buildings.values()].filter((b) => b.type === 'house');
    const h = huts[Math.floor(this.rng() * huts.length)];
    const x = (h ? h.x : 0) + (this.rng() - 0.5) * 3;
    const z = (h ? h.z + 4 : 3) + this.rng() * 2;
    return [r2(x), r2(surfaceAt(this.heights, x, z) + 0.5), r2(z)];
  }

  private hurtPlayer(p: Player, dmg: number, by: string) {
    if (p.dead) return;
    p.hp -= dmg;
    p.lastHurt = this.now;
    this.send(p, { t: 'hurt', hp: Math.max(0, Math.round(p.hp)), dmg });
    if (p.hp <= 0) {
      p.dead = true;
      p.respawnAt = this.now + 6;
      this.send(p, { t: 'died', by });
      this.toast(null, `${p.name} was knocked out by ${by}!`, 'warn');
    }
  }

  handle(id: number, msg: ClientMsg) {
    const p = this.players.get(id);
    if (!p) return;
    switch (msg.t) {
      case 'state':
        if (p.dead) return;
        if (![msg.x, msg.y, msg.z, msg.ry].every(Number.isFinite)) return;
        p.x = Math.max(-HALF + 1, Math.min(HALF - 1, msg.x));
        p.z = Math.max(-HALF + 1, Math.min(HALF - 1, msg.z));
        p.y = Math.min(60, msg.y);
        p.ry = msg.ry;
        p.anim = msg.anim | 0;
        break;
      case 'chat': {
        const text = String(msg.text).slice(0, 200).trim();
        if (text) this.broadcast({ t: 'chat', from: p.name, color: p.color, text });
        break;
      }
      case 'act':
        if (!p.dead && msg.act) this.act(p, msg.act);
        break;
    }
  }

  // ================================================================ actions
  private nearTile(p: Player, tx: number, tz: number) {
    if (!inBounds(tx, tz)) return false;
    const [cx, cz] = tileCenter(tx, tz);
    return hyp(p.x, p.z, cx, cz) <= WORLD.REACH + 1.5;
  }

  private buildingAt(x: number, z: number, pad = 0): Building | undefined {
    for (const b of this.buildings.values()) if (hyp(b.x, b.z, x, z) < BUILDINGS[b.type].radius + pad) return b;
    return undefined;
  }

  private act(p: Player, a: Action) {
    switch (a.a) {
      case 'till':
      case 'clear':
      case 'dig':
      case 'water':
      case 'plant':
      case 'build': {
        if (!this.nearTile(p, a.tx, a.tz)) return;
        this.tileAction(p, a);
        return;
      }
      case 'demolish': {
        const b = this.buildings.get(a.id);
        if (!b || hyp(p.x, p.z, b.x, b.z) > WORLD.REACH + 3) return;
        const def = BUILDINGS[b.type];
        const refund: Cost = {};
        for (const k of Object.keys(def.cost) as ResourceKey[]) refund[k] = Math.floor((def.cost[k] ?? 0) / 2);
        this.gain(refund);
        this.removeBuilding(b);
        this.toast(p, `Demolished ${def.name} (half refunded)`, 'info');
        return;
      }
      case 'interact':
        this.interact(p, a.kind, a.id);
        return;
      case 'attack':
        this.attack(p, a.tool, a.dir);
        return;
      case 'ability':
        this.ability(p, a.dir);
        return;
      case 'heal': {
        if (this.res.nectar < 1) return this.toast(p, 'No nectar! Grow and tame Sunblooms.');
        if (p.hp >= p.maxHp) return this.toast(p, 'Already at full health', 'info');
        this.res.nectar--;
        this.resDirty = true;
        p.hp = Math.min(p.maxHp, p.hp + 50);
        this.send(p, { t: 'hurt', hp: Math.round(p.hp), dmg: 0 });
        this.fx('heal', p.x, p.y + 1, p.z);
        return;
      }
    }
  }

  private tileAction(p: Player, a: Extract<Action, { tx: number }>) {
    const { tx, tz } = a;
    const i = tileIndex(tx, tz);
    const [cx, cz] = tileCenter(tx, tz);
    const water = isWaterTile(this.heights, tx, tz);
    const plantId = this.tilePlant[i];
    const covered = this.buildingAt(cx, cz, 0.2);
    const cy = heightAt(this.heights, cx, cz);

    switch (a.a) {
      case 'till': {
        if (water) return this.toast(p, "Can't till underwater");
        if (covered) return this.toast(p, 'Something is built here');
        const t = this.tiles[i];
        if (t === TILE_T.ROUGH) return this.toast(p, 'Too rocky — clear it with the Shovel first');
        if (t === TILE_T.SAND) return this.toast(p, 'Sand is too loose to farm');
        if (t === TILE_T.SOIL) return;
        this.tiles[i] = TILE_T.SOIL;
        this.sendTiles([i]);
        this.fx('dust', cx, cy, cz);
        return;
      }
      case 'clear': {
        if (plantId) {
          const pl = this.plants.get(plantId)!;
          const kind = pl.tame >= TAME.HEIRLOOM_START && !pl.feral ? 'heirloom' : 'wild';
          this.seeds[pl.sp][kind]++;
          this.removePlant(pl);
          this.broadcast({ t: 'seeds', seeds: this.seeds });
          this.toast(p, `Uprooted ${PLANTS[pl.sp].name} (+1 ${kind} seed)`, 'info');
          this.fx('dust', cx, cy, cz);
          return;
        }
        if (this.tiles[i] === TILE_T.ROUGH) {
          this.tiles[i] = TILE_T.GRASS;
          this.sendTiles([i]);
          if (this.rng() < 0.5) this.gain({ stone: 1 });
          this.fx('dust', cx, cy, cz);
          return;
        }
        if (water || covered) return;
        const cs = tileCorners(tx, tz);
        const avg = cs.reduce((s, v) => s + this.heights[v], 0) / 4;
        for (const v of cs) this.heights[v] = avg;
        this.sendHeights(cs);
        this.fx('dust', cx, avg, cz);
        return;
      }
      case 'dig': {
        if (plantId) return this.toast(p, 'Uproot the plant first (Shovel left-click)');
        if (covered) return this.toast(p, 'Something is built here');
        const cs = tileCorners(tx, tz);
        for (const v of cs) this.heights[v] = Math.max(-3.5, Math.min(14, this.heights[v] + (a.up ? 0.35 : -0.35)));
        this.sendHeights(cs);
        if (!a.up && this.rng() < 0.25) this.gain({ stone: 1 });
        this.fx(isWaterTile(this.heights, tx, tz) ? 'splash' : 'dust', cx, cy, cz);
        // neighbouring plants may have just been flooded
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = tx + dx;
            const nz = tz + dz;
            if (!inBounds(nx, nz)) continue;
            const pid = this.tilePlant[tileIndex(nx, nz)];
            if (pid && isWaterTile(this.heights, nx, nz)) {
              const pl = this.plants.get(pid)!;
              this.removePlant(pl);
              this.toast(null, `A ${PLANTS[pl.sp].name} drowned!`);
            }
          }
        return;
      }
      case 'water': {
        const standingInWater = heightAt(this.heights, p.x, p.z) < -0.2;
        if (water || standingInWater) {
          p.water = CAN_CAPACITY;
          this.send(p, { t: 'can', water: p.water });
          this.fx('splash', cx, Math.max(cy, -0.3), cz);
          return this.toast(p, 'Watering can refilled', 'good');
        }
        if (this.tiles[i] !== TILE_T.SOIL) return this.toast(p, 'Only tilled soil needs water', 'info');
        if (p.dino !== 'spino') {
          if (p.water <= 0) return this.toast(p, 'Watering can is empty — refill it at water');
          p.water--;
          this.send(p, { t: 'can', water: p.water });
        }
        this.wet[i] = this.now + 120;
        this.sendTiles([i]);
        this.fx('splash', cx, cy, cz);
        return;
      }
      case 'plant': {
        if (!(a.sp in PLANTS)) return;
        if (this.tiles[i] !== TILE_T.SOIL || water) return this.toast(p, 'Plant on tilled soil (use the Hoe)');
        if (plantId) return this.toast(p, 'Already planted here');
        if (covered) return this.toast(p, 'Something is built here');
        const stock = this.seeds[a.sp];
        if (stock.wild + stock.heirloom <= 0) return this.toast(p, `No ${PLANTS[a.sp].name} seeds — collect them from wild plants`);
        const heir = stock.heirloom > 0;
        if (heir) stock.heirloom--;
        else stock.wild--;
        const pl = this.newPlant(a.sp, cx, cz, tx, tz, false, heir ? TAME.HEIRLOOM_START : 0);
        this.plants.set(pl.id, pl);
        this.tilePlant[i] = pl.id;
        this.broadcast({ t: 'plant', p: this.plantView(pl) });
        this.broadcast({ t: 'seeds', seeds: this.seeds });
        this.fx('dust', cx, cy, cz);
        return;
      }
      case 'build': {
        const def = BUILDINGS[a.type];
        if (!def) return;
        if (water) return this.toast(p, "Can't build on water");
        if (!canAfford(this.res, def.cost)) return this.toast(p, `Not enough resources for ${def.name}`);
        const why = this.buildBlocked(a.type, cx, cz);
        if (why) return this.toast(p, why);
        for (const k of Object.keys(def.cost) as ResourceKey[]) this.res[k] -= def.cost[k] ?? 0;
        this.resDirty = true;
        this.placeBuilding(a.type, tx, tz, a.rot);
        this.fx('build', cx, cy, cz, { r: def.radius });
        return;
      }
    }
  }

  private buildBlocked(type: BuildingType, x: number, z: number): string | null {
    const r = BUILDINGS[type].radius;
    for (const b of this.buildings.values()) if (hyp(b.x, b.z, x, z) < (r + BUILDINGS[b.type].radius) * 0.85) return 'Too close to another building';
    for (const n of this.nodes.values()) if (n.amount > 0 && hyp(n.x, n.z, x, z) < r + 0.8 * n.s) return 'A tree or rock is in the way';
    for (const pl of this.plants.values()) if (!pl.wild && hyp(pl.x, pl.z, x, z) < r + 0.3) return 'A plant is in the way';
    return null;
  }

  private placeBuilding(type: BuildingType, tx: number, tz: number, rot: number) {
    const def = BUILDINGS[type];
    const [x, z] = tileCenter(tx, tz);
    const b: Building = { id: this.uid(), type, x, z, rot: ((rot | 0) % 4 + 4) % 4, hp: def.hp, nextAct: 0 };
    this.buildings.set(b.id, b);
    if (def.animal) for (let i = 0; i < (def.animalCount ?? 1); i++) this.spawnAnimal(def.animal, b);
    if (type === 'well') this.irrDirty = true;
    this.broadcast({ t: 'building', b: this.buildingView(b) });
    return b;
  }

  private removeBuilding(b: Building) {
    this.buildings.delete(b.id);
    for (const a of this.animals.values()) if (a.home === b.id) a.home = null;
    if (b.type === 'well') this.irrDirty = true;
    this.broadcast({ t: 'buildingGone', id: b.id });
  }

  private removePlant(pl: Plant) {
    this.plants.delete(pl.id);
    if (!pl.wild && pl.tx >= 0) {
      const i = tileIndex(pl.tx, pl.tz);
      if (this.tilePlant[i] === pl.id) this.tilePlant[i] = 0;
    }
    this.broadcast({ t: 'plantGone', id: pl.id });
  }

  private spawnAnimal(type: AnimalType, home: Building) {
    const a: Animal = {
      id: this.uid(), type, x: home.x + (this.rng() - 0.5) * 4, y: 0, z: home.z + 3 + this.rng() * 2, ry: 0,
      hp: ANIMALS[type].hp, hunger: 60, home: home.id, hx: home.x, hz: home.z, goal: [home.x, home.z + 3],
      wanderAt: 0, nextProduce: this.now + ANIMALS[type].interval,
    };
    a.y = surfaceAt(this.heights, a.x, a.z);
    this.animals.set(a.id, a);
  }

  private interact(p: Player, kind: 'node' | 'plant' | 'animal' | 'building', id: number) {
    const range = WORLD.INTERACT_RANGE + 1.5;
    if (kind === 'node') {
      const n = this.nodes.get(id);
      if (!n || n.amount <= 0 || hyp(p.x, p.z, n.x, n.z) > range + n.s) return;
      if ((p.cds.gather ?? 0) > this.now) return;
      p.cds.gather = this.now + 0.45;
      n.amount--;
      if (n.amount <= 0) n.respawnAt = this.now + 120;
      const mult = DINOS[p.dino].gatherMult;
      this.gain(n.kind === 'tree' ? { wood: mult } : { stone: mult });
      this.broadcast({ t: 'node', id: n.id, amount: n.amount });
      this.fx('hit', n.x, heightAt(this.heights, n.x, n.z) + 1.2, n.z);
      return;
    }
    if (kind === 'plant') {
      const pl = this.plants.get(id);
      if (!pl || hyp(p.x, p.z, pl.x, pl.z) > range) return;
      const def = PLANTS[pl.sp];
      const py = heightAt(this.heights, pl.x, pl.z);
      if (pl.wild) {
        const n = 1 + (this.rng() < 0.45 ? 1 : 0);
        this.seeds[pl.sp].wild += n;
        this.removePlant(pl);
        this.broadcast({ t: 'seeds', seeds: this.seeds });
        this.toast(p, `+${n} wild ${def.name} seed${n > 1 ? 's' : ''}`, 'good');
        this.fx('harvest', pl.x, py + 0.5, pl.z);
        if (pl.sp === 'snapjaw' && this.rng() < 0.6) this.hurtPlayer(p, 8, 'a wild Snapjaw');
        if (pl.sp === 'thornberry') this.hurtPlayer(p, 4, 'thorns');
        if (pl.sp === 'glowcap' && this.rng() < 0.5) this.hurtPlayer(p, 3, 'stinging spores');
        return;
      }
      if (pl.stage === 3 && pl.tame >= 100 && !pl.feral) {
        this.gain(def.produce);
        this.seeds[pl.sp].heirloom += def.regrows ? 1 : 2;
        this.broadcast({ t: 'seeds', seeds: this.seeds });
        const what = Object.entries(def.produce).map(([k, v]) => `+${v} ${k}`).join(', ');
        this.toast(p, `Harvested ${def.name}: ${what}, +${def.regrows ? 1 : 2} heirloom seed`, 'good');
        this.fx('harvest', pl.x, py + 0.6, pl.z);
        if (def.regrows) {
          pl.growth = 0.34;
          pl.stage = 1;
          this.broadcast({ t: 'plant', p: this.plantView(pl) });
        } else this.removePlant(pl);
        return;
      }
      if (this.now - pl.lastTend < 0.9) return;
      pl.lastTend = this.now;
      const before = pl.tame;
      if (pl.feral) {
        pl.tame = Math.min(100, pl.tame + TAME.TEND * 0.6);
        if (pl.tame >= 60) {
          pl.feral = false;
          pl.ripeAt = this.now;
          this.toast(p, `You calmed the ${def.name} down`, 'good');
        }
      } else pl.tame = Math.min(100, pl.tame + TAME.TEND);
      if (before < 100 && pl.tame >= 100) this.toast(null, `${p.name} fully tamed a ${def.name}! 🌿`, 'good');
      if (pl.sp === 'snapjaw' && pl.tame < 40 && this.rng() < 0.3) this.hurtPlayer(p, 5, 'a grumpy Snapjaw');
      this.fx('heal', pl.x, py + 0.8, pl.z);
      this.broadcast({ t: 'plant', p: this.plantView(pl) });
      return;
    }
    if (kind === 'animal') {
      const an = this.animals.get(id);
      if (!an || hyp(p.x, p.z, an.x, an.z) > range + 1) return;
      if (an.hunger > 85) return this.toast(p, `The ${ANIMALS[an.type].name} isn't hungry`, 'info');
      if (this.res.food < 1) return this.toast(p, 'No food! Harvest tamed plants.');
      this.res.food--;
      this.resDirty = true;
      an.hunger = 100;
      this.fx('heal', an.x, an.y + 1.2, an.z);
      return;
    }
    if (kind === 'building') {
      const b = this.buildings.get(id);
      if (!b || hyp(p.x, p.z, b.x, b.z) > range + BUILDINGS[b.type].radius) return;
      const def = BUILDINGS[b.type];
      if (b.hp < def.hp) {
        const mat: ResourceKey = def.cost.stone && !def.cost.wood ? 'stone' : 'wood';
        if (this.res[mat] < 1) return this.toast(p, `Need ${mat} to repair`);
        this.res[mat]--;
        this.resDirty = true;
        b.hp = Math.min(def.hp, b.hp + def.hp * 0.25);
        this.broadcast({ t: 'building', b: this.buildingView(b) });
        this.fx('build', b.x, heightAt(this.heights, b.x, b.z), b.z, { r: def.radius });
        return;
      }
      if (b.type === 'house') {
        const gained: Cost = {};
        let traded = false;
        for (const [k, out] of Object.entries(TRADE) as [ResourceKey, Cost][]) {
          const n = this.res[k];
          if (n <= 0) continue;
          traded = true;
          this.res[k] = 0;
          for (const [ok, ov] of Object.entries(out) as [ResourceKey, number][]) gained[ok] = (gained[ok] ?? 0) + ov * n;
        }
        if (!traded) return this.toast(p, 'Trade post: bring eggs, wool or spores to trade', 'info');
        this.gain(gained);
        this.toast(p, `Traded for ${Object.entries(gained).map(([k, v]) => `${v} ${k}`).join(', ')}`, 'good');
      }
    }
  }

  private attack(p: Player, tool: 'club' | 'sling' | 'bola', rawDir: [number, number, number]) {
    const w = WEAPONS[tool];
    if (!w || (p.cds[tool] ?? 0) > this.now) return;
    p.cds[tool] = this.now + w.cd * 0.9;
    const [dx, dy, dz] = norm3(rawDir);
    if (tool === 'club') {
      const hl = Math.hypot(dx, dz) || 1;
      for (const e of this.enemies.values()) {
        const r = ENEMIES[e.type].radius;
        const ex = e.x - p.x;
        const ez = e.z - p.z;
        const d = Math.hypot(ex, ez);
        if (d > WEAPONS.club.range + r) continue;
        if (d > r && (ex * dx + ez * dz) / (d * hl) < 0.2) continue;
        this.hurtEnemy(e, WEAPONS.club.dmg);
      }
      this.fx('swing', p.x, p.y + 1, p.z, { dx: r2(dx), dz: r2(dz) });
      return;
    }
    const spec = tool === 'sling' ? WEAPONS.sling : WEAPONS.bola;
    this.projectiles.set(this.nextId, {
      id: this.uid(), kind: tool === 'sling' ? PK.stone : PK.bola,
      x: p.x + dx, y: p.y + 1.6 + dy, z: p.z + dz,
      vx: dx * spec.speed, vy: dy * spec.speed + 2, vz: dz * spec.speed,
      g: spec.gravity, life: spec.life, dmg: spec.dmg, slow: tool === 'bola' ? WEAPONS.bola.slow : 0,
    });
  }

  private ability(p: Player, rawDir: [number, number, number]) {
    const def = DINOS[p.dino];
    if ((p.cds.ability ?? 0) > this.now) return;
    p.cds.ability = this.now + def.ability.cd * 0.95;
    const [dx, , dz] = norm3([rawDir[0], 0, rawDir[2]]);
    switch (p.dino) {
      case 'raptor': {
        // pounce: client dashes; we damage everything along the line ahead
        for (const e of this.enemies.values()) {
          const ex = e.x - p.x;
          const ez = e.z - p.z;
          const along = Math.max(0, Math.min(10, ex * dx + ez * dz));
          const off = Math.hypot(ex - dx * along, ez - dz * along);
          if (off < ENEMIES[e.type].radius + 1.4) this.hurtEnemy(e, 42);
        }
        this.fx('pounce', p.x, p.y, p.z, { dx: r2(dx), dz: r2(dz) });
        return;
      }
      case 'ankylo': {
        for (const e of this.enemies.values()) {
          const d = hyp(e.x, e.z, p.x, p.z);
          if (d > 6.5 + ENEMIES[e.type].radius) continue;
          this.hurtEnemy(e, 36);
          const k = e.type === 'titanoboa' ? 1.5 : 4;
          e.x += ((e.x - p.x) / (d || 1)) * k;
          e.z += ((e.z - p.z) / (d || 1)) * k;
        }
        this.fx('quake', p.x, p.y, p.z, { r: 6.5 });
        return;
      }
      case 'ptero': {
        this.projectiles.set(this.nextId, {
          id: this.uid(), kind: PK.boulder, x: p.x + dx, y: p.y - 0.3, z: p.z + dz,
          vx: dx * 5, vy: -2, vz: dz * 5, g: 24, life: 5, dmg: 60, slow: 0,
        });
        return;
      }
      case 'spino': {
        const watered: number[] = [];
        for (const e of this.enemies.values()) {
          const ex = e.x - p.x;
          const ez = e.z - p.z;
          const d = Math.hypot(ex, ez);
          if (d < 12 && (d < 1.5 || (ex * dx + ez * dz) / d > 0.8)) this.hurtEnemy(e, 24, 2.5);
        }
        const [ptx, ptz] = tileAt(p.x, p.z);
        for (let tz = ptz - 6; tz <= ptz + 6; tz++)
          for (let tx = ptx - 6; tx <= ptx + 6; tx++) {
            if (!inBounds(tx, tz)) continue;
            const i = tileIndex(tx, tz);
            if (this.tiles[i] !== TILE_T.SOIL) continue;
            const [cx, cz] = tileCenter(tx, tz);
            const ex = cx - p.x;
            const ez = cz - p.z;
            const d = Math.hypot(ex, ez);
            if (d < 12 && (d < 1.5 || (ex * dx + ez * dz) / d > 0.75)) {
              this.wet[i] = this.now + 120;
              watered.push(i);
            }
          }
        if (watered.length) this.sendTiles(watered);
        p.water = CAN_CAPACITY;
        this.fx('spout', p.x, p.y + 1.6, p.z, { dx: r2(dx), dz: r2(dz) });
        return;
      }
    }
  }

  private hurtEnemy(e: Enemy, dmg: number, slow = 0) {
    if (!this.enemies.has(e.id)) return;
    e.hp -= dmg;
    if (slow) e.slowUntil = Math.max(e.slowUntil, this.now + slow);
    this.fx('hit', e.x, e.y + ENEMIES[e.type].radius, e.z);
    if (e.hp <= 0) {
      this.enemies.delete(e.id);
      this.fx('boom', e.x, e.y + 0.5, e.z, { r: ENEMIES[e.type].radius });
      if (e.type === 'titanoboa') this.toast(null, 'The Titanoboa has been defeated! 🐍', 'good');
    }
  }

  // ================================================================ simulation
  private tick() {
    this.now += DT;
    this.slowTick += DT;
    const hasPlayers = this.players.size > 0;

    this.updateWeather();
    this.updatePlayers();
    this.updateProjectiles();
    this.updateEnemies();
    this.updateAnimals();
    this.updateDefenses();
    this.updateWalkers();
    if (this.slowTick >= 1) {
      this.slowTick -= 1;
      this.stepPlants();
      this.stepWorld();
    }
    if (hasPlayers) this.updateRaid();
    else if (!this.raid.active) this.raid.next += DT;

    if (this.resDirty) {
      this.resDirty = false;
      this.broadcast({ t: 'res', res: this.res });
    }
    if (hasPlayers) this.broadcastSnapshot();
  }

  private dayFraction() {
    return ((this.now + WORLD.DAY_LENGTH * 0.3) % WORLD.DAY_LENGTH) / WORLD.DAY_LENGTH;
  }

  private isNight() {
    const f = this.dayFraction();
    return f < 0.22 || f > 0.78;
  }

  private updateWeather() {
    if (this.now < this.weatherNext) return;
    this.rain = !this.rain;
    this.weatherNext = this.now + (this.rain ? 40 + this.rng() * 30 : 160 + this.rng() * 200);
    this.broadcast({ t: 'weather', rain: this.rain });
    if (this.rain) this.toast(null, 'It started raining — all soil is watered! 🌧️', 'info');
  }

  private updatePlayers() {
    for (const p of this.players.values()) {
      if (p.dead) {
        if (this.now >= p.respawnAt) {
          p.dead = false;
          p.hp = p.maxHp;
          const pos = this.spawnPoint();
          [p.x, p.y, p.z] = pos;
          this.send(p, { t: 'respawn', pos });
        }
        continue;
      }
      const inWater = heightAt(this.heights, p.x, p.z) < -0.3 && p.y < 0.5;
      let regen = this.now - p.lastHurt > 6 ? 1.5 : 0;
      if (p.dino === 'spino' && inWater) regen += 6;
      if (regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + regen * DT);
      if (inWater && p.water < CAN_CAPACITY) {
        p.water = CAN_CAPACITY;
        this.send(p, { t: 'can', water: p.water });
      }
    }
  }

  private updateProjectiles() {
    for (const pr of this.projectiles.values()) {
      pr.vy -= pr.g * DT;
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;
      pr.z += pr.vz * DT;
      pr.life -= DT;
      const ground = surfaceAt(this.heights, pr.x, pr.z);
      let done = pr.life <= 0 || Math.abs(pr.x) > HALF || Math.abs(pr.z) > HALF;
      if (pr.kind === PK.boulder) {
        if (pr.y <= ground) {
          for (const e of this.enemies.values()) if (hyp(e.x, e.z, pr.x, pr.z) < 4.8 + ENEMIES[e.type].radius * 0.5) this.hurtEnemy(e, pr.dmg);
          this.fx('boom', pr.x, ground, pr.z, { r: 4.8 });
          done = true;
        }
      } else {
        for (const e of this.enemies.values()) {
          const r = ENEMIES[e.type].radius;
          if (hyp(e.x, e.z, pr.x, pr.z) < r + 0.5 && pr.y > e.y - 0.6 && pr.y < e.y + r * 1.8 + 0.8) {
            this.hurtEnemy(e, pr.dmg, pr.slow);
            done = true;
            break;
          }
        }
        if (!done && pr.y < ground) done = true;
      }
      if (done) this.projectiles.delete(pr.id);
    }
  }

  private farmCenter(): [number, number] {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const b of this.buildings.values()) {
      x += b.x;
      z += b.z;
      n++;
    }
    return n ? [x / n, z / n] : [0, 0];
  }

  private resolve(t: Target): { x: number; z: number; r: number } | null {
    switch (t.kind) {
      case 'player': {
        const p = this.players.get(t.id);
        if (!p || p.dead || p.y - heightAt(this.heights, p.x, p.z) > 4.5) return null;
        return { x: p.x, z: p.z, r: 0.6 };
      }
      case 'animal': {
        const a = this.animals.get(t.id);
        return a ? { x: a.x, z: a.z, r: ANIMALS[a.type].radius } : null;
      }
      case 'plant': {
        const pl = this.plants.get(t.id);
        return pl && !pl.wild ? { x: pl.x, z: pl.z, r: 0.4 } : null;
      }
      case 'building': {
        const b = this.buildings.get(t.id);
        return b ? { x: b.x, z: b.z, r: BUILDINGS[b.type].radius } : null;
      }
    }
  }

  private pickTarget(e: Enemy): Target | null {
    let best: Target | null = null;
    let score = Infinity;
    const consider = (kind: TargetKind, id: number, x: number, z: number, weight: number, max: number) => {
      const d = hyp(e.x, e.z, x, z);
      if (d < max && d * weight < score) {
        score = d * weight;
        best = { kind, id };
      }
    };
    for (const p of this.players.values())
      if (!p.dead && p.y - heightAt(this.heights, p.x, p.z) < 4.5) consider('player', p.id, p.x, p.z, 0.7, 18);
    for (const a of this.animals.values()) consider('animal', a.id, a.x, a.z, 1, 50);
    for (const pl of this.plants.values()) if (!pl.wild) consider('plant', pl.id, pl.x, pl.z, 1.15, 50);
    for (const b of this.buildings.values()) {
      if (b.type === 'spikes') continue;
      const w = b.type === 'fence' || b.type === 'wall' ? 3 : 1.6;
      consider('building', b.id, b.x, b.z, w, 50);
    }
    return best;
  }

  private enemyHit(e: Enemy, t: Target) {
    if (this.now < e.nextAttack) return;
    const def = ENEMIES[e.type];
    e.nextAttack = this.now + def.cd;
    const pos = this.resolve(t);
    if (pos) this.fx('bite', pos.x, heightAt(this.heights, pos.x, pos.z) + 0.8, pos.z);
    switch (t.kind) {
      case 'player': {
        const p = this.players.get(t.id);
        if (p) this.hurtPlayer(p, e.dmg, `a ${def.name}`);
        break;
      }
      case 'animal': {
        const a = this.animals.get(t.id);
        if (!a) break;
        a.hp -= e.dmg;
        if (a.hp <= 0) {
          this.animals.delete(a.id);
          this.toast(null, `A ${ANIMALS[a.type].name} was eaten by a ${def.name}!`);
        }
        break;
      }
      case 'plant': {
        const pl = this.plants.get(t.id);
        if (pl) {
          this.removePlant(pl);
          e.retarget = 0;
        }
        break;
      }
      case 'building': {
        const b = this.buildings.get(t.id);
        if (!b) break;
        b.hp -= e.dmg * (e.type === 'titanoboa' ? 2 : 1);
        if (b.hp <= 0) {
          this.removeBuilding(b);
          this.toast(null, `A ${BUILDINGS[b.type].name} was destroyed!`);
          e.retarget = 0;
        } else this.broadcast({ t: 'building', b: this.buildingView(b) });
        break;
      }
    }
  }

  private updateEnemies() {
    const list = [...this.enemies.values()];
    for (const e of list) {
      const def = ENEMIES[e.type];
      e.retarget -= DT;
      if (e.retarget <= 0) {
        e.retarget = 0.6;
        e.target = this.pickTarget(e);
      }
      const tg = e.target ? this.resolve(e.target) : null;
      if (!tg) e.target = null;
      const [gx, gz] = tg ? [tg.x, tg.z] : this.farmCenter();
      const dx = gx - e.x;
      const dz = gz - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01) e.ry = Math.atan2(dx, dz);
      if (tg && e.target && d <= def.range + def.radius + tg.r) {
        this.enemyHit(e, e.target);
      } else if (d > 1) {
        const water = heightAt(this.heights, e.x, e.z) < -0.3;
        const sp = def.speed * (water ? def.swim : 1) * (e.slowUntil > this.now ? 0.4 : 1);
        const nx = e.x + (dx / d) * sp * DT;
        const nz = e.z + (dz / d) * sp * DT;
        let blocker: Building | null = null;
        for (const b of this.buildings.values()) {
          const bd = BUILDINGS[b.type];
          if (bd.blocks && hyp(nx, nz, b.x, b.z) < def.radius + bd.radius * 0.9) {
            blocker = b;
            break;
          }
        }
        if (blocker) {
          e.ry = Math.atan2(blocker.x - e.x, blocker.z - e.z);
          this.enemyHit(e, { kind: 'building', id: blocker.id });
        } else {
          e.x = nx;
          e.z = nz;
        }
      }
      for (const o of list) {
        if (o === e) continue;
        const min = def.radius + ENEMIES[o.type].radius * 0.8;
        const ox = e.x - o.x;
        const oz = e.z - o.z;
        const od = Math.hypot(ox, oz);
        if (od < min && od > 0.001) {
          e.x += (ox / od) * (min - od) * 0.3;
          e.z += (oz / od) * (min - od) * 0.3;
        }
      }
      e.x = Math.max(-HALF + 2, Math.min(HALF - 2, e.x));
      e.z = Math.max(-HALF + 2, Math.min(HALF - 2, e.z));
      e.y = surfaceAt(this.heights, e.x, e.z);
    }
  }

  private updateAnimals() {
    for (const a of this.animals.values()) {
      const def = ANIMALS[a.type];
      a.hunger = Math.max(0, a.hunger - HUNGER_DECAY * DT);
      if (a.hunger > 0 && this.now >= a.nextProduce) {
        a.nextProduce = this.now + def.interval;
        this.res[def.produce]++;
        this.resDirty = true;
        this.fx('harvest', a.x, a.y + 0.8, a.z);
      } else if (a.hunger <= 0) a.nextProduce = Math.max(a.nextProduce, this.now + def.interval * 0.5);
      const home = a.home ? this.buildings.get(a.home) : null;
      if (home) {
        a.hx = home.x;
        a.hz = home.z;
      }
      let threat: Enemy | null = null;
      let td = 9;
      for (const e of this.enemies.values()) {
        const d = hyp(a.x, a.z, e.x, e.z);
        if (d < td) {
          td = d;
          threat = e;
        }
      }
      let speed = def.speed;
      let gx: number;
      let gz: number;
      if (threat) {
        gx = a.x + (a.x - threat.x);
        gz = a.z + (a.z - threat.z);
        speed *= 2;
      } else {
        if (this.now > a.wanderAt) {
          a.wanderAt = this.now + 3 + this.rng() * 5;
          const ang = this.rng() * Math.PI * 2;
          const r = 3 + this.rng() * 4;
          a.goal = [a.hx + Math.cos(ang) * r, a.hz + Math.sin(ang) * r];
        }
        [gx, gz] = a.goal;
      }
      const dx = gx - a.x;
      const dz = gz - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        let nx = a.x + (dx / d) * speed * DT;
        let nz = a.z + (dz / d) * speed * DT;
        if (heightAt(this.heights, nx, nz) < -0.2) {
          nx = a.x;
          nz = a.z;
          a.wanderAt = 0;
        }
        for (const b of this.buildings.values()) {
          const br = BUILDINGS[b.type].radius + def.radius;
          const bd = hyp(nx, nz, b.x, b.z);
          if (BUILDINGS[b.type].blocks && bd < br) {
            nx = b.x + ((nx - b.x) / (bd || 1)) * br;
            nz = b.z + ((nz - b.z) / (bd || 1)) * br;
          }
        }
        a.x = Math.max(-HALF + 2, Math.min(HALF - 2, nx));
        a.z = Math.max(-HALF + 2, Math.min(HALF - 2, nz));
        a.ry = Math.atan2(dx, dz);
      }
      a.y = surfaceAt(this.heights, a.x, a.z);
    }
  }

  private updateDefenses() {
    for (const b of this.buildings.values()) {
      if (this.now < b.nextAct) continue;
      if (b.type === 'tower') {
        let best: Enemy | null = null;
        let bd = 25;
        for (const e of this.enemies.values()) {
          const d = hyp(e.x, e.z, b.x, b.z);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        if (!best) continue;
        b.nextAct = this.now + 1.4;
        const sy = heightAt(this.heights, b.x, b.z) + 5.6;
        const ty = best.y + ENEMIES[best.type].radius * 0.8;
        const [dx, dy, dz] = norm3([best.x - b.x, ty - sy, best.z - b.z]);
        this.projectiles.set(this.nextId, {
          id: this.uid(), kind: PK.bolt, x: b.x + dx, y: sy, z: b.z + dz,
          vx: dx * 45, vy: dy * 45, vz: dz * 45, g: 0, life: 1.2, dmg: 18, slow: 0,
        });
      } else if (b.type === 'spikes') {
        let hit = false;
        for (const e of this.enemies.values()) {
          if (hyp(e.x, e.z, b.x, b.z) < ENEMIES[e.type].radius + 1) {
            this.hurtEnemy(e, 16);
            hit = true;
          }
        }
        if (hit) {
          b.nextAct = this.now + 0.8;
          b.hp -= 5;
          if (b.hp <= 0) this.removeBuilding(b);
          else this.broadcast({ t: 'building', b: this.buildingView(b) });
        }
      }
    }
  }

  private updateWalkers() {
    for (const pl of this.plants.values()) {
      if (!pl.wild || pl.sp !== 'wanderroot') continue;
      if (!pl.walkTo) {
        pl.walkPause -= DT;
        if (pl.walkPause <= 0) {
          const ang = this.rng() * Math.PI * 2;
          const r = 4 + this.rng() * 8;
          const tx = pl.x + Math.cos(ang) * r;
          const tz = pl.z + Math.sin(ang) * r;
          if (Math.abs(tx) < HALF - 10 && Math.abs(tz) < HALF - 10 && heightAt(this.heights, tx, tz) > 0.3) pl.walkTo = [tx, tz];
          else pl.walkPause = 1;
        }
        continue;
      }
      const dx = pl.walkTo[0] - pl.x;
      const dz = pl.walkTo[1] - pl.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) {
        pl.walkTo = null;
        pl.walkPause = 2 + this.rng() * 5;
        continue;
      }
      // it runs away from nearby players, so you have to sneak or sprint
      let sp = 1.4;
      for (const p of this.players.values()) if (hyp(p.x, p.z, pl.x, pl.z) < 5) sp = 3.2;
      pl.x += (dx / d) * Math.min(d, sp * DT);
      pl.z += (dz / d) * Math.min(d, sp * DT);
    }
  }

  private isWet(i: number) {
    return this.rain || this.wet[i] > this.now || this.irr[i] === 1;
  }

  private computeIrrigation() {
    this.irrDirty = false;
    const next = new Uint8Array(N * N);
    const water = new Uint8Array(N * N);
    for (let tz = 0; tz < N; tz++) for (let tx = 0; tx < N; tx++) water[tileIndex(tx, tz)] = isWaterTile(this.heights, tx, tz) ? 1 : 0;
    const wells = [...this.buildings.values()].filter((b) => b.type === 'well');
    for (let tz = 0; tz < N; tz++)
      for (let tx = 0; tx < N; tx++) {
        const i = tileIndex(tx, tz);
        if (water[i]) continue;
        let wetHere = false;
        for (let dz = -2; dz <= 2 && !wetHere; dz++)
          for (let dx = -2; dx <= 2 && !wetHere; dx++) {
            const nx = tx + dx;
            const nz = tz + dz;
            if (inBounds(nx, nz) && water[tileIndex(nx, nz)]) wetHere = true;
          }
        if (!wetHere && wells.length) {
          const [cx, cz] = tileCenter(tx, tz);
          wetHere = wells.some((w) => hyp(w.x, w.z, cx, cz) < 7);
        }
        next[i] = wetHere ? 1 : 0;
      }
    let changed = false;
    for (let i = 0; i < next.length; i++) if (next[i] !== this.irr[i]) changed = true;
    this.irr = next;
    if (changed) {
      const list: number[] = [];
      next.forEach((v, i) => v && list.push(i));
      this.broadcast({ t: 'irr', list });
    }
  }

  private stepPlants() {
    const night = this.isNight();
    for (const pl of [...this.plants.values()]) {
      if (pl.wild || !this.plants.has(pl.id)) continue;
      const def = PLANTS[pl.sp];
      const i = tileIndex(pl.tx, pl.tz);
      let changed = false;
      if (pl.feral) {
        this.feralAct(pl);
        continue;
      }
      if (this.isWet(i)) pl.growth = Math.min(1, pl.growth + 1 / def.growTime);
      else if (pl.tame < 100) pl.tame = Math.max(0, pl.tame - TAME.NEGLECT_DECAY);
      const stage = pl.growth >= 1 ? 3 : Math.floor(pl.growth * 3);
      if (stage !== pl.stage) {
        pl.stage = stage;
        changed = true;
        if (stage === 3) {
          pl.ripeAt = this.now;
          if (pl.tame < 100) this.toast(null, `A ${def.name} is ripe but still wild — tame it (E) before it goes feral!`);
        }
      }
      if (pl.stage === 3 && pl.tame < 100 && this.now - pl.ripeAt > TAME.FERAL_GRACE) {
        this.goFeral(pl);
        continue;
      }
      if (pl.tame >= 100 && pl.stage >= 2) this.tamedAct(pl, night);
      const tb = Math.floor(pl.tame / 5);
      if (tb !== pl.tb) {
        pl.tb = tb;
        changed = true;
      }
      if (changed) this.broadcast({ t: 'plant', p: this.plantView(pl) });
    }
  }

  private goFeral(pl: Plant) {
    const def = PLANTS[pl.sp];
    pl.feral = true;
    this.toast(null, `A ${def.name} went feral: ${def.feral.toLowerCase()}!`);
    if (pl.sp === 'wanderroot') {
      // it pulls itself out of the soil and becomes wild again
      const i = tileIndex(pl.tx, pl.tz);
      if (this.tilePlant[i] === pl.id) this.tilePlant[i] = 0;
      pl.wild = true;
      pl.feral = false;
      pl.tx = -1;
      pl.tz = -1;
      pl.tame = 0;
      const ang = this.rng() * Math.PI * 2;
      pl.walkTo = [pl.x + Math.cos(ang) * 14, pl.z + Math.sin(ang) * 14];
    }
    if (pl.sp === 'sunbloom') pl.wiltAt = this.now + 8;
    this.broadcast({ t: 'plant', p: this.plantView(pl) });
  }

  private feralAct(pl: Plant) {
    if (this.now < pl.nextAct) return;
    const y = heightAt(this.heights, pl.x, pl.z);
    switch (pl.sp) {
      case 'snapjaw': {
        pl.nextAct = this.now + 2;
        let bit = false;
        for (const p of this.players.values())
          if (hyp(p.x, p.z, pl.x, pl.z) < 2.6) {
            this.hurtPlayer(p, 8, 'a feral Snapjaw');
            bit = true;
          }
        for (const e of this.enemies.values())
          if (hyp(e.x, e.z, pl.x, pl.z) < 2.6 + ENEMIES[e.type].radius) {
            this.hurtEnemy(e, 8);
            bit = true;
          }
        if (bit) this.fx('bite', pl.x, y + 0.8, pl.z);
        return;
      }
      case 'thornberry': {
        pl.nextAct = this.now + 12;
        for (const p of this.players.values()) if (hyp(p.x, p.z, pl.x, pl.z) < 1.7) this.hurtPlayer(p, 4, 'feral thorns');
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
        const [dx, dz] = dirs[Math.floor(this.rng() * dirs.length)];
        const nx = pl.tx + dx;
        const nz = pl.tz + dz;
        if (!inBounds(nx, nz) || isWaterTile(this.heights, nx, nz)) return;
        const ni = tileIndex(nx, nz);
        const [cx, cz] = tileCenter(nx, nz);
        if (this.tilePlant[ni] || this.buildingAt(cx, cz) || [...this.plants.values()].some((o) => o.wild && hyp(o.x, o.z, cx, cz) < 1)) return;
        const wild = this.spawnWildPlant('thornberry', [cx, cz]);
        if (wild) this.broadcast({ t: 'plant', p: this.plantView(wild) });
        if (this.tiles[ni] !== TILE_T.ROUGH) {
          this.tiles[ni] = TILE_T.ROUGH;
          this.sendTiles([ni]);
        }
        return;
      }
      case 'glowcap': {
        pl.nextAct = this.now + 3;
        let puffed = false;
        for (const p of this.players.values())
          if (hyp(p.x, p.z, pl.x, pl.z) < 3.5) {
            this.hurtPlayer(p, 3, 'stinging spores');
            puffed = true;
          }
        if (puffed) this.fx('spores', pl.x, y + 0.6, pl.z, { r: 3.5 });
        return;
      }
      case 'sunbloom': {
        pl.nextAct = this.now + 1;
        if (pl.wiltAt && this.now > pl.wiltAt) {
          const i = tileIndex(pl.tx, pl.tz);
          this.removePlant(pl);
          this.tiles[i] = TILE_T.ROUGH;
          this.sendTiles([i]);
        }
        return;
      }
      case 'wanderroot':
        return;
    }
  }

  private tamedAct(pl: Plant, night: boolean) {
    if (this.now < pl.nextAct) return;
    const y = heightAt(this.heights, pl.x, pl.z);
    switch (pl.sp) {
      case 'snapjaw': {
        let best: Enemy | null = null;
        let bd = 3.4;
        for (const e of this.enemies.values()) {
          const d = hyp(e.x, e.z, pl.x, pl.z) - ENEMIES[e.type].radius;
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        if (best) {
          pl.nextAct = this.now + 1.5;
          this.hurtEnemy(best, 12);
          this.fx('bite', best.x, best.y + 0.8, best.z);
        }
        return;
      }
      case 'thornberry':
        for (const e of this.enemies.values()) if (hyp(e.x, e.z, pl.x, pl.z) < 2.4 + ENEMIES[e.type].radius * 0.5) this.hurtEnemy(e, 6);
        return;
      case 'glowcap': {
        if (!night) return;
        let any = false;
        for (const e of this.enemies.values())
          if (hyp(e.x, e.z, pl.x, pl.z) < 5) {
            e.slowUntil = Math.max(e.slowUntil, this.now + 1.5);
            any = true;
          }
        if (any) {
          pl.nextAct = this.now + 2;
          this.fx('spores', pl.x, y + 0.6, pl.z, { r: 5 });
        }
        return;
      }
      case 'sunbloom':
        for (const p of this.players.values()) {
          if (!p.dead && p.hp < p.maxHp && hyp(p.x, p.z, pl.x, pl.z) < 5) {
            p.hp = Math.min(p.maxHp, p.hp + 4);
            this.send(p, { t: 'hurt', hp: Math.round(p.hp), dmg: 0 });
          }
        }
        return;
      case 'wanderroot':
        return;
    }
  }

  private stepWorld() {
    if (this.irrDirty) this.computeIrrigation();
    let wild = 0;
    for (const pl of this.plants.values()) if (pl.wild) wild++;
    if (wild < 45) {
      const p = this.spawnWildPlant();
      if (p) this.broadcast({ t: 'plant', p: this.plantView(p) });
    }
    for (const n of this.nodes.values()) {
      if (n.amount <= 0 && this.now > n.respawnAt && !this.buildingAt(n.x, n.z, 1)) {
        n.amount = n.max;
        this.broadcast({ t: 'node', id: n.id, amount: n.amount });
      }
    }
  }

  private updateRaid() {
    const R = this.raid;
    if (!R.active) {
      if (!R.warned && this.now >= R.next - RAID.WARNING) {
        R.warned = true;
        this.broadcast({ t: 'raid', state: 'warn', wave: R.wave + 1, next: r2(R.next) });
      }
      if (this.now >= R.next) {
        R.wave++;
        R.active = true;
        this.spawnWave(R.wave);
        this.broadcast({ t: 'raid', state: 'start', wave: R.wave, next: r2(R.next) });
      }
    } else if (this.enemies.size === 0) {
      R.active = false;
      R.warned = false;
      R.next = this.now + RAID.INTERVAL;
      const reward = { wood: 8 + R.wave * 4, stone: 6 + R.wave * 3, food: 4 + R.wave * 2 };
      this.gain(reward);
      this.broadcast({ t: 'raid', state: 'end', wave: R.wave, next: r2(R.next) });
      this.toast(null, `Raid ${R.wave} repelled! Reward: ${reward.wood} wood, ${reward.stone} stone, ${reward.food} food`, 'good');
    }
  }

  private spawnWave(n: number) {
    const mult = 0.7 + 0.3 * Math.max(1, this.players.size);
    const scale = 1 + 0.15 * (n - 1);
    const spawn = (type: EnemyType, x: number, z: number) => {
      const def = ENEMIES[type];
      const hp = Math.round(def.hp * scale);
      const e: Enemy = {
        id: this.uid(), type, x, z, y: surfaceAt(this.heights, x, z), ry: 0, hp, maxHp: hp,
        dmg: Math.round(def.dmg * (1 + 0.08 * (n - 1))), slowUntil: 0, nextAttack: 0, retarget: 0, target: null,
      };
      this.enemies.set(e.id, e);
    };
    const edge = (): [number, number] => {
      const a = this.rng() * Math.PI * 2;
      const r = 78 + this.rng() * 6;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const packAngle = this.rng() * Math.PI * 2;
    const mega = Math.round((2 + n * 1.5) * mult);
    for (let i = 0; i < mega; i++) {
      const a = packAngle + (this.rng() - 0.5) * 0.8;
      const r = 76 + this.rng() * 8;
      spawn('megalania', Math.cos(a) * r, Math.sin(a) * r);
    }
    const sarco = Math.floor((n / 2) * mult);
    for (let i = 0; i < sarco; i++) {
      const L = LAKES[0];
      const a = this.rng() * Math.PI * 2;
      spawn('sarcosuchus', L.x + Math.cos(a) * L.r * 0.4, L.z + Math.sin(a) * L.r * 0.4);
    }
    if (n % 3 === 0) {
      for (let i = 0; i < 1 + Math.floor(n / 6); i++) spawn('titanoboa', ...edge());
      this.toast(null, 'The ground trembles... a TITANOBOA approaches! 🐍', 'warn');
    }
  }

  private broadcastSnapshot() {
    const day = r2(this.dayFraction());
    const msg: ServerMsg = {
      t: 's',
      now: r2(this.now),
      day,
      p: [...this.players.values()].map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), p.anim, Math.round(p.hp), p.dead ? 1 : 0]),
      e: [...this.enemies.values()].map((e) => [e.id, ENEMY_KINDS.indexOf(e.type), r2(e.x), r2(e.y), r2(e.z), r2(e.ry), Math.round(e.hp), e.maxHp, e.slowUntil > this.now ? 1 : 0]),
      a: [...this.animals.values()].map((a) => [a.id, ANIMAL_KINDS.indexOf(a.type), r2(a.x), r2(a.y), r2(a.z), r2(a.ry), a.hunger <= 0 ? 1 : 0]),
      j: [...this.projectiles.values()].map((pr) => [pr.id, pr.kind, r2(pr.x), r2(pr.y), r2(pr.z)]),
      w: [...this.plants.values()].filter((pl) => pl.wild && pl.sp === 'wanderroot').map((pl) => [pl.id, r2(pl.x), r2(pl.z)]),
    };
    this.broadcast(msg);
  }
}

function norm3(v: [number, number, number]): [number, number, number] {
  const [x, y, z] = v.map((n) => (Number.isFinite(n) ? n : 0));
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

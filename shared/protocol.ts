import type { BuildingType, DinoType, PlantSpecies, Resources, SeedStock, ToolId } from './constants';

// ---------------------------------------------------------------- Entity views
export interface PlayerInfo {
  id: number;
  name: string;
  dino: DinoType;
  color: string;
}

export interface PlantView {
  id: number;
  sp: PlantSpecies;
  x: number;
  z: number;
  tx: number; // -1 for wild plants
  tz: number;
  wild: boolean;
  stage: number; // 0 sprout .. 3 ripe
  growth: number; // 0..1
  tame: number; // 0..100
  feral: boolean;
}

export interface BuildingView {
  id: number;
  type: BuildingType;
  x: number;
  z: number;
  rot: number;
  hp: number;
}

export interface NodeView {
  id: number;
  kind: 'tree' | 'rock';
  x: number;
  z: number;
  s: number; // scale
  v: number; // visual variant
  amount: number;
}

export interface RaidState {
  wave: number;
  active: boolean;
  next: number; // server time of next raid
}

// Snapshot tuples keep the 20 Hz stream compact.
export type PlayerTuple = [id: number, x: number, y: number, z: number, ry: number, anim: number, hp: number, dead: number];
export type EnemyTuple = [id: number, type: number, x: number, y: number, z: number, ry: number, hp: number, maxHp: number, slowed: number];
export type AnimalTuple = [id: number, type: number, x: number, y: number, z: number, ry: number, hungry: number];
export type ProjectileTuple = [id: number, kind: number, x: number, y: number, z: number];
export type WalkerTuple = [id: number, x: number, z: number];

export const ENEMY_KINDS = ['megalania', 'sarcosuchus', 'titanoboa'] as const;
export const ANIMAL_KINDS = ['dodo', 'mammoth'] as const;
export const PROJECTILE_KINDS = ['stone', 'bola', 'boulder', 'bolt'] as const;

export const ANIM = { IDLE: 0, WALK: 1, RUN: 2, FLY: 3, SWIM: 4 } as const;

export type FxKind = 'dust' | 'splash' | 'hit' | 'quake' | 'spout' | 'pounce' | 'bite' | 'heal' | 'build' | 'boom' | 'spores' | 'swing' | 'harvest';

// ---------------------------------------------------------------- Server -> client
export type ServerMsg =
  | {
      t: 'welcome';
      id: number;
      now: number;
      heights: number[];
      tiles: number[];
      wet: [number, number][];
      irr: number[];
      plants: PlantView[];
      buildings: BuildingView[];
      nodes: NodeView[];
      res: Resources;
      seeds: Record<PlantSpecies, SeedStock>;
      players: PlayerInfo[];
      rain: boolean;
      raid: RaidState;
      spawn: [number, number, number];
      water: number;
    }
  | { t: 's'; now: number; day: number; p: PlayerTuple[]; e: EnemyTuple[]; a: AnimalTuple[]; j: ProjectileTuple[]; w: WalkerTuple[] }
  | { t: 'join'; info: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'tiles'; list: [idx: number, type: number, wetUntil: number][] }
  | { t: 'heights'; list: [vi: number, h: number][] }
  | { t: 'irr'; list: number[] }
  | { t: 'plant'; p: PlantView }
  | { t: 'plantGone'; id: number }
  | { t: 'building'; b: BuildingView }
  | { t: 'buildingGone'; id: number }
  | { t: 'node'; id: number; amount: number }
  | { t: 'res'; res: Resources }
  | { t: 'seeds'; seeds: Record<PlantSpecies, SeedStock> }
  | { t: 'can'; water: number }
  | { t: 'hurt'; hp: number; dmg: number }
  | { t: 'died'; by: string }
  | { t: 'respawn'; pos: [number, number, number] }
  | { t: 'fx'; k: FxKind; x: number; y: number; z: number; dx?: number; dz?: number; r?: number }
  | { t: 'msg'; text: string; kind?: 'info' | 'warn' | 'good' }
  | { t: 'chat'; from: string; color: string; text: string }
  | { t: 'raid'; state: 'warn' | 'start' | 'end'; wave: number; next: number }
  | { t: 'weather'; rain: boolean };

// ---------------------------------------------------------------- Client -> server
export type Action =
  | { a: 'till'; tx: number; tz: number }
  | { a: 'clear'; tx: number; tz: number }
  | { a: 'dig'; tx: number; tz: number; up: boolean }
  | { a: 'water'; tx: number; tz: number }
  | { a: 'plant'; tx: number; tz: number; sp: PlantSpecies }
  | { a: 'build'; tx: number; tz: number; type: BuildingType; rot: number }
  | { a: 'demolish'; id: number }
  | { a: 'interact'; kind: 'node' | 'plant' | 'animal' | 'building'; id: number }
  | { a: 'attack'; tool: Extract<ToolId, 'club' | 'sling' | 'bola'>; dir: [number, number, number] }
  | { a: 'ability'; dir: [number, number, number] }
  | { a: 'heal' };

export type ClientMsg =
  | { t: 'join'; name: string; dino: DinoType }
  | { t: 'state'; x: number; y: number; z: number; ry: number; anim: number }
  | { t: 'act'; act: Action }
  | { t: 'chat'; text: string };

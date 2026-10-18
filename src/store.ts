import { create } from 'zustand';
import type { DinoType, PlantSpecies, Resources, SeedStock } from '../shared/constants';
import { CAN_CAPACITY, DINOS } from '../shared/constants';
import type { BuildingView, NodeView, PlantView, PlayerInfo, RaidState } from '../shared/protocol';
import { initialQuality } from './game/quality';

export type Phase = 'menu' | 'connecting' | 'playing';
export type ToastKind = 'info' | 'warn' | 'good';

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

export interface ChatLine {
  id: number;
  from: string;
  color: string;
  text: string;
}

export interface RaidUi extends RaidState {
  /** 'warn' while the 20 s warning runs, 'active' during the raid, otherwise 'calm' */
  status: 'calm' | 'warn' | 'active';
}

/**
 * Reactive game state for React (UI + entity lists).
 * High-frequency data (positions at 20 Hz, terrain arrays) lives in `world.ts` instead.
 */
export interface GameState {
  phase: Phase;
  error: string | null;
  /** rendering/runtime failure shown on top of the game (e.g. WebGL context lost, shader errors) */
  gfxError: string | null;
  /** index into QUALITY (game/quality.ts); changing it remounts the 3D canvas */
  gfxLevel: number;
  myId: number;
  myName: string;
  myDino: DinoType;

  players: Record<number, PlayerInfo>;
  /** hp per player id, refreshed from snapshots only when it changes */
  playerHp: Record<number, number>;
  hp: number;
  maxHp: number;
  dead: boolean;
  deathBy: string;
  water: number;

  res: Resources;
  seeds: Record<PlantSpecies, SeedStock>;
  plants: Record<number, PlantView>;
  buildings: Record<number, BuildingView>;
  nodes: Record<number, NodeView>;
  enemyIds: number[];
  animalIds: number[];
  projectileIds: number[];

  rain: boolean;
  /** 0..1 fraction of the day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset); updated ~2x per second */
  day: number;
  dayCount: number;
  raid: RaidUi;

  /** index into TOOLS */
  tool: number;
  /** index into PLANT_ORDER, used by the seed pouch */
  seedIdx: number;
  /** index into BUILD_ORDER, used by the hammer */
  buildIdx: number;
  /** 0..3 quarter turns */
  buildRot: number;
  /** performance.now() ms when the dino ability is ready again */
  abilityReadyAt: number;

  /** text shown under the crosshair, e.g. "E · Chop Cycad (5 left)" */
  prompt: string | null;
  /** small line about the targeted tile/plant, e.g. "Snapjaw Fern · growing 40% · tame 60% · 💧" */
  targetInfo: string | null;

  toasts: Toast[];
  chat: ChatLine[];
  chatOpen: boolean;
  helpOpen: boolean;
  pointerLocked: boolean;

  set: (partial: Partial<GameState>) => void;
  toast: (text: string, kind?: ToastKind) => void;
  addChat: (line: Omit<ChatLine, 'id'>) => void;
}

let toastId = 1;
let chatId = 1;

export const useGame = create<GameState>((set, get) => ({
  phase: 'menu',
  error: null,
  gfxError: null,
  gfxLevel: initialQuality(),
  myId: 0,
  myName: '',
  myDino: 'raptor',

  players: {},
  playerHp: {},
  hp: DINOS.raptor.hp,
  maxHp: DINOS.raptor.hp,
  dead: false,
  deathBy: '',
  water: CAN_CAPACITY,

  res: { wood: 0, stone: 0, food: 0, eggs: 0, wool: 0, nectar: 0, spores: 0 },
  seeds: {
    snapjaw: { wild: 0, heirloom: 0 },
    thornberry: { wild: 0, heirloom: 0 },
    wanderroot: { wild: 0, heirloom: 0 },
    glowcap: { wild: 0, heirloom: 0 },
    sunbloom: { wild: 0, heirloom: 0 },
  },
  plants: {},
  buildings: {},
  nodes: {},
  enemyIds: [],
  animalIds: [],
  projectileIds: [],

  rain: false,
  day: 0.3,
  dayCount: 1,
  raid: { wave: 0, active: false, next: 0, status: 'calm' },

  tool: 0,
  seedIdx: 0,
  buildIdx: 0,
  buildRot: 0,
  abilityReadyAt: 0,

  prompt: null,
  targetInfo: null,

  toasts: [],
  chat: [],
  chatOpen: false,
  helpOpen: false,
  pointerLocked: false,

  set: (partial) => set(partial),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-5), { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4500);
  },
  addChat: (line) => set({ chat: [...get().chat.slice(-40), { ...line, id: chatId++ }] }),
}));

/** Non-hook access for game loops / event handlers. */
export const game = () => useGame.getState();

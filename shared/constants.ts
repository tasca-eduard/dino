// Shared game definitions used by both the server (rules) and client (visuals/UI).

export const WORLD = {
  TILE: 2, // world units per farm tile
  N: 100, // tiles per side
  HALF: 100, // world spans [-HALF, HALF]
  TICK_RATE: 20,
  DAY_LENGTH: 480, // seconds for a full day/night cycle
  REACH: 9, // max distance from player to a targeted tile
  INTERACT_RANGE: 3.8,
} as const;

export const TILE_T = { GRASS: 0, ROUGH: 1, SOIL: 2, SAND: 3 } as const;
export type TileType = (typeof TILE_T)[keyof typeof TILE_T];

export type ResourceKey = 'wood' | 'stone' | 'food' | 'eggs' | 'wool' | 'nectar' | 'spores';
export type Resources = Record<ResourceKey, number>;
export type Cost = Partial<Resources>;

export const RESOURCE_INFO: Record<ResourceKey, { name: string; icon: string }> = {
  wood: { name: 'Wood', icon: '🪵' },
  stone: { name: 'Stone', icon: '🪨' },
  food: { name: 'Food', icon: '🍖' },
  eggs: { name: 'Eggs', icon: '🥚' },
  wool: { name: 'Wool', icon: '🧶' },
  nectar: { name: 'Nectar', icon: '🍯' },
  spores: { name: 'Spores', icon: '✨' },
};

// ---------------------------------------------------------------- Dinosaurs
export type DinoType = 'raptor' | 'ankylo' | 'ptero' | 'spino';

export interface DinoDef {
  name: string;
  element: 'Land' | 'Air' | 'Water';
  desc: string;
  hp: number;
  speed: number;
  swim: number; // speed multiplier in water
  fly: boolean;
  gatherMult: number;
  color: string;
  ability: { name: string; cd: number; desc: string };
  perks: string[];
}

export const DINOS: Record<DinoType, DinoDef> = {
  raptor: {
    name: 'Velociraptor',
    element: 'Land',
    desc: 'A quick hunter-turned-farmer. Fast and agile, it hits hard and up close.',
    hp: 100,
    speed: 11,
    swim: 0.55,
    fly: false,
    gatherMult: 1,
    color: '#5f9e3c',
    ability: { name: 'Pounce', cd: 5, desc: 'Dash forward, shredding every raider in your path.' },
    perks: ['Fastest runner', 'Double jump'],
  },
  ankylo: {
    name: 'Ankylosaurus',
    element: 'Land',
    desc: 'An armored builder. Slow, but it gathers double and can tank a Titanoboa.',
    hp: 190,
    speed: 7.2,
    swim: 0.45,
    fly: false,
    gatherMult: 2,
    color: '#a3804d',
    ability: { name: 'Tail Quake', cd: 8, desc: 'Slam the ground: area damage + knockback.' },
    perks: ['Huge health pool', 'Gathers 2x wood & stone'],
  },
  ptero: {
    name: 'Pteranodon',
    element: 'Air',
    desc: 'Scout of the skies. It flies over walls and bombs raiders from above.',
    hp: 85,
    speed: 9.5,
    swim: 0.6,
    fly: true,
    gatherMult: 1,
    color: '#c46a3a',
    ability: { name: 'Boulder Drop', cd: 6, desc: 'Drop a boulder that crushes everything below.' },
    perks: ['Can fly (hold Space)', 'Raiders cannot reach you up high'],
  },
  spino: {
    name: 'Spinosaurus',
    element: 'Water',
    desc: 'A river giant. It swims fast, heals in water and sprays it on the crops.',
    hp: 140,
    speed: 8.2,
    swim: 1.9,
    fly: false,
    gatherMult: 1,
    color: '#3f7f8f',
    ability: { name: 'Tidal Spout', cd: 6, desc: 'Water jet: damages raiders AND waters crops in a cone.' },
    perks: ['Fast swimmer', 'Regenerates in water', 'Watering can never runs dry'],
  },
};

// ---------------------------------------------------------------- Plants
export type PlantSpecies = 'snapjaw' | 'thornberry' | 'wanderroot' | 'glowcap' | 'sunbloom';

export interface PlantDef {
  name: string;
  desc: string;
  growTime: number; // seconds of watered growth to ripe
  produce: Cost;
  feral: string; // what happens if it ripens untamed
  tamed: string; // bonus once tamed
  regrows: boolean;
  wildWeight: number;
}

export const PLANTS: Record<PlantSpecies, PlantDef> = {
  snapjaw: {
    name: 'Snapjaw Fern',
    desc: 'A fern with a toothy pod. Wild ones bite.',
    growTime: 55,
    produce: { food: 3 },
    feral: 'Bites anything nearby',
    tamed: 'Guard plant: bites raiders',
    regrows: true,
    wildWeight: 3,
  },
  thornberry: {
    name: 'Thornberry',
    desc: 'A spiky berry bush that spreads like crazy.',
    growTime: 45,
    produce: { food: 2 },
    feral: 'Spreads thorns to nearby tiles',
    tamed: 'Living hedge: thorns hurt raiders',
    regrows: true,
    wildWeight: 3,
  },
  wanderroot: {
    name: 'Wanderroot',
    desc: 'A plump root with tiny legs. It wanders off if neglected.',
    growTime: 70,
    produce: { food: 7 },
    feral: 'Uproots itself and walks away',
    tamed: 'Big harvest',
    regrows: false,
    wildWeight: 2,
  },
  glowcap: {
    name: 'Glowcap',
    desc: 'A bioluminescent mushroom that puffs sleepy spores.',
    growTime: 40,
    produce: { spores: 2 },
    feral: 'Puffs stinging spores',
    tamed: 'Glows at night, slows raiders',
    regrows: true,
    wildWeight: 2,
  },
  sunbloom: {
    name: 'Sunbloom',
    desc: 'A giant sun-tracking flower full of healing nectar.',
    growTime: 75,
    produce: { nectar: 2 },
    feral: 'Wilts and ruins the soil',
    tamed: 'Heals nearby dinos',
    regrows: true,
    wildWeight: 1,
  },
};

export const PLANT_ORDER: PlantSpecies[] = ['snapjaw', 'thornberry', 'wanderroot', 'glowcap', 'sunbloom'];

export const TAME = {
  TEND: 20, // tame gained per tend
  HEIRLOOM_START: 50, // seeds harvested from tamed plants start half-tame
  NEGLECT_DECAY: 0.5, // per second while dry
  FERAL_GRACE: 25, // seconds a ripe untamed plant waits before going feral
};

export interface SeedStock {
  wild: number;
  heirloom: number;
}

// ---------------------------------------------------------------- Tools
export type ToolId = 'hoe' | 'shovel' | 'can' | 'seeds' | 'hammer' | 'club' | 'sling' | 'bola';

export interface ToolDef {
  id: ToolId;
  name: string;
  icon: string;
  primary: string;
  secondary?: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'hoe', name: 'Hoe', icon: '⛏️', primary: 'Till grass into soil' },
  { id: 'shovel', name: 'Shovel', icon: '🪏', primary: 'Clear rocks & weeds / flatten', secondary: 'Dig down (Shift: raise)' },
  { id: 'can', name: 'Watering Can', icon: '🚿', primary: 'Water soil (refill at water)' },
  { id: 'seeds', name: 'Seed Pouch', icon: '🌱', primary: 'Plant seed', secondary: 'R: next species' },
  { id: 'hammer', name: 'Hammer', icon: '🔨', primary: 'Build', secondary: 'R: next · T: rotate · X: demolish' },
  { id: 'club', name: 'Bone Club', icon: '🦴', primary: 'Melee swing' },
  { id: 'sling', name: 'Sling', icon: '🪃', primary: 'Throw stones' },
  { id: 'bola', name: 'Vine Bola', icon: '🪢', primary: 'Throw a bola that slows raiders' },
];

export const WEAPONS = {
  club: { dmg: 24, range: 3.4, cd: 0.55 },
  sling: { dmg: 14, speed: 38, cd: 0.45, life: 1.3, gravity: 6 },
  bola: { dmg: 6, speed: 26, cd: 1.8, life: 1.4, gravity: 8, slow: 4 },
} as const;

export const CAN_CAPACITY = 12;

// ---------------------------------------------------------------- Buildings
export type BuildingType =
  | 'fence'
  | 'wall'
  | 'house'
  | 'coop'
  | 'barn'
  | 'well'
  | 'spikes'
  | 'tower'
  | 'lantern';

export interface BuildingDef {
  name: string;
  desc: string;
  cost: Cost;
  hp: number;
  radius: number; // collision / footprint radius
  height: number;
  blocks: boolean; // blocks raiders (they must break it)
  animal?: AnimalType;
  animalCount?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  fence: { name: 'Fence', desc: 'Cheap barrier. Raiders must break it.', cost: { wood: 2 }, hp: 70, radius: 0.95, height: 1.4, blocks: true },
  wall: { name: 'Stone Wall', desc: 'Sturdy barrier.', cost: { stone: 4 }, hp: 260, radius: 0.98, height: 2.2, blocks: true },
  house: { name: 'Hut', desc: 'Respawn point. Press E to trade eggs/wool/spores.', cost: { wood: 20, stone: 8 }, hp: 450, radius: 2.4, height: 4.5, blocks: true },
  coop: { name: 'Dodo Coop', desc: 'Houses 2 dodos that lay eggs when fed.', cost: { wood: 12, food: 4 }, hp: 160, radius: 1.5, height: 2.6, blocks: true },
  barn: { name: 'Mammoth Barn', desc: 'Houses a mammoth calf that grows wool when fed.', cost: { wood: 22, stone: 6, food: 8 }, hp: 260, radius: 2.2, height: 3.8, blocks: true },
  well: { name: 'Well', desc: 'Keeps soil within 7m permanently watered.', cost: { stone: 12, wood: 4 }, hp: 200, radius: 1.1, height: 2.6, blocks: true },
  spikes: { name: 'Spike Trap', desc: 'Damages raiders that step on it.', cost: { wood: 4, stone: 2 }, hp: 90, radius: 0.9, height: 0.6, blocks: false },
  tower: { name: 'Ballista Tower', desc: 'Auto-fires bolts at raiders.', cost: { wood: 16, stone: 14, spores: 2 }, hp: 240, radius: 1.3, height: 6, blocks: true },
  lantern: { name: 'Glow Lantern', desc: 'Lights the night.', cost: { wood: 1, spores: 1 }, hp: 40, radius: 0.4, height: 2.4, blocks: false },
};

export const BUILD_ORDER: BuildingType[] = ['fence', 'wall', 'house', 'coop', 'barn', 'well', 'spikes', 'tower', 'lantern'];

export const TRADE = { eggs: { stone: 2 }, wool: { wood: 4 }, spores: { food: 2 } } as const;

// ---------------------------------------------------------------- Animals
export type AnimalType = 'dodo' | 'mammoth';

export const ANIMALS: Record<AnimalType, { name: string; hp: number; speed: number; produce: ResourceKey; interval: number; radius: number }> = {
  dodo: { name: 'Dodo', hp: 35, speed: 1.8, produce: 'eggs', interval: 25, radius: 0.6 },
  mammoth: { name: 'Mammoth Calf', hp: 140, speed: 1.4, produce: 'wool', interval: 40, radius: 1.2 },
};

export const HUNGER_DECAY = 0.7; // per second; fed animals start at 100

// ---------------------------------------------------------------- Raiders
export type EnemyType = 'megalania' | 'sarcosuchus' | 'titanoboa';

export const ENEMIES: Record<EnemyType, { name: string; hp: number; speed: number; swim: number; dmg: number; range: number; cd: number; radius: number }> = {
  megalania: { name: 'Megalania', hp: 70, speed: 5.4, swim: 0.6, dmg: 10, range: 1.6, cd: 1.2, radius: 1.1 },
  sarcosuchus: { name: 'Sarcosuchus', hp: 200, speed: 3.6, swim: 2.2, dmg: 24, range: 2.4, cd: 2.0, radius: 1.8 },
  titanoboa: { name: 'Titanoboa', hp: 800, speed: 4.2, swim: 1.3, dmg: 34, range: 3.0, cd: 2.4, radius: 2.4 },
};

export const RAID = {
  FIRST: 150, // seconds until first raid
  INTERVAL: 220,
  WARNING: 20,
};

export const PLAYER_COLORS = ['#ffd54f', '#4fc3f7', '#f06292', '#aed581', '#ba68c8', '#ff8a65', '#4db6ac', '#e0e0e0'];

export function canAfford(res: Resources, cost: Cost): boolean {
  return (Object.keys(cost) as ResourceKey[]).every((k) => res[k] >= (cost[k] ?? 0));
}

export function costText(cost: Cost): string {
  return (Object.keys(cost) as ResourceKey[]).map((k) => `${cost[k]}${RESOURCE_INFO[k].icon}`).join(' ');
}

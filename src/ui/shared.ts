// Small presentation helpers shared by the Menu and HUD.
import type { DinoDef, DinoType } from '../../shared/constants';
import { DINOS } from '../../shared/constants';

export const DINO_KEYS = Object.keys(DINOS) as DinoType[];

export const DINO_ICON: Record<DinoType, string> = {
  raptor: '🦖',
  ankylo: '🦕',
  ptero: '🪽',
  spino: '🐊',
};

export const ELEMENT_COLOR: Record<DinoDef['element'], string> = {
  Land: '#9ccc4a',
  Air: '#7fd0f0',
  Water: '#3fa2e0',
};

export const ELEMENT_ICON: Record<DinoDef['element'], string> = {
  Land: '⛰️',
  Air: '☁️',
  Water: '🌊',
};

export function isDino(v: unknown): v is DinoType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DINOS, v);
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0;
}

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

/** m:ss for a number of seconds (clamped at 0). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Graphics quality profiles. Some browser/driver combos (e.g. Firefox + ANGLE/D3D11 on older
// NVIDIA cards) reset the GPU with the full profile, so we step down automatically on context loss.
import { game } from '../store';

export interface QualityProfile {
  name: string;
  shadows: boolean;
  dpr: [number, number];
  antialias: boolean;
}

export const QUALITY: QualityProfile[] = [
  { name: 'High', shadows: true, dpr: [1, 1.75], antialias: true },
  { name: 'Medium (no shadows)', shadows: false, dpr: [1, 1.5], antialias: true },
  { name: 'Safe', shadows: false, dpr: [1, 1], antialias: false },
];

const KEY = 'dinofarm.gfxLevel';

/**
 * The canvas currently on screen. R3F force-loses the context of canvases it unmounts, so
 * context-loss events from any other canvas are expected and must be ignored.
 */
export const gfx = { activeCanvas: null as HTMLCanvasElement | null };

export function initialQuality(): number {
  const fromUrl = new URLSearchParams(location.search).get('gfx');
  if (fromUrl !== null && /^[0-2]$/.test(fromUrl)) return Number(fromUrl);
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= 0 && saved < QUALITY.length) return saved;
  } catch {
    // storage blocked: fall back to the default
  }
  return 0;
}

export function setQuality(level: number, reason?: string) {
  const s = game();
  const next = Math.max(0, Math.min(QUALITY.length - 1, level));
  gfx.activeCanvas = null; // the current canvas is about to be replaced
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // ignore
  }
  s.set({ gfxLevel: next });
  s.toast(reason ? `${reason} — graphics: ${QUALITY[next].name}` : `Graphics: ${QUALITY[next].name} (G to change)`, reason ? 'warn' : 'info');
}

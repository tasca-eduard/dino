// Surfaces WebGL / runtime failures in-game, since a black canvas otherwise gives players nothing to report.
import type * as THREE from 'three';
import { game } from '../store';
import { QUALITY, gfx, setQuality } from './quality';

let gpu = 'unknown GPU';

export function reportGfxError(text: string) {
  const s = game();
  const line = `${text}\n[graphics: ${QUALITY[s.gfxLevel].name} · ${gpu} · ${navigator.userAgent}]`;
  if (s.gfxError?.startsWith(text)) return;
  console.error('[dino-farm]', line);
  s.set({ gfxError: line });
}

let globalHooks = false;

export function installDiagnostics(gl: THREE.WebGLRenderer) {
  const ctx = gl.getContext();
  const info = ctx.getExtension('WEBGL_debug_renderer_info');
  gpu = info ? String(ctx.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(ctx.getParameter(ctx.RENDERER));
  console.info(`[dino-farm] WebGL ${gl.capabilities.isWebGL2 ? '2' : '1'} on ${gpu}`);

  gl.debug.onShaderError = (glc, program, vs, fs) => {
    const logs = [glc.getProgramInfoLog(program), glc.getShaderInfoLog(vs), glc.getShaderInfoLog(fs)]
      .map((l) => (l ?? '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 600);
    reportGfxError(`A shader failed to compile on your GPU:\n${logs}`);
  };
  gfx.activeCanvas = gl.domElement;
  gl.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (e.target !== gfx.activeCanvas || game().phase !== 'playing') return;
    const level = game().gfxLevel;
    console.warn(`[dino-farm] WebGL context lost at quality "${QUALITY[level].name}" on ${gpu}`);
    // remount the canvas one quality step lower; only give up at the lowest profile
    if (level < QUALITY.length - 1) setQuality(level + 1, 'Graphics driver reset');
    else reportGfxError('The graphics context was lost even in Safe mode (GPU driver reset or out of memory). Reload the page to try again.');
  });

  if (globalHooks) return;
  globalHooks = true;
  window.addEventListener('error', (e) => reportGfxError(`Error: ${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => reportGfxError(`Error: ${String(e.reason?.message ?? e.reason)}`));
}

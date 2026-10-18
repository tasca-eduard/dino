import { Canvas } from '@react-three/fiber';
import { installDiagnostics } from './game/diagnostics';
import { QUALITY } from './game/quality';
import { Scene } from './game/Scene';
import { useGame } from './store';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';

export function App() {
  const phase = useGame((s) => s.phase);
  const level = useGame((s) => s.gfxLevel);
  if (phase !== 'playing') return <Menu />;
  const q = QUALITY[level];
  return (
    <>
      <Canvas
        key={level}
        shadows={q.shadows}
        dpr={q.dpr}
        camera={{ fov: 62, near: 0.1, far: 600, position: [0, 10, -10] }}
        gl={{ antialias: q.antialias }}
        onCreated={({ gl }) => installDiagnostics(gl)}
      >
        <Scene />
      </Canvas>
      <Hud />
      <GfxError />
    </>
  );
}

function GfxError() {
  const err = useGame((s) => s.gfxError);
  if (!err) return null;
  return (
    <div className="gfx-error">
      <strong>⚠️ Something went wrong with the graphics</strong>
      <pre>{err}</pre>
      <button onClick={() => navigator.clipboard?.writeText(err)}>Copy details</button>
      <button onClick={() => useGame.getState().set({ gfxError: null })}>Dismiss</button>
    </div>
  );
}

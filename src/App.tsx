import { Canvas } from '@react-three/fiber';
import { Scene } from './game/Scene';
import { useGame } from './store';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';

export function App() {
  const phase = useGame((s) => s.phase);
  if (phase !== 'playing') return <Menu />;
  return (
    <>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 62, near: 0.1, far: 600, position: [0, 10, -10] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Scene />
      </Canvas>
      <Hud />
    </>
  );
}
